// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
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
import traceHandler from '../operational-trace.js';
import { traceHttp, closeOperationalTrace } from '../_lib/operational-trace.js';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import registerHandler from '../auth-register.js';
import { requireEnvironmentLifecyclePermission } from '../_lib/scope-authority.js';
import startMagic from '../auth-magic-link-start.js';
import { sendEmail } from '../_lib/resend.js';
import verifyMagic from '../auth-magic-link-verify.js';
import loginHandler from '../auth-login.js';
import bindingHandler from '../environment-bind.js';
import { prepareAmapiCall } from '../_lib/amapi.js';
import { runWithAuditAuthContext } from '../_lib/request-auth-context.js';

vi.mock('../_lib/resend.js', async original => ({ ...await original<typeof import('../_lib/resend.js')>(), sendEmail: vi.fn() }));
vi.mock('../_lib/amapi.js', async original => ({ ...await original<typeof import('../_lib/amapi.js')>(), prepareAmapiCall: vi.fn() }));

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

  it('rejects stale superadmin snapshots after waiting for lifecycle authority',async()=>{
    const stale={authType:'session',user:{id:other,is_superadmin:true}} as AuthContext;
    await failure(changeMemberships({workspaceId:workspace,auth:stale,callerRole:'owner',ip:'',changes:[{userId:target,operation:'remove'}]}),403);
    await failure(deleteUserAccount({userId:target,actorUserId:other,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true,cancelPendingInvites:true}),403);
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

  it('protects diagnostic logs from normal users and keys and attributes browser evidence from the real session',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'flash-trace-auth-fixture-'));
    const ownerToken='fixture-owner-trace',targetToken='fixture-target-trace';
    for(const [id,token] of [[owner,ownerToken],[target,targetToken]])await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",[id,hashToken(token)]);
    const key=await fixtureKey({role:'owner'});
    process.env.FLASH_TRACE_DIR=directory;
    try{
      const request=(token:string,path='/api/superadmin/operational-trace')=>new Request('http://localhost'+path,{headers:{cookie:'flash_session='+token}});
      const admin=await traceHandler(request(ownerToken),{} as never);expect(admin.status).toBe(200);
      expect((await traceHandler(request(targetToken),{} as never)).status).toBe(403);
      expect((await traceHandler(new Request('http://localhost/api/superadmin/operational-trace',{headers:{authorization:'Bearer '+key.token}}),{} as never)).status).toBe(403);
      const bind = async (token?: string) => {
        const res = await traceHandler(new Request('http://localhost/api/activity', {
          method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest', ...(token ? { cookie: 'flash_session='+token } : {}) },
          body: JSON.stringify({ events: [] }),
        }), {} as never);
        expect(res.status).toBe(204);
        return res.headers.get('X-Flash-Activity-Binding')!;
      };
      const event=new Request('http://localhost/api/activity',{method:'POST',headers:{'X-Flash-Activity-Binding':await bind(targetToken),cookie:'flash_session='+targetToken,'content-type':'application/json','x-requested-with':'XMLHttpRequest'},body:JSON.stringify({events:[{kind:'navigation',route:'/policies',actor:{type:'human',id:owner},password:'fixture-never-log-this',client_time:'2026-11-03 (fixture-never-log-this)'}]})});
      expect((await traceHttp(event,()=>traceHandler(event,{} as never))).status).toBe(204);
      await closeOperationalTrace();
      const text=(await Promise.all((await readdir(directory)).filter(n=>n.endsWith('.ndjson')).map(n=>readFile(join(directory,n),'utf8')))).join('');
      expect(text).not.toContain('fixture-never-log-this');
      const navigation=text.trim().split('\n').map(l=>JSON.parse(l)).find(e=>e.event==='ui.navigation');
      expect(navigation.actor.id).toBe(target);expect(navigation.feature).toBe('policies');
      const anonymous=new Request('http://localhost/api/activity',{method:'POST',headers:{'X-Flash-Activity-Binding':await bind(),'content-type':'application/json','x-requested-with':'XMLHttpRequest'},body:JSON.stringify({events:[{kind:'invalid',route:'/login',actor:{type:'human',id:owner}}]})});
      expect((await traceHttp(anonymous,()=>traceHandler(anonymous,{} as never))).status).toBe(204);
      const malformed=new Request('http://localhost/api/activity',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest'},body:'null'});
      expect((await traceHandler(malformed,{} as never)).status).toBe(400);
    }finally{await closeOperationalTrace();delete process.env.FLASH_TRACE_DIR;await rm(directory,{recursive:true,force:true});}
  });

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


  async function fixtureSession(userId: string) {
    await pool.query("INSERT INTO sessions(user_id,workspace_id,environment_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [userId,workspace,env,hashToken('review-session')]);
    return {cookie:'flash_session=review-session','x-requested-with':'XMLHttpRequest','content-type':'application/json'};
  }

  it('denies implicit workspace and child owner promotion, including removal of a lower override',async()=>{
    await pool.query("UPDATE workspace_memberships SET role=CASE WHEN user_id=$1 THEN 'admin' ELSE 'owner' END WHERE user_id IN ($1,$2)",[other,target]);
    const headers=await fixtureSession(other);
    const edit=(extra:Record<string,unknown>)=>workspaceHandler(new Request('http://localhost/api/workspaces/users/access',{
      method:'PUT',headers,body:JSON.stringify({workspace_id:workspace,user_id:target,access_scope:'workspace',...extra}),
    }),{} as never);
    expect((await edit({workspace_role:'owner'})).status).toBe(403);
    expect((await edit({})).status).toBe(403);
    // Keeping an existing environment owner and group admin is a permitted no-op.
    expect((await edit({access_scope:'scoped',environment_ids:[env],group_ids:[group]})).status).toBe(200);
    // Removing the group admin constraint reveals the inherited environment owner.
    expect((await edit({access_scope:'scoped',environment_ids:[env]})).status).toBe(403);
    expect((await pool.query('SELECT role,access_scope FROM workspace_memberships WHERE user_id=$1',[target])).rows[0]).toEqual({role:'owner',access_scope:'scoped'});
  });

  it('rechecks deletion permission after waiting for a membership demotion',async()=>{
    const headers=await fixtureSession(target);
    const lock=await pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);
      const response=environmentHandler(new Request('http://localhost/api/environments/'+env,{method:'DELETE',headers}),{} as never);
      let waiting=false;
      for(let i=0;i<100 && !waiting;i++) {
        waiting=!!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM workspaces WHERE id = $1 FOR UPDATE%'")).rowCount;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,20));
      }
      await lock.query("UPDATE environment_memberships SET role='viewer' WHERE user_id=$1",[target]);
      await lock.query('COMMIT');
      expect(waiting).toBe(true);
      expect((await response).status).toBe(403);
      expect((await pool.query('SELECT 1 FROM environments WHERE id=$1',[env])).rowCount).toBe(1);
    } finally {await lock.query('ROLLBACK');lock.release();}
  });

  it('rolls an environment deletion back when the terminal audit fails',async()=>{
    const headers=await fixtureSession(owner);
    await pool.query("ALTER TABLE audit_log ADD CONSTRAINT fixture_terminal_audit CHECK(action <> 'environment.deleted') NOT VALID");
    try {
      const response=await environmentHandler(new Request('http://localhost/api/environments/'+env,{method:'DELETE',headers}),{} as never);
      expect(response.status).toBe(500);
      expect((await pool.query('SELECT 1 FROM environments WHERE id=$1',[env])).rowCount).toBe(1);
    } finally {await pool.query('ALTER TABLE audit_log DROP CONSTRAINT fixture_terminal_audit');}
  });

  it('reconciles a legacy direct policy when no scope assignment applies',async()=>{
    const f=await topologyFixture();
    await pool.query('UPDATE devices SET policy_id=$1 WHERE id=$2',[f.policy,f.device]);
    expect((await currentDevicePolicy(f.device))?.policy_id).toBe(f.fallback);
    await pool.query("DELETE FROM policy_assignments WHERE scope_type='environment'");
    expect((await currentDevicePolicy(f.device))?.policy_id).toBe(f.policy);
  });

  it('blocks unknown cascade columns on known offboarding tables',async()=>{
    await pool.query('ALTER TABLE policy_versions ADD COLUMN fixture_dependency uuid REFERENCES users(id) ON DELETE CASCADE');
    try {expect((await userDeletionPreflight(pool,target)).blockers.join(' ')).toContain('public.policy_versions');}
    finally {await pool.query('ALTER TABLE policy_versions DROP COLUMN fixture_dependency');}
  });

  async function registerFixture(email:string,extra:Record<string,unknown>) {
    vi.stubEnv('RESEND_API_KEY','synthetic-mail-adapter');
    try {
      return await registerHandler(new Request('http://localhost/api/auth/register',{method:'POST',
        headers:{'content-type':'application/json','x-forwarded-for':'127.0.0.1'},
        body:JSON.stringify({email,first_name:'Fixture',last_name:'User',...extra}),
      }),{} as never);
    } finally {vi.unstubAllEnvs();}
  }

  it('keeps signup-link accounts email-first even when the API caller supplies a password',async()=>{
    const email='claimed@fixture.invalid',password='syntheticpassphrasehere';
    await pool.query('TRUNCATE rate_limit_buckets');
    await pool.query("INSERT INTO signup_links(scope_type,scope_id,token_hash,allowed_domains) VALUES('workspace',$1,$2,ARRAY['fixture.invalid'])",[workspace,hashToken('fixture-registration')]);
    expect((await registerFixture('wrong@denied.invalid',{signup_link_token:'fixture-registration',password})).status).toBe(403);
    const registration=await runWithAuditAuthContext({
      authType:'api_key',
      user:{id:null,email:'api-key@fixture.invalid'},
      apiKey:{id:crypto.randomUUID(),name:'Unrelated fixture key',scope_type:'workspace',scope_id:workspace,workspace_id:workspace,environment_id:null,role:'owner',created_by_user_id:owner},
    },()=>registerFixture(email,{signup_link_token:'fixture-registration',password}));
    expect(registration.status).toBe(201);
    const login=await loginHandler(new Request('http://localhost/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest'},body:JSON.stringify({email,password})}),{} as never);
    expect(login.status).toBe(401);
    expect((await pool.query('SELECT 1 FROM magic_links WHERE used_at IS NULL AND email=$1',[email])).rowCount).toBe(1);
    expect((await pool.query(`SELECT a.action,a.workspace_id,a.actor_type,a.api_key_id,a.details->>'signup_link_id' AS signup_link_id
      FROM audit_log a JOIN users u ON u.id=a.user_id WHERE u.email=$1`,[email])).rows).toEqual([{
      action:'auth.register.signup_link',workspace_id:workspace,actor_type:'user',api_key_id:null,signup_link_id:expect.any(String),
    }]);
  });

  it('accepts exact-workspace legacy signup audit evidence but rejects unbound setup flags',async()=>{
    await pool.query('DELETE FROM environment_memberships WHERE user_id=$1',[target]);
    await pool.query('DELETE FROM group_memberships WHERE user_id=$1',[target]);
    await pool.query(`UPDATE users SET metadata=jsonb_build_object('needs_environment_setup',true) WHERE id=$1`,[target]);
    const evidence=(await pool.query(`INSERT INTO audit_log(workspace_id,user_id,action,details)
      VALUES(NULL,$1,'auth.register',$2) RETURNING id`,[target,{signup_link_id:crypto.randomUUID(),allow_environment_creation:true}])).rows[0].id;
    const session='fixture-legacy-setup-session';
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",[target,hashToken(session)]);
    const create=()=>environmentHandler(new Request('http://localhost/api/environments/create',{method:'POST',headers:{cookie:'flash_session='+session,'x-requested-with':'XMLHttpRequest','content-type':'application/json'},body:JSON.stringify({workspace_id:workspace,name:'Recovered setup fixture'})}),{} as never);
    expect((await create()).status).toBe(403);
    expect((await pool.query("SELECT 1 FROM environments WHERE name='Recovered setup fixture'")).rowCount).toBe(0);
    await pool.query('UPDATE audit_log SET workspace_id=$1 WHERE id=$2',[workspace,evidence]);
    expect((await create()).status).toBe(201);
    expect((await pool.query("SELECT role FROM environment_memberships em JOIN environments e ON e.id=em.environment_id WHERE em.user_id=$1 AND e.name='Recovered setup fixture'",[target])).rows[0].role).toBe('owner');
    expect((await pool.query("SELECT metadata->>'needs_environment_setup' AS pending FROM users WHERE id=$1",[target])).rows[0].pending).toBe('false');
  });

  it('consumes only the exact live platform offer before creating its new workspace',async()=>{
    await pool.query('TRUNCATE rate_limit_buckets');
    const email='platform@fixture.invalid';
    const register=(token:string)=>registerFixture(email,{redirect_path:'/invite/'+token,password:'syntheticpassphrasehere',workspace_name:'Fixture workspace'});
    await pool.query("INSERT INTO user_invites(workspace_id,email,token_hash,role,invited_by,expires_at,permissions) VALUES(NULL,$1,$2,'member',$3,now()+interval '1 day',$4)",[email,hashToken('genuine-offer'),owner,{invite_type:'platform_access'}]);
    expect((await register('wrong-offer')).status).toBe(403);
    await pool.query('UPDATE users SET is_superadmin=false WHERE id=$1',[owner]);
    expect((await register('genuine-offer')).status).toBe(409);
    expect((await pool.query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount).toBe(0);
    await pool.query('UPDATE users SET is_superadmin=true WHERE id=$1',[owner]);
    await pool.query('TRUNCATE rate_limit_buckets'); // Isolate the positive control from deliberate failed attempts.
    expect((await register('genuine-offer')).status).toBe(201);
    expect((await pool.query('SELECT status FROM user_invites WHERE email=$1',[email])).rows[0].status).toBe('accepted');
    const passwordLogin=()=>loginHandler(new Request('http://localhost/api/auth/login',{method:'POST',
      headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest'},body:JSON.stringify({email,password:'syntheticpassphrasehere'}),
    }),{} as never);
    expect((await passwordLogin()).status).toBe(401);
    await pool.query("INSERT INTO magic_links(token_hash,email,expires_at) VALUES($1,$2,now()+interval '1 minute')",[hashToken('synthetic-mail-link'),email]);
    expect((await verifyMagic(new Request('http://localhost/api/auth/magic-link-verify?token=synthetic-mail-link'),{} as never)).headers.has('set-cookie')).toBe(true);
    expect((await passwordLogin()).status).toBe(401);

  });

  it.each(['token','slug'])('rejects a rotated signup %s even if public settings stayed identical',async(kind)=>{
    await pool.query('TRUNCATE rate_limit_buckets');
    await pool.query("INSERT INTO signup_links(scope_type,scope_id,token_hash,slug) VALUES('workspace',$1,$2,'old-fixture')",[workspace,hashToken('fixture-before')]);
    const c=await pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock(1179404627,1936289387)');
      const started=new Date();
      const result=registerFixture('rotation@fixture.invalid',{signup_link_token:kind==='token'?'fixture-before':'old-fixture'});
      let waiting=false;
      for(let i=0;i<100 && !waiting;i++) {
        waiting=!!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE 'SELECT pg_try_advisory_lock(%' AND query_start >= $1 AND state='idle'",[started])).rowCount;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
      }
      await c.query("UPDATE signup_links SET token_hash=$1,slug='new-fixture' WHERE scope_id=$2",[hashToken('fixture-after'),workspace]);
      await c.query('SELECT pg_advisory_unlock(1179404627,1936289387)');
      expect(waiting).toBe(true);
      expect((await result).status).toBe(409);
      expect((await pool.query("SELECT 1 FROM users WHERE email='rotation@fixture.invalid'")).rowCount).toBe(0);
    } finally {await c.query('SELECT pg_advisory_unlock_all()');c.release();}
  });

  it('checks the confirmed enterprise and serialises replacement binding across a delayed remote delete',async()=>{
    const headers=await fixtureSession(owner);
    await pool.query("UPDATE environments SET enterprise_name='enterprises/old' WHERE id=$1",[env]);
    await pool.query("UPDATE workspaces SET gcp_project_id='fixture-project' WHERE id=$1",[workspace]);
    const send=(expected:string)=>bindingHandler(new Request('http://localhost/api/environments/bind',{method:'POST',headers,
      body:JSON.stringify({environment_id:env,action:'delete_enterprise',expected_enterprise_name:expected})}),{} as never);
    vi.mocked(prepareAmapiCall).mockReset();
    expect((await send('enterprises/stale')).status).toBe(409);
    expect(prepareAmapiCall).not.toHaveBeenCalled();
    let dispatchStarted!:()=>void,finish!:()=>void;
    const started=new Promise<void>(r=>dispatchStarted=r),gate=new Promise<void>(r=>finish=r);
    vi.mocked(prepareAmapiCall).mockResolvedValueOnce(async()=>{dispatchStarted();await gate;return {};});
    const response=send('enterprises/old');await started;
    const replace=pool.query("UPDATE environments SET enterprise_name='enterprises/new' WHERE id=$1",[env]);
    try {
      let waiting=false;
      for(let i=0;i<100 && !waiting;i++) {
        waiting=!!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE environments SET enterprise_name=%'")).rowCount;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
    } finally {finish();await replace;}
    expect((await response).status).toBe(200);
    expect((await pool.query('SELECT enterprise_name FROM environments WHERE id=$1',[env])).rows[0].enterprise_name).toBe('enterprises/new');
  });


  it('refuses a purge-wide credential confirmation and rolls back on terminal audit failure',async()=>{
    const headers=await fixtureSession(owner);
    const key=await fixtureKey({scope:'environment'});
    const send=()=>superadminHandler(new Request('http://localhost/api/superadmin/actions',{method:'POST',headers,
      body:JSON.stringify({action:'purge_data',target_id:workspace,params:{support_reason:'fixture',customer_notice_acknowledged:true,confirm_environment_access_cleanup:true}}),
    }),{} as never);
    expect((await send()).status).toBe(409);
    expect((await pool.query('SELECT 1 FROM api_keys WHERE id=$1',[key.id])).rowCount).toBe(1);
    await pool.query('DELETE FROM api_keys WHERE id=$1',[key.id]); // Disposable fixture only.
    await pool.query("ALTER TABLE audit_log ADD CONSTRAINT fixture_purge_audit CHECK(action <> 'superadmin.workspace.purged') NOT VALID");
    try {
      expect((await send()).status).toBe(500);
      expect((await pool.query('SELECT 1 FROM environments WHERE id=$1',[env])).rowCount).toBe(1);
    } finally {await pool.query('ALTER TABLE audit_log DROP CONSTRAINT fixture_purge_audit');}
  });

  it('serialises sign-in link issuance with account offboarding and email reuse',async()=>{
    const blocker=await pool.connect();
    await blocker.query('SELECT pg_advisory_lock(872113)');
    await pool.query("CREATE FUNCTION fixture_pause_identity_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(872113); RETURN OLD; END $$; CREATE TRIGGER fixture_pause_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION fixture_pause_identity_delete()");
    vi.stubEnv('RESEND_API_KEY','synthetic-mail-adapter'); vi.mocked(sendEmail).mockClear();
    try{
      const deletion=deleteUserAccount({userId:target,actorUserId:owner,ip:'',confirmationEmail:'target@fixture.invalid',endSessionsAndCredentials:true});
      async function waitForBlocked(pattern:string){
        for(let i=0;i<100;i++){
          if((await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE $1",[pattern])).rowCount)return;
          await new Promise(r=>setTimeout(r,15));
        }
        throw new Error('Expected a fixture query blocked on a lock');
      }
      await waitForBlocked('DELETE FROM users WHERE id%');
      const issuance=startMagic(new Request('http://localhost/api/auth/magic-link-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'target@fixture.invalid'})}),{} as never);
      // Original writer blocks at audit after already storing and sending the
      // link. The guarded writer waits on the user lock before inserting it.
      await waitForBlocked('%INSERT INTO%');
      await blocker.query('SELECT pg_advisory_unlock(872113)');
      await deletion;
      expect((await issuance).status).toBe(200);
      await pool.query("INSERT INTO users(email) VALUES('target@fixture.invalid')");
      expect(sendEmail).not.toHaveBeenCalled();
      expect((await pool.query("SELECT 1 FROM magic_links WHERE email='target@fixture.invalid'")).rowCount).toBe(0);
      // An older orphaned email-only link also cannot authenticate this successor.
      await pool.query("INSERT INTO magic_links(token_hash,email,created_at,expires_at) VALUES($1,'target@fixture.invalid',now()-interval '1 hour',now()+interval '1 minute')",[hashToken('synthetic-orphan')]);
      const verified=await verifyMagic(new Request('http://localhost/api/auth/magic-link-verify?token=synthetic-orphan'),{} as never);
      expect(verified.headers.has('set-cookie')).toBe(false);
    }finally{
      await blocker.query('SELECT pg_advisory_unlock_all()');blocker.release();
      await pool.query('DROP TRIGGER fixture_pause_delete ON users; DROP FUNCTION fixture_pause_identity_delete()');
      vi.unstubAllEnvs();
    }
  });

  it('rejects a key whose validity ends while a destructive transaction waits for its lock',async()=>{
    const key=await fixtureKey({scope:'environment',role:'owner'});
    const auth=await requireAuth(new Request('http://localhost/api/environments/'+env,{headers:{authorization:'Bearer '+key.token}}));
    await transaction(async client=>{
      // Fix the PostgreSQL transaction timestamp, then expire the synthetic key
      // strictly between transaction start and the subsequent authority check.
      const start=(await client.query('SELECT now() AS started')).rows[0].started;
      await pool.query("UPDATE api_keys SET expires_at=$2::timestamptz+interval '50 milliseconds' WHERE id=$1",[key.id,start]);
      await client.query('SELECT pg_sleep(0.08)');
      const snapshots=(await client.query('SELECT expires_at > now() AS originally_valid, expires_at > clock_timestamp() AS still_valid FROM api_keys WHERE id=$1',[key.id])).rows[0];
      expect(snapshots).toEqual({originally_valid:true,still_valid:false});
      await failure(requireEnvironmentLifecyclePermission(client,auth,env,'delete'),403);
    });
    await pool.query("INSERT INTO user_invites(workspace_id,email,role,token_hash,invited_by,permissions,expires_at) VALUES($1,'target@fixture.invalid','member','fixture-mixed-issuer',$2,$3,now()+interval '1 day')",
      [workspace,owner,{issuer_api_key_id:key.id}]);
    await failure(transaction(c=>applyInviteOffer(c,'fixture-mixed-issuer',target,'target@fixture.invalid')),409);
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
