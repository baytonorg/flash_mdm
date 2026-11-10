// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate.js';
import { closeDatabasePool, transaction } from '../_lib/db.js';
import { requirePolicyAssignmentAuthority } from '../_lib/policy-assignment-authority.js';
import { requireAuth, type AuthContext } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission, requireGroupPermission, clearWorkspacePermissionMatrixCache } from '../_lib/rbac.js';
import { getPolicyAmapiContext } from '../_lib/policy-derivatives.js';
import { updateGroupLifecycle } from '../_lib/group-lifecycle.js';
import { runWithAuditAuthContext } from '../_lib/request-auth-context.js';
import handler from '../policy-assign.js';
vi.mock('../_lib/auth.js', async original => ({ ...await original<typeof import('../_lib/auth.js')>(), requireAuth: vi.fn() }));
// No production provider is called. Permissions, transactions, schema and audit
// are real, including handler mutations and denied-path rollback.
vi.mock('../_lib/policy-derivatives.js', () => ({ getPolicyAmapiContext: vi.fn().mockResolvedValue(null), assignPolicyToDeviceWithDerivative: vi.fn(), syncPolicyDerivativesForPolicy: vi.fn(), ensurePolicyDerivativeForScope: vi.fn(), listAffectedDevicesForPolicyContext: vi.fn() }));
const url = process.env.POLICY_ASSIGNMENT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('policy assignment current authority with PostgreSQL', () => {
  let pool: pg.Pool;
  const user = '11111111-1111-4111-8111-111111111111';
  const ws = '22222222-2222-4222-8222-222222222222';
  const env = '33333333-3333-4333-8333-333333333333';
  const parent = '44444444-4444-4444-8444-444444444444';
  const child = '55555555-5555-4555-8555-555555555555';
  const sibling = '66666666-6666-4666-8666-666666666666';
  const device = '77777777-7777-4777-8777-777777777777';
  const policy = '88888888-8888-4888-8888-888888888888';
  const rootDevice = '99999999-9999-4999-8999-999999999999';
  let auth: AuthContext;
  const post = (action: string, body: object) => handler(new Request('http://localhost/api/policies/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {} as never);
  const assign = (scope_type = 'group', scope_id = child, policy_id = policy) => post('assign', {scope_type, scope_id, policy_id});
  const unassign = (scope_type = 'group', scope_id = child) => post('unassign', {scope_type, scope_id});
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/flash_policy_assignment_fixture') throw new Error('Refusing a non-disposable assignment database');
    process.env.DATABASE_URL = url + '?application_name=flash_assignment_acceptance'; process.env.NODE_ENV = 'development';
    pool = new pg.Pool({ connectionString: url });
    for (const migration of MIGRATIONS) await pool.query(migration.sql);
  }, 30000);
  afterAll(async () => { await closeDatabasePool(); await pool?.end(); });
  beforeEach(async () => {
    vi.mocked(getPolicyAmapiContext).mockClear();
    clearWorkspacePermissionMatrixCache();
    await pool.query('TRUNCATE users, workspaces CASCADE');
    await pool.query("INSERT INTO users(id,email) VALUES($1,'operator@fixture.invalid')", [user]);
    await pool.query("INSERT INTO workspaces(id,name) VALUES($1,'Fixture')", [ws]);
    await pool.query("INSERT INTO users(id,email) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner@fixture.invalid')");
    await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner','workspace')",[ws]);
    await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'member','scoped')", [ws,user]);
    await pool.query("INSERT INTO environments(id,workspace_id,name) VALUES($1,$2,'Fixture')", [env,ws]);
    await pool.query("INSERT INTO groups(id,environment_id,name,parent_group_id) VALUES($1,$4,'Parent',NULL),($2,$4,'Child',$1),($3,$4,'Sibling',NULL)", [parent,child,sibling,env]);
    await pool.query('INSERT INTO group_closures VALUES($1,$1,0),($2,$2,0),($3,$3,0),($1,$2,1)', [parent,child,sibling]);
    await pool.query("INSERT INTO group_memberships(group_id,user_id,role) VALUES($1,$2,'admin')", [parent,user]);
    await pool.query("INSERT INTO devices(id,environment_id,group_id,amapi_name) VALUES($1,$3,$4,'fixture/device'),($2,$3,NULL,'fixture/root')", [device,rootDevice,env,child]);
    await pool.query("INSERT INTO policies(id,environment_id,name,config) VALUES($1,$2,'Fixture','{}')", [policy,env]);
    auth = {authType:'session',sessionId:null,user:{id:user,email:'operator@fixture.invalid',is_superadmin:false}} as AuthContext;
    vi.mocked(requireAuth).mockImplementation(async () => auth);
  });
  it('allows scoped ancestor Admin assignment and revert for its group and device, denies sibling/root/environment', async () => {
    for (const [type,id] of [['group',parent],['group',child],['device',device]]) { expect((await assign(type,id)).status).toBe(200); expect((await unassign(type,id)).status).toBe(200); }
    for (const [type,id] of [['group',sibling],['device',rootDevice],['environment',env]]) { expect((await assign(type,id)).status).toBe(403); expect((await unassign(type,id)).status).toBe(403); }
  });
  it.each(['member','viewer'])('denies %s group role, retaining denial audit after rollback', async role => {
    await pool.query('UPDATE group_memberships SET role=$1', [role]);
    expect((await assign()).status).toBe(403);
    expect((await unassign()).status).toBe(403);
    expect((await pool.query('SELECT 1 FROM policy_assignments')).rowCount).toBe(0);
    expect(getPolicyAmapiContext).not.toHaveBeenCalled();
    const audit = await pool.query("SELECT details FROM audit_log WHERE action='policy.assignment_denied'");
    expect(audit.rowCount).toBe(2); expect(JSON.stringify(audit.rows)).not.toContain(policy);
  });
  it('exposes the original Group Member fallback as a negative control',async()=>{
    await pool.query("UPDATE group_memberships SET role='member'");
    await requireGroupPermission(auth,child,'write');
    expect((await assign()).status).toBe(403);
    expect(getPolicyAmapiContext).not.toHaveBeenCalled();
  });
  it('exposes the original environment Member permission as a negative control, then denies assignment', async () => {
    await pool.query("INSERT INTO environment_memberships(environment_id,user_id,role) VALUES($1,$2,'member')", [env,user]);
    await requireEnvironmentResourcePermission(auth,env,'policy','write');
    expect((await assign('environment',env)).status).toBe(403);
    expect((await unassign('environment',env)).status).toBe(403);
  });
  it('allows environment Admin despite a nearest group Member, but nearest Member shadows group-only ancestor Admin', async () => {
    await pool.query("INSERT INTO group_memberships(group_id,user_id,role) VALUES($1,$2,'member')", [child,user]);
    expect((await assign()).status).toBe(403);
    await pool.query("INSERT INTO environment_memberships(environment_id,user_id,role) VALUES($1,$2,'admin')", [env,user]);
    expect((await assign()).status).toBe(200);
    expect((await unassign()).status).toBe(200);
  });
  it('honours direct environment Member before workspace Admin and scoped workspace does not grant global authority', async () => {
    expect((await assign('environment',env)).status).toBe(403);
    await pool.query("UPDATE workspace_memberships SET role='admin',access_scope='workspace' WHERE user_id=$1",[user]);
    expect((await assign('environment',env)).status).toBe(200);
    await pool.query("INSERT INTO environment_memberships(environment_id,user_id,role) VALUES($1,$2,'member')", [env,user]);
    expect((await unassign('environment',env)).status).toBe(403);
  });
  it('returns identical absent/foreign policy responses after target authorisation', async () => {
    const foreign = crypto.randomUUID(), otherEnv = crypto.randomUUID();
    await pool.query("INSERT INTO environments(id,workspace_id,name) VALUES($1,$2,'Other')", [otherEnv,ws]);
    await pool.query("INSERT INTO policies(id,environment_id,name) VALUES($1,$2,'Other')", [foreign,otherEnv]);
    const absent = await assign('group',child,crypto.randomUUID()), outside = await assign('group',child,foreign);
    expect(absent.status).toBe(404); expect(outside.status).toBe(404); expect(await absent.text()).toBe(await outside.text());
    const denials=(await pool.query("SELECT details FROM audit_log WHERE action='policy.assignment_denied'")).rows;
    expect(denials).toHaveLength(2);expect(denials[0]).toEqual(denials[1]);expect(JSON.stringify(denials)).not.toContain(foreign);
    await pool.query("UPDATE group_memberships SET role='member'");
    expect((await assign('group',child,foreign)).status).toBe(403);
  });
  it('audits denied clear-direct-assignment alternate control after transaction rollback',async()=>{
    await assign();await pool.query("UPDATE group_memberships SET role='member'");
    await expect(updateGroupLifecycle({auth,groupId:child,clearDirectAssignments:true,ip:''})).rejects.toBeInstanceOf(Response);
    expect((await pool.query('SELECT 1 FROM policy_assignments')).rowCount).toBe(1);
    expect((await pool.query("SELECT details->>'operation' AS operation FROM audit_log WHERE action='policy.assignment_denied'")).rows).toEqual([{operation:'clear_direct_assignments'}]);
  });
  it('preserves all lock provenance on ordinary reassign, and rejects stale lock-panel versions without changing intent', async () => {
    expect((await assign()).status).toBe(200);
    const original = (await pool.query('SELECT md5(row_to_json(pa)::text) AS version FROM policy_assignments pa')).rows[0];
    expect((await post('locks',{scope_type:'group',scope_id:child,policy_id:policy,locked:true,locked_sections:['cameraDisabled'],expected_version:original.version})).status).toBe(200);
    const before = (await pool.query('SELECT *,md5(row_to_json(pa)::text) AS assignment_version FROM policy_assignments pa')).rows[0];
    expect((await assign()).status).toBe(200);
    const after = (await pool.query('SELECT * FROM policy_assignments')).rows[0];
    for (const key of ['locked','locked_sections','locked_by','locked_at']) expect(after[key]).toEqual(before[key]);
    const lockBody = {scope_type:'group',scope_id:child,policy_id:policy,locked:false,locked_sections:[],expected_version:before.assignment_version};
    expect((await post('locks',lockBody)).status).toBe(409);
    const current = (await pool.query('SELECT md5(row_to_json(pa)::text) AS version FROM policy_assignments pa')).rows[0];
    expect((await post('locks',{...lockBody,expected_version:current.version})).status).toBe(200);
    expect((await pool.query('SELECT policy_id,locked FROM policy_assignments')).rows[0]).toEqual({policy_id:policy,locked:false});
  });
  it('rejects an old browser lock save through assign instead of resurrecting stale policy intent',async()=>{
    await assign();const before=(await pool.query('SELECT * FROM policy_assignments')).rows;
    expect((await post('assign',{scope_type:'group',scope_id:child,policy_id:policy,locked:false,locked_sections:[]})).status).toBe(409);
    expect((await pool.query('SELECT * FROM policy_assignments')).rows).toEqual(before);
    expect(getPolicyAmapiContext).toHaveBeenCalledTimes(1);
  });
  it('allows Admin lock editing with Owner assignment floor while denying reassignment', async () => {
    await assign();
    await pool.query(`UPDATE environments SET enterprise_features='{"rbac":{"permission_matrix":{"policy":{"assign":"owner"}}}}'`);
    expect((await assign()).status).toBe(403);
    const current = (await pool.query('SELECT md5(row_to_json(pa)::text) AS version FROM policy_assignments pa')).rows[0];
    expect((await post('locks',{scope_type:'group',scope_id:child,policy_id:policy,locked:true,locked_sections:[],expected_version:current.version})).status).toBe(200);
  });
  it('rereads demoted authority after waiting for the shared membership lifecycle lock', async () => {
    const blocker = await pool.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[ws]);
    const pending = assign();
    await waitForBlockedMutation();
    await blocker.query("UPDATE group_memberships SET role='member'");
    await blocker.query('COMMIT'); blocker.release();
    expect((await pending).status).toBe(403);
    expect((await pool.query('SELECT 1 FROM policy_assignments')).rowCount).toBe(0);
  });
  async function waitForBlockedMutation() {
    for(let attempt=0;attempt<100;attempt++) {
      const waiting=await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='flash_assignment_acceptance' AND wait_event_type='Lock'");
      if(waiting.rowCount)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('Mutation never reached its expected lock wait');
  }
  it('rereads a tightened environment matrix after its row lock is released',async()=>{
    const blocker=await pool.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM environments WHERE id=$1 FOR UPDATE',[env]);
    const pending=assign(); await waitForBlockedMutation();
    await blocker.query(`UPDATE environments SET enterprise_features='{"rbac":{"permission_matrix":{"policy":{"assign":"owner"}}}}' WHERE id=$1`,[env]);
    await blocker.query('COMMIT');blocker.release();
    expect((await pending).status).toBe(403);
  });
  it('rereads device group after a concurrent move leaves the authorised subtree',async()=>{
    const blocker=await pool.connect();await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[ws]);
    const pending=assign('device',device);await waitForBlockedMutation();
    await blocker.query('UPDATE devices SET group_id=$1 WHERE id=$2',[sibling,device]);
    await blocker.query('COMMIT');blocker.release();
    expect((await pending).status).toBe(403);
    expect((await pool.query('SELECT policy_id FROM devices WHERE id=$1',[device])).rows[0].policy_id).toBeNull();
  });
  it('rolls assignment and device compatibility state back when success audit fails',async()=>{
    await pool.query(`CREATE FUNCTION assignment_fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER assignment_fixture_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION assignment_fixture_audit_failure()`);
    try {
      await expect(assign('device',device)).rejects.toThrow('fixture audit failure');
      expect((await pool.query('SELECT 1 FROM policy_assignments')).rowCount).toBe(0);
      expect((await pool.query('SELECT policy_id FROM devices WHERE id=$1',[device])).rows[0].policy_id).toBeNull();
      expect(getPolicyAmapiContext).not.toHaveBeenCalled();
    } finally {await pool.query('DROP TRIGGER assignment_fixture_audit_failure ON audit_log; DROP FUNCTION assignment_fixture_audit_failure()');}
  });
  it('does not use a cached matrix after an Owner tightening', async () => {
    await requireEnvironmentResourcePermission(auth,env,'policy','read').catch(() => undefined);
    await pool.query(`UPDATE workspaces SET settings='{"rbac":{"permission_matrix":{"policy":{"assign":"owner"}}}}'`);
    expect((await assign()).status).toBe(403);
  });
  it.each(['workspace','environment'])('uses current %s API key role and scope, ignoring creator superadmin', async scope => {
    const id=crypto.randomUUID(); await pool.query('UPDATE users SET is_superadmin=true');
    await pool.query("INSERT INTO api_keys(id,name,scope_type,workspace_id,environment_id,role,token_hash,token_enc,token_prefix,created_by_user_id) VALUES($1,'Synthetic fixture',$2,$3,$4,'member',$5,'synthetic','synthetic',$6)",[id,scope,ws,scope==='environment'?env:null,id.replaceAll('-',''),user]);
    auth={authType:'api_key',user:{id:null,is_superadmin:true},apiKey:{id,role:'owner'}} as AuthContext;
    expect((await runWithAuditAuthContext({...auth,user:{id:null,email:'synthetic@fixture.invalid'},apiKey:{...auth.apiKey!,name:'fixture',scope_type:scope as 'workspace'|'environment',scope_id:ws,workspace_id:ws,environment_id:scope==='environment'?env:null,role:'owner',created_by_user_id:user,created_by_email:'excluded@fixture.invalid'}},()=>assign())).status).toBe(403);
    const denial=(await pool.query("SELECT user_id,api_key_id,details FROM audit_log WHERE action='policy.assignment_denied' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(denial.user_id).toBeNull();expect(denial.api_key_id).toBe(id);expect(JSON.stringify(denial.details)).not.toContain('excluded');expect(denial.details).not.toHaveProperty('auth_context');
    await pool.query("UPDATE api_keys SET role='admin' WHERE id=$1",[id]);
    expect((await assign()).status).toBe(200); expect((await unassign()).status).toBe(200);
    await pool.query("UPDATE api_keys SET expires_at=now()-interval '1 hour' WHERE id=$1",[id]);
    await expect(transaction(c=>requirePolicyAssignmentAuthority(c,auth,{scope_type:'group',scope_id:child}))).rejects.toBeInstanceOf(Response);
    await pool.query("UPDATE api_keys SET expires_at=NULL,revoked_at=now() WHERE id=$1",[id]);
    expect((await assign()).status).toBe(403);
    await pool.query("UPDATE api_keys SET revoked_at=NULL,workspace_id=$2 WHERE id=$1",[id,ws]);
    const otherWs=crypto.randomUUID();await pool.query("INSERT INTO workspaces(id,name) VALUES($1,'Outside fixture')",[otherWs]);
    await pool.query('UPDATE api_keys SET workspace_id=$2 WHERE id=$1',[id,otherWs]);
    expect((await assign()).status).toBe(403);
  });
  it('denies an API key that expires while its authorised request waits for the policy row',async()=>{
    const id=crypto.randomUUID();
    await pool.query("INSERT INTO api_keys(id,name,scope_type,workspace_id,environment_id,role,token_hash,token_enc,token_prefix,created_by_user_id,expires_at) VALUES($1,'Synthetic expiring fixture','environment',$2,$3,'admin',$4,'synthetic','synthetic',$5,clock_timestamp()+interval '2 seconds')",[id,ws,env,id.replaceAll('-',''),user]);
    auth={authType:'api_key',user:{id:null,is_superadmin:false},apiKey:{id,role:'admin'}} as AuthContext;
    const blocker=await pool.connect();await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM policies WHERE id=$1 FOR UPDATE',[policy]);
    const pending=assign('device',device);
    try {
      await waitForBlockedMutation();
      // Confirm the request has already passed key authority and reached the
      // policy lock, then wait on PostgreSQL's clock rather than a guessed sleep.
      const blocked=(await pool.query("SELECT query FROM pg_stat_activity WHERE application_name='flash_assignment_acceptance' AND wait_event_type='Lock'")).rows;
      expect(blocked.some(row=>row.query.includes('SELECT id FROM policies'))).toBe(true);
      for(let attempt=0;attempt<400;attempt++) {
        if((await pool.query('SELECT expires_at<=clock_timestamp() AS expired FROM api_keys WHERE id=$1',[id])).rows[0].expired)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect((await pool.query('SELECT expires_at<=clock_timestamp() AS expired FROM api_keys WHERE id=$1',[id])).rows[0].expired).toBe(true);
    } finally {await blocker.query('COMMIT');blocker.release();}
    expect((await pending).status).toBe(403);
    expect((await pool.query('SELECT 1 FROM policy_assignments')).rowCount).toBe(0);
    expect((await pool.query('SELECT policy_id FROM devices WHERE id=$1',[device])).rows[0].policy_id).toBeNull();
    expect(getPolicyAmapiContext).not.toHaveBeenCalled();
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='policy.assignment_denied' AND api_key_id=$1",[id])).rowCount).toBe(1);
  });
});
