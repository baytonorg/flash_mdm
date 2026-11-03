// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { MIGRATIONS } from '../migrate.js';
import { changeMemberships } from '../_lib/membership-lifecycle.js';
import { deleteUserAccount, userDeletionPreflight } from '../_lib/user-offboarding.js';
import { applyInviteOffer } from '../_lib/invite-membership.js';
import { closeDatabasePool, transaction } from '../_lib/db.js';
import { hashToken } from '../_lib/crypto.js';
import { requireAuth } from '../_lib/auth.js';
import environmentHandler from '../environment-crud.js';
import workspaceHandler from '../workspace-users.js';
import keyHandler from '../api-key-crud.js';
import superadminHandler from '../superadmin-actions.js';
import historyHandler from '../flashagent-chat-history.js';
import { deleteEnvironmentData } from '../_lib/environment-deletion.js';
import { withSignupLinkReferenceLock } from '../_lib/signup-link-reference-lock.js';
import type { AuthContext } from '../_lib/auth.js';
import { updateGroupLifecycle, deleteGroupLifecycle, requireGroupCreationScope } from '../_lib/group-lifecycle.js';
import { changeDeviceGroup } from '../_lib/device-group-lifecycle.js';
import { currentDevicePolicy } from '../_lib/device-policy-reconcile.js';
import { writeInviteOffer } from '../_lib/invite-offer-write.js';

const url = process.env.MEMBERSHIP_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('membership lifecycle with PostgreSQL and actual handlers', () => {
  let pool: pg.Pool;
  const owner = '11111111-1111-4111-8111-111111111111';
  const target = '22222222-2222-4222-8222-222222222222';
  const other = '33333333-3333-4333-8333-333333333333';
  const workspace = '44444444-4444-4444-8444-444444444444';
  const env = '55555555-5555-4555-8555-555555555555';
  const group = '66666666-6666-4666-8666-666666666666';
  const auth = { authType: 'session', user: { id: owner, email: 'owner@fixture.invalid', is_superadmin: true } } as AuthContext;
  const mutate = (changes: Parameters<typeof changeMemberships>[0]['changes']) => changeMemberships({ workspaceId: workspace, auth, callerRole: 'owner', changes, ip: '' });
  async function topologyFixture() {
    const parent=crypto.randomUUID(),child=crypto.randomUUID(),device=crypto.randomUUID(),policy=crypto.randomUUID(),fallback=crypto.randomUUID();
    await pool.query('INSERT INTO groups(id,environment_id,name,parent_group_id) VALUES($1,$3,\'Parent\',NULL),($2,$3,\'Child\',$4)',[parent,child,env,group]);
    await pool.query('INSERT INTO group_closures VALUES($1,$1,0),($2,$2,0),($3,$2,1)',[parent,child,group]);
    await pool.query("INSERT INTO policies(id,environment_id,name,config) VALUES($1,$3,'Group policy','{}'),($2,$3,'Fallback','{}')",[policy,fallback,env]);
    await pool.query("INSERT INTO policy_assignments(policy_id,scope_type,scope_id) VALUES($1,'group',$3),($2,'environment',$4)",[policy,fallback,parent,env]);
    await pool.query("INSERT INTO devices(id,environment_id,group_id,amapi_name) VALUES($1,$2,$3,'fixture/devices/'||$1::uuid::text)",[device,env,child]);
    return {parent,child,device,policy,fallback};
  }

  it('moves an entire subtree atomically, preserves direct grants and queues current-policy reconciliation',async()=>{
    const f=await topologyFixture();
    expect((await currentDevicePolicy(f.device))?.policy_id).toBe(f.fallback);
    await updateGroupLifecycle({auth,groupId:group,parentId:f.parent,ip:''});
    expect((await pool.query('SELECT depth FROM group_closures WHERE ancestor_id=$1 AND descendant_id=$2',[f.parent,f.child])).rows[0].depth).toBe(2);
    expect((await pool.query('SELECT role FROM group_memberships WHERE group_id=$1',[group])).rows[0].role).toBe('admin');
    expect((await currentDevicePolicy(f.device))?.policy_id).toBe(f.policy);
    expect((await pool.query("SELECT payload FROM job_queue WHERE job_type='device_policy_reconcile'")).rows).toEqual([{payload:{device_id:f.device}}]);
  });

  it('serialises opposite reparent requests so exactly one succeeds without a cycle',async()=>{
    const f=await topologyFixture();
    const outcomes=await Promise.allSettled([updateGroupLifecycle({auth,groupId:group,parentId:f.parent,ip:''}),updateGroupLifecycle({auth,groupId:f.parent,parentId:group,ip:''})]);
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
    expect((await pool.query('SELECT 1 FROM group_closures WHERE ancestor_id=descendant_id AND depth<>0')).rowCount).toBe(0);
  });

  it('rolls topology, direct assignment cleanup and queued jobs back on audit failure',async()=>{
    const f=await topologyFixture();
    await pool.query(`CREATE FUNCTION fixture_group_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture group audit failure'; END $$; CREATE TRIGGER fixture_group_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fixture_group_audit_failure()`);
    try {
      await expect(updateGroupLifecycle({auth,groupId:group,parentId:f.parent,clearDirectAssignments:true,ip:''})).rejects.toThrow('fixture group audit failure');
      expect((await pool.query('SELECT parent_group_id FROM groups WHERE id=$1',[group])).rows[0].parent_group_id).toBeNull();
      expect((await pool.query('SELECT 1 FROM job_queue')).rowCount).toBe(0);
      expect((await currentDevicePolicy(f.device))?.policy_id).toBe(f.fallback);
    } finally {await pool.query('DROP TRIGGER fixture_group_audit_failure ON audit_log; DROP FUNCTION fixture_group_audit_failure()');}
  });

  it('deletes subtree grants, ungroups active and archived devices and retains users and credentials',async()=>{
    const f=await topologyFixture(); const archived=crypto.randomUUID();
    await pool.query("INSERT INTO devices(id,environment_id,group_id,amapi_name,deleted_at) VALUES($1,$2,$3,'fixture/archived/'||$1::uuid::text,now())",[archived,env,group]);
    await deleteGroupLifecycle({auth,groupId:group,ip:''});
    expect((await pool.query('SELECT 1 FROM groups WHERE id=ANY($1::uuid[])',[[group,f.child]])).rowCount).toBe(0);
    expect((await pool.query('SELECT group_id FROM devices ORDER BY id')).rows.every(d=>d.group_id===null)).toBe(true);
    expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(3);
    expect((await pool.query('SELECT 1 FROM job_queue')).rowCount).toBe(1);
    expect((await currentDevicePolicy(f.device))?.policy_id).toBe(f.fallback);
  });

  it('blocks group deletion with a protected enrolment reference and leaves its credential untouched',async()=>{
    const token=crypto.randomUUID();
    await pool.query("INSERT INTO enrollment_tokens(id,environment_id,group_id,name,amapi_value) VALUES($1,$2,$3,'Fixture','fixture-secret')",[token,env,group]);
    await failure(deleteGroupLifecycle({auth,groupId:group,ip:''}),409);
    expect((await pool.query('SELECT amapi_value FROM enrollment_tokens WHERE id=$1',[token])).rows[0].amapi_value).toBe('fixture-secret');
    expect((await pool.query('SELECT 1 FROM groups WHERE id=$1',[group])).rowCount).toBe(1);
  });

  it('blocks an inconsistent cached hierarchy before deleting any real descendant',async()=>{
    const f=await topologyFixture();
    await pool.query('DELETE FROM group_closures WHERE ancestor_id=$1 AND descendant_id=$2',[group,f.child]);
    await failure(deleteGroupLifecycle({auth,groupId:group,ip:''}),409);
    expect((await pool.query('SELECT 1 FROM groups WHERE id=ANY($1::uuid[])',[[group,f.child]])).rowCount).toBe(2);
    expect((await pool.query('SELECT group_id FROM devices WHERE id=$1',[f.device])).rows[0].group_id).toBe(f.child);
  });

  it('keeps scoped group administrators inside their authority during creation and device moves',async()=>{
    const f=await topologyFixture();
    await pool.query('DELETE FROM environment_memberships WHERE user_id=$1',[target]);
    const scoped={authType:'session',user:{id:target,is_superadmin:false}} as AuthContext;
    await failure(transaction(c=>requireGroupCreationScope(c,scoped,env,null)),403);
    await failure(changeDeviceGroup({auth:scoped,deviceId:f.device,groupId:f.parent,ip:''}),403);
    expect((await pool.query('SELECT group_id FROM devices WHERE id=$1',[f.device])).rows[0].group_id).toBe(f.child);
    await changeDeviceGroup({auth,deviceId:f.device,groupId:f.parent,ip:''});
    expect((await currentDevicePolicy(f.device))?.policy_id).toBe(f.policy);
  });

  it('serialises invitation writers and revalidates live issuer authority and selected scopes',async()=>{
    const input={auth,workspaceId:workspace,email:'new@fixture.invalid',role:'member',tokenHash:'fixture-new',expiresAtIso:new Date(Date.now()+60000).toISOString(),inviteId:crypto.randomUUID(),inviteType:'workspace_access',environmentIds:[],groupIds:[group]};
    const results=await Promise.all([writeInviteOffer(input),writeInviteOffer({...input,inviteId:crypto.randomUUID(),tokenHash:'fixture-second'})]);
    expect(results.map(r=>r.resent).sort()).toEqual([false,true]);
    expect((await pool.query("SELECT 1 FROM user_invites WHERE email='new@fixture.invalid'")).rowCount).toBe(1);
    await failure(deleteGroupLifecycle({auth,groupId:group,ip:''}),409);
    await failure(writeInviteOffer({...input,email:'outside@fixture.invalid',groupIds:[crypto.randomUUID()]}),409);
    await pool.query('UPDATE users SET is_superadmin=false WHERE id=$1',[owner]);
    await pool.query("UPDATE workspace_memberships SET role='viewer' WHERE user_id=$1",[other]);
    await failure(writeInviteOffer({...input,email:'denied@fixture.invalid',auth:{authType:'session',user:{id:other}} as AuthContext,groupIds:[]}),403);
  });
  async function failure(promise: Promise<unknown>, status: number) {
    try { await promise; throw new Error('Expected rejection'); } catch (error) {
      expect(error).toBeInstanceOf(Response); expect((error as Response).status).toBe(status);
    }
  }
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/flash_membership_fixture') throw new Error('Refusing a non-disposable database');
    process.env.DATABASE_URL = url;
    process.env.NODE_ENV = 'development';
    pool = new pg.Pool({ connectionString: url });
    if (process.env.MEMBERSHIP_TEST_SCHEMA_PATH) {
      const schema = readFileSync(process.env.MEMBERSHIP_TEST_SCHEMA_PATH, 'utf8').split('\n').filter(line => !line.startsWith('\\')).join('\n');
      await pool.query(schema);
      await pool.query('SET search_path TO public');
      await pool.query(MIGRATIONS.at(-1)!.sql);
    } else for (const migration of MIGRATIONS) await pool.query(migration.sql);
    await pool.query('CREATE TABLE IF NOT EXISTS _migrations (name varchar(255) PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    await pool.query('INSERT INTO _migrations (name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [MIGRATIONS.map(m=>m.name)]);
  }, 30000);
  afterAll(async () => { await closeDatabasePool(); await pool?.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE workspaces, users CASCADE');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO users (id,email,is_superadmin) VALUES ($1,'owner@fixture.invalid',true),($2,'target@fixture.invalid',false),($3,'other@fixture.invalid',false)`, [owner,target,other]);
      await c.query("INSERT INTO workspaces (id,name) VALUES ($1,'Fixture')", [workspace]);
      await c.query("INSERT INTO workspace_memberships (workspace_id,user_id,role,access_scope) VALUES ($1,$2,'owner','workspace'),($1,$3,'member','scoped'),($1,$4,'member','workspace')", [workspace,owner,target,other]);
      await c.query("INSERT INTO environments (id,workspace_id,name) VALUES ($1,$2,'Fixture environment')", [env,workspace]);
      await c.query("INSERT INTO groups (id,environment_id,name) VALUES ($1,$2,'Fixture group')", [group,env]);
      await c.query('INSERT INTO group_closures (ancestor_id,descendant_id,depth) VALUES ($1,$1,0)', [group]);
      await c.query("INSERT INTO environment_memberships (environment_id,user_id,role) VALUES ($1,$2,'owner')", [env,target]);
      await c.query("INSERT INTO group_memberships (group_id,user_id,role) VALUES ($1,$2,'admin')", [group,target]);
      await c.query('COMMIT');
    } finally { c.release(); }
  });

  it('removes all three grant levels and stale session selections, preserving other access', async () => {
    await pool.query("INSERT INTO sessions (user_id,workspace_id,environment_id,active_group_id,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')", [target,workspace,env,group]);
    await mutate([{ userId: target, operation: 'remove' }]);
    for (const table of ['workspace_memberships','environment_memberships','group_memberships']) expect((await pool.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[target])).rowCount).toBe(0);
    expect((await pool.query('SELECT workspace_id,environment_id,active_group_id FROM sessions WHERE user_id=$1',[target])).rows[0]).toEqual({workspace_id:null,environment_id:null,active_group_id:null});
    expect((await pool.query('SELECT 1 FROM workspace_memberships WHERE user_id=$1',[other])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='workspace.user_removed'")).rowCount).toBe(1);
  });

  it('rolls grants and audit back when a late write fails', async () => {
    await pool.query(`CREATE FUNCTION fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;
      CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fixture_audit_failure()`);
    try {
      await expect(mutate([{ userId: target, operation: 'remove' }])).rejects.toThrow('fixture failure');
      for (const table of ['workspace_memberships','environment_memberships','group_memberships']) expect((await pool.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[target])).rowCount).toBe(1);
    } finally { await pool.query('DROP TRIGGER fixture_audit_failure ON audit_log; DROP FUNCTION fixture_audit_failure()'); }
  });

  it('preserves independent child roles during workspace role edits', async () => {
    await mutate([{userId:target,operation:'role',role:'viewer'}]);
    expect((await pool.query('SELECT role FROM environment_memberships WHERE user_id=$1',[target])).rows[0].role).toBe('owner');
    expect((await pool.query('SELECT role FROM group_memberships WHERE user_id=$1',[target])).rows[0].role).toBe('admin');
  });

  it('rejects an all-owner batch atomically instead of choosing an arbitrary survivor', async () => {
    await pool.query("UPDATE workspace_memberships SET role='owner' WHERE user_id=$1",[other]);
    await failure(mutate([{userId:owner,operation:'remove'},{userId:other,operation:'remove'}].map(c=>c) as never),400);
    await failure(changeMemberships({workspaceId:workspace,auth,callerRole:'owner',selfService:true,ip:'',changes:[{userId:owner,operation:'remove'},{userId:other,operation:'remove'}]}),409);
    expect((await pool.query("SELECT 1 FROM workspace_memberships WHERE role='owner' AND access_scope='workspace'")).rowCount).toBe(2);
  });

  it('serialises concurrent last-owner changes and counts only workspace-wide owners', async () => {
    await pool.query("UPDATE workspace_memberships SET role='owner' WHERE user_id=$1",[other]);
    const results=await Promise.allSettled([owner,other].map(userId=>changeMemberships({workspaceId:workspace,auth,callerRole:'owner',selfService:true,ip:'',changes:[{userId,operation:'role',role:'viewer'}]})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await pool.query("SELECT 1 FROM workspace_memberships WHERE role='owner' AND access_scope='workspace'")).rowCount).toBe(1);
  });

  it('protects every SQL seat writer with the deferred ownership constraint', async () => {
    await expect(pool.query("UPDATE workspace_memberships SET role='viewer' WHERE user_id=$1",[owner])).rejects.toMatchObject({constraint:'workspace_surviving_owner'});
    // Deleting the resource itself has no transfer requirement.
    await pool.query('DELETE FROM environments WHERE id=$1',[env]);
    expect((await pool.query('SELECT 1 FROM users WHERE id=$1',[target])).rowCount).toBe(1);
  });

  it('preflights and deletes an ordinary member while preserving shared data and audit', async () => {
    const preflight=await userDeletionPreflight(pool as never,target);
    expect(preflight.blockers).toEqual([]);
    await pool.query("INSERT INTO audit_log (user_id,action) VALUES ($1,'fixture.before_delete')",[target]);
    await deleteUserAccount({userId:target,actorUserId:owner,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true,cancelPendingInvites:true});
    expect((await pool.query('SELECT 1 FROM users WHERE id=$1',[target])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM environments WHERE id=$1',[env])).rowCount).toBe(1);
    expect((await pool.query("SELECT user_id FROM audit_log WHERE action='fixture.before_delete'")).rows[0].user_id).toBeNull();
  });

  it.each(['owner','admin','member','viewer'])('preserves %s key material, authority and real read handlers after creator removal/deletion', async (role) => {
    const secrets=['fixture-workspace-'+role,'fixture-environment-'+role];
    for (let n=0;n<2;n++) await pool.query(`INSERT INTO api_keys (name,scope_type,workspace_id,environment_id,role,token_hash,token_enc,token_prefix,created_by_user_id)
      VALUES ('Fixture',$1,$2,$3,$4,$5,'fixture ciphertext','fixture',$6)`,[n?'environment':'workspace',workspace,n?env:null,role,hashToken(secrets[n]),target]);
    const before=(await pool.query('SELECT id,token_hash,token_enc,role,scope_type,workspace_id,environment_id,expires_at,revoked_at FROM api_keys ORDER BY id')).rows;
    for(const phase of ['before','removed','deleted']) {
      if(phase==='removed') await mutate([{userId:target,operation:'remove'}]);
      if(phase==='deleted') await deleteUserAccount({userId:target,actorUserId:owner,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true,cancelPendingInvites:true});
      for(const token of secrets) {
        const req=new Request('http://localhost/api/environments/'+env,{headers:{authorization:'Bearer '+token}});
        const principal=await requireAuth(req); expect(principal?.user.id).toBeNull(); expect(principal?.apiKey?.role).toBe(role);
        expect((await environmentHandler(req,{} as never)).status).toBe(200);
        const write = await environmentHandler(new Request('http://localhost/api/environments/update', { method: 'PUT', headers: { authorization: 'Bearer '+token, 'content-type': 'application/json' }, body: JSON.stringify({ id: env, name: 'Fixture environment' }) }), {} as never);
        expect(write.status).toBe(['owner','admin'].includes(role) ? 200 : 403);
        const platform = await superadminHandler(new Request('http://localhost/api/superadmin/actions', { method: 'POST', headers: { authorization: 'Bearer '+token, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preflight_user_deletion', target_id: other }) }), {} as never);
        expect(platform.status).toBe(403);
        const denied=await environmentHandler(new Request('http://localhost/api/environments/77777777-7777-4777-8777-777777777777',{headers:{authorization:'Bearer '+token}}),{} as never);
        expect([403,404]).toContain(denied.status);
      }
    }
    expect((await pool.query('SELECT id,token_hash,token_enc,role,scope_type,workspace_id,environment_id,expires_at,revoked_at FROM api_keys ORDER BY id')).rows).toEqual(before);
    expect((await pool.query('SELECT created_by_user_id FROM api_keys')).rows.every(r=>r.created_by_user_id===null)).toBe(true);
  });

  it('requires an explicit invitation lifecycle decision on offboarding', async () => {
    await pool.query("INSERT INTO user_invites (workspace_id,email,role,token_hash,invited_by,expires_at) VALUES ($1,'target@fixture.invalid','member','fixture-offer',$2,now()+interval '1 day')",[workspace,owner]);
    await failure(mutate([{userId:target,operation:'remove'}]),409);
    await mutate([{userId:target,operation:'remove',cancelPendingInvites:true}]);
    expect((await pool.query("SELECT status FROM user_invites WHERE token_hash='fixture-offer'")).rows[0].status).toBe('cancelled');
  });

  it('consumes scoped offers once without downgrading existing broader grants', async () => {
    await pool.query("INSERT INTO user_invites (workspace_id,email,role,token_hash,invited_by,expires_at,environment_ids,group_ids) VALUES ($1,'owner@fixture.invalid','viewer','fixture-accept',$2,now()+interval '1 day',$3,'[]')",[workspace,owner,JSON.stringify([env])]);
    const outcomes=await Promise.all([1,2].map(()=>transaction(c=>applyInviteOffer(c,'fixture-accept',owner,'owner@fixture.invalid'))));
    expect(outcomes.map(r=>r.alreadyAccepted).sort()).toEqual([false,true]);
    expect((await pool.query('SELECT role,access_scope FROM workspace_memberships WHERE user_id=$1',[owner])).rows[0]).toEqual({role:'owner',access_scope:'workspace'});
    expect((await pool.query('SELECT 1 FROM environment_memberships WHERE user_id=$1',[owner])).rowCount).toBe(0);
  });

  async function fixtureKey(input: { role?: string; scope?: 'workspace' | 'environment'; revoked?: boolean; expired?: boolean } = {}) {
    const token = 'fixture-'+crypto.randomUUID();
    const result = await pool.query(`INSERT INTO api_keys (name,scope_type,workspace_id,environment_id,role,token_hash,token_enc,token_prefix,created_by_user_id,expires_at,revoked_at)
      VALUES ('Fixture',$1,$2,$3,$4,$5,'fixture ciphertext','fixture',$6,$7,$8) RETURNING id`, [input.scope??'workspace',workspace,input.scope==='environment'?env:null,input.role??'admin',hashToken(token),target,input.expired?new Date(Date.now()-60000):null,input.revoked?new Date():null]);
    return { token, id: result.rows[0].id };
  }

  it('denies revoked and expired synthetic keys and accepts no-expiry keys', async () => {
    for (const state of [{revoked:true},{expired:true},{}]) {
      const key = await fixtureKey(state);
      const response = await environmentHandler(new Request('http://localhost/api/environments/'+env, {headers:{authorization:'Bearer '+key.token}}),{} as never);
      expect(response.status).toBe('revoked' in state || 'expired' in state ? 401 : 200);
    }
  });

  it('keeps key history separate from human history and records the key actor after creator deletion', async () => {
    const key = await fixtureKey();
    await deleteUserAccount({userId:target,actorUserId:owner,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true,cancelPendingInvites:true});
    const headers={authorization:'Bearer '+key.token,'content-type':'application/json'};
    const post=await historyHandler(new Request('http://localhost/api/flashagent/chat-history',{method:'POST',headers,body:JSON.stringify({environment_id:env,messages:[{role:'user',text:'Fixture message'}]})}),{} as never);
    expect(post.status).toBe(200);
    const row=(await pool.query('SELECT user_id,api_key_id FROM flashagent_chat_messages')).rows[0];
    expect(row).toEqual({user_id:null,api_key_id:key.id});
    expect((await historyHandler(new Request('http://localhost/api/flashagent/chat-history?environment_id='+env,{headers}),{} as never)).status).toBe(200);
    const write=await environmentHandler(new Request('http://localhost/api/environments/update',{method:'PUT',headers,body:JSON.stringify({id:env,name:'Fixture renamed'})}),{} as never);
    expect(write.status).toBe(200);
    const audit=(await pool.query("SELECT user_id,api_key_id,actor_type FROM audit_log WHERE action='environment.updated'")).rows[0];
    expect(audit).toEqual({user_id:null,api_key_id:key.id,actor_type:'api_key'});
  });

  it('preserves the prohibition on key-authenticated credential management', async () => {
    const key=await fixtureKey({role:'admin'});
    const headers={authorization:'Bearer '+key.token,'content-type':'application/json'};
    const denied=await keyHandler(new Request('http://localhost/api/api-keys/create',{method:'POST',headers,body:JSON.stringify({name:'Higher fixture',scope_type:'workspace',workspace_id:workspace,role:'owner'})}),{} as never);
    expect(denied.status).toBe(403);
    const allowed=await keyHandler(new Request('http://localhost/api/api-keys/create',{method:'POST',headers,body:JSON.stringify({name:'Allowed fixture',scope_type:'workspace',workspace_id:workspace,role:'viewer',expires_in_days:1})}),{} as never);
    expect(allowed.status).toBe(403);
    expect((await pool.query("SELECT 1 FROM api_keys WHERE name IN ('Allowed fixture', 'Higher fixture')")).rowCount).toBe(0);
  });

  it('rolls a combined role/scope change back and rejects cross-workspace assignments', async () => {
    await failure(mutate([{userId:target,operation:'access',role:'viewer',accessScope:'workspace',environmentIds:['77777777-7777-4777-8777-777777777777']}]),409);
    expect((await pool.query('SELECT role,access_scope FROM workspace_memberships WHERE user_id=$1',[target])).rows[0]).toEqual({role:'member',access_scope:'scoped'});
    expect((await pool.query('SELECT role FROM environment_memberships WHERE user_id=$1',[target])).rows[0].role).toBe('owner');
  });

  it('blocks sole-owner account deletion but does not mistake scoped owner labels for workspace ownership', async () => {
    await pool.query("UPDATE workspace_memberships SET role='owner' WHERE user_id=$1",[target]);
    expect((await userDeletionPreflight(pool as never,target)).blockers).toEqual([]);
    expect((await userDeletionPreflight(pool as never,owner)).blockers).toHaveLength(1);
  });

  it('rolls identity, sessions, key provenance and memberships back if the final deletion audit fails', async () => {
    await fixtureKey();
    await pool.query("INSERT INTO sessions (user_id,workspace_id,expires_at) VALUES ($1,$2,now()+interval '1 day')",[target,workspace]);
    await pool.query(`CREATE FUNCTION fixture_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='superadmin.user.deleted' THEN RAISE EXCEPTION 'fixture deletion failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_delete_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fixture_delete_failure()`);
    try {
      await expect(deleteUserAccount({userId:target,actorUserId:owner,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true,cancelPendingInvites:true})).rejects.toThrow('fixture deletion failure');
      expect((await pool.query('SELECT 1 FROM users WHERE id=$1',[target])).rowCount).toBe(1);
      expect((await pool.query('SELECT 1 FROM sessions WHERE user_id=$1',[target])).rowCount).toBe(1);
      expect((await pool.query('SELECT created_by_user_id FROM api_keys')).rows[0].created_by_user_id).toBe(target);
    } finally { await pool.query('DROP TRIGGER fixture_delete_failure ON audit_log; DROP FUNCTION fixture_delete_failure()'); }
  });

  it('keeps a management path under custom environment permissions', async () => {
    await pool.query(`UPDATE environments SET enterprise_features='{"rbac":{"permission_matrix":{"environment":{"manage_users":"owner"}}}}' WHERE id=$1`,[env]);
    await pool.query("INSERT INTO environment_memberships (environment_id,user_id,role) VALUES ($1,$2,'viewer')",[env,owner]);
    await failure(mutate([{userId:target,operation:'remove'}]),409);
    expect((await pool.query('SELECT role FROM environment_memberships WHERE user_id=$1',[target])).rows[0].role).toBe('owner');
  });

  it('rejects stale issuer authority and offers pointing to deleted scopes without partial grants', async () => {
    await pool.query("INSERT INTO user_invites (workspace_id,email,role,token_hash,invited_by,expires_at,environment_ids) VALUES ($1,'other@fixture.invalid','admin','fixture-stale',$2,now()+interval '1 day',$3)",[workspace,target,JSON.stringify([env])]);
    await mutate([{userId:target,operation:'remove'}]);
    await failure(transaction(c=>applyInviteOffer(c,'fixture-stale',other,'other@fixture.invalid')),409);
    expect((await pool.query("SELECT status FROM user_invites WHERE token_hash='fixture-stale'")).rows[0].status).toBe('pending');
  });

  it('uses the shared environment cleanup and preserves workspace seats and retained audit', async () => {
    await pool.query("INSERT INTO audit_log (environment_id,user_id,action) VALUES ($1,$2,'fixture.environment')",[env,owner]);
    await withSignupLinkReferenceLock(()=>transaction(async c=>{
      await c.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);
      await deleteEnvironmentData(c,env,false);
    }));
    expect((await pool.query('SELECT 1 FROM workspace_memberships WHERE user_id=$1',[target])).rowCount).toBe(1);
    expect((await pool.query("SELECT environment_id,details FROM audit_log WHERE action='fixture.environment'")).rows[0]).toEqual({environment_id:null,details:{deleted_environment_id:env}});
  });

  it('consumes first-environment entitlement once under concurrent creation and after scope deletion', async () => {
    await pool.query('DELETE FROM environment_memberships WHERE user_id=$1',[target]);
    await pool.query('DELETE FROM group_memberships WHERE user_id=$1',[target]);
    await pool.query(`UPDATE users SET metadata=jsonb_build_object('needs_environment_setup',true,'environment_setup_workspace_id',$2::text) WHERE id=$1`,[target,workspace]);
    const session='fixture-onboarding-session';
    await pool.query("INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 day')",[target,hashToken(session)]);
    const create=()=>environmentHandler(new Request('http://localhost/api/environments/create',{method:'POST',headers:{cookie:'flash_session='+session,'x-requested-with':'XMLHttpRequest','content-type':'application/json'},body:JSON.stringify({workspace_id:workspace,name:'One-shot fixture'})}),{} as never);
    const outcomes=await Promise.all([create(),create()]);
    expect(outcomes.map(r=>r.status).sort()).toEqual([201,409]);
    const created=(await pool.query("SELECT id FROM environments WHERE name='One-shot fixture'")).rows[0];
    expect((await pool.query('SELECT role FROM environment_memberships WHERE environment_id=$1 AND user_id=$2',[created.id,target])).rows[0].role).toBe('owner');
    await withSignupLinkReferenceLock(()=>transaction(c=>deleteEnvironmentData(c,created.id,false)));
    expect((await create()).status).toBe(403);
  });

  it('refuses account deletion against the legacy key cascade without touching the key', async () => {
    await fixtureKey();
    await pool.query(`ALTER TABLE api_keys DROP CONSTRAINT api_keys_created_by_user_id_fkey;
      ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE`);
    try {
      await failure(deleteUserAccount({userId:target,actorUserId:owner,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true,cancelPendingInvites:true}),409);
      expect((await pool.query('SELECT 1 FROM api_keys WHERE created_by_user_id=$1',[target])).rowCount).toBe(1);
      expect((await pool.query('SELECT 1 FROM users WHERE id=$1',[target])).rowCount).toBe(1);
    } finally {
      await pool.query(`ALTER TABLE api_keys DROP CONSTRAINT api_keys_created_by_user_id_fkey;
        ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL`);
    }
  });

  it('allows deliberate member self-leave, keeps login, denies removed access and protects the sole owner', async () => {
    for (const id of [target,owner]) await pool.query("INSERT INTO sessions (user_id,workspace_id,environment_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')",[id,workspace,env,hashToken('fixture-leave-'+id)]);
    const leave=(id:string)=>workspaceHandler(new Request('http://localhost/api/workspaces/users/leave',{method:'POST',headers:{cookie:'flash_session=fixture-leave-'+id,'x-requested-with':'XMLHttpRequest','content-type':'application/json'},body:JSON.stringify({workspace_id:workspace,confirm_leave:true,cancel_pending_invites:true})}),{} as never);
    expect((await leave(owner)).status).toBe(409);
    expect((await leave(target)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM users WHERE id=$1',[target])).rowCount).toBe(1);
    expect((await pool.query('SELECT workspace_id,environment_id FROM sessions WHERE user_id=$1',[target])).rows[0]).toEqual({workspace_id:null,environment_id:null});
    expect((await environmentHandler(new Request('http://localhost/api/environments/'+env,{headers:{cookie:'flash_session=fixture-leave-'+target}}),{} as never)).status).toBe(403);
  });

  it('denies real cross-workspace and cross-environment reads for independent key scopes', async () => {
    const ws2='88888888-8888-4888-8888-888888888888',env2='99999999-9999-4999-8999-999999999999',env3='77777777-7777-4777-8777-777777777777';
    await transaction(async c=>{
      await c.query("INSERT INTO workspaces (id,name) VALUES ($1,'Other fixture')",[ws2]);
      await c.query("INSERT INTO workspace_memberships (workspace_id,user_id,role,access_scope) VALUES ($1,$2,'owner','workspace')",[ws2,owner]);
      await c.query("INSERT INTO environments (id,workspace_id,name) VALUES ($1,$2,'Other environment'),($3,$4,'Sibling environment')",[env2,ws2,env3,workspace]);
    });
    for(const scope of ['workspace','environment'] as const) {
      const key=await fixtureKey({scope});
      const get=(id:string)=>environmentHandler(new Request('http://localhost/api/environments/'+id,{headers:{authorization:'Bearer '+key.token}}),{} as never);
      expect((await get(env2)).status).toBe(403);
      expect((await get(env3)).status).toBe(scope==='workspace'?200:403);
    }
  });

  it('blocks newly introduced user dependencies instead of silently cascading unknown credentials', async () => {
    await pool.query('CREATE TABLE fixture_unknown_credentials (user_id uuid REFERENCES users(id) ON DELETE CASCADE)');
    try {
      await pool.query('INSERT INTO fixture_unknown_credentials (user_id) VALUES ($1)',[target]);
      expect((await userDeletionPreflight(pool as never,target)).blockers.some(b=>b.includes('fixture_unknown_credentials'))).toBe(true);
      await failure(deleteUserAccount({userId:target,actorUserId:owner,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true,cancelPendingInvites:true}),409);
      expect((await pool.query('SELECT 1 FROM fixture_unknown_credentials')).rowCount).toBe(1);
    } finally { await pool.query('DROP TABLE fixture_unknown_credentials'); }
  });

  it('transfers ownership to an existing scoped member and removes the old owner atomically', async () => {
    const session='fixture-transfer-session';
    await pool.query("INSERT INTO sessions (user_id,workspace_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",[owner,workspace,hashToken(session)]);
    const call=(consent:boolean)=>workspaceHandler(new Request('http://localhost/api/workspaces/users/transfer-ownership',{method:'POST',headers:{cookie:'flash_session='+session,'x-requested-with':'XMLHttpRequest','content-type':'application/json'},body:JSON.stringify({workspace_id:workspace,successor_id:target,previous_owner_role:'leave',successor_consent_acknowledged:consent,cancel_pending_invites:true})}),{} as never);
    expect((await call(false)).status).toBe(400);
    expect((await call(true)).status).toBe(200);
    expect((await pool.query('SELECT role,access_scope FROM workspace_memberships WHERE user_id=$1',[target])).rows[0]).toEqual({role:'owner',access_scope:'workspace'});
    expect((await pool.query('SELECT 1 FROM workspace_memberships WHERE user_id=$1',[owner])).rowCount).toBe(0);
    expect((await pool.query('SELECT role FROM environment_memberships WHERE user_id=$1',[target])).rows[0].role).toBe('owner');
  });

  it('requires explicit cancellation of stale offers when removing environment access', async () => {
    await pool.query("INSERT INTO user_invites (workspace_id,email,role,token_hash,invited_by,expires_at,environment_ids) VALUES ($1,'target@fixture.invalid','member','fixture-scope-removal',$2,now()+interval '1 day',$3)",[workspace,owner,JSON.stringify([env])]);
    await failure(mutate([{userId:target,operation:'access',accessScope:'scoped',environmentIds:[],groupIds:[]}]),409);
    await mutate([{userId:target,operation:'access',accessScope:'scoped',environmentIds:[],groupIds:[],cancelPendingInvites:true}]);
    expect((await pool.query("SELECT status FROM user_invites WHERE token_hash='fixture-scope-removal'")).rows[0].status).toBe('cancelled');
  });

  it('accepts legacy single-scope offers without rewriting their credential or scope metadata', async () => {
    await pool.query("INSERT INTO user_invites (workspace_id,email,role,token_hash,invited_by,expires_at,environment_id) VALUES ($1,'other@fixture.invalid','owner','fixture-legacy',$2,now()+interval '1 day',$3)",[workspace,owner,env]);
    const before=(await pool.query("SELECT token_hash,expires_at,environment_id,environment_ids FROM user_invites WHERE token_hash='fixture-legacy'")).rows[0];
    await transaction(c=>applyInviteOffer(c,'fixture-legacy',other,'other@fixture.invalid'));
    expect((await pool.query('SELECT role FROM environment_memberships WHERE user_id=$1',[other])).rows[0].role).toBe('owner');
    expect((await pool.query("SELECT token_hash,expires_at,environment_id,environment_ids FROM user_invites WHERE token_hash='fixture-legacy'")).rows[0]).toEqual(before);
  });

  it('uses explicit modern empty scopes instead of obsolete legacy columns', async () => {
    await pool.query("INSERT INTO user_invites (workspace_id,email,role,token_hash,invited_by,expires_at,environment_id,environment_ids,group_ids) VALUES ($1,'other@fixture.invalid','viewer','fixture-modern',$2,now()+interval '1 day',$3,'[]','[]')",[workspace,owner,env]);
    await failure(transaction(c=>applyInviteOffer(c,'fixture-modern',other,'other@fixture.invalid')),409);
    expect((await pool.query('SELECT 1 FROM environment_memberships WHERE user_id=$1',[other])).rowCount).toBe(0);
  });

  it('runs candidate migrations without activating a server and fails closed on migration errors', async () => {
    const run=()=>spawnSync(process.execPath,['--import','tsx','scripts/run-migrations.ts'],{encoding:'utf8',env:{...process.env,DATABASE_URL:url+'?sslmode=disable',NODE_ENV:'development',MIGRATION_SECRET:'fixture-migration-only',DOTENV_CONFIG_QUIET:'true'}});
    const clean=run();
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('0 applied');
    await pool.query('DELETE FROM _migrations WHERE name=$1',[MIGRATIONS.at(-1)!.name]);
    try {
      const failed=run();
      expect(failed.status).not.toBe(0);
      expect(failed.stderr).toContain('release was not activated');
      expect(failed.stdout+failed.stderr).not.toContain('fixture-migration-only');
      expect((await pool.query("SELECT confdeltype FROM pg_constraint WHERE conname='api_keys_created_by_user_id_fkey'")).rows[0].confdeltype).toBe('n');
    } finally { await pool.query('INSERT INTO _migrations (name) VALUES ($1)',[MIGRATIONS.at(-1)!.name]); }
  });
});
