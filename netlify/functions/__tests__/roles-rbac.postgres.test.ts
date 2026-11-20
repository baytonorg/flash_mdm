// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate.js';
import { closeDatabasePool } from '../_lib/db.js';
import { hashToken } from '../_lib/crypto.js';
import { clearEnvironmentPermissionMatrixCache, clearWorkspacePermissionMatrixCache } from '../_lib/rbac.js';
import { cloneDefaultPermissionMatrix } from '../_lib/rbac-matrix.js';
import handler from '../roles-rbac.js';
const url=process.env.ROLES_RBAC_TEST_DATABASE_URL;
(url?describe:describe.skip)('environment RBAC contract with real PostgreSQL and handlers',()=>{
 let pool:pg.Pool;
 const workspace=crypto.randomUUID(),other=crypto.randomUUID(),env=crypto.randomUUID(),sibling=crypto.randomUUID(),outside=crypto.randomUUID();
 const owner=crypto.randomUUID(),workspaceOwner=crypto.randomUUID(),member=crypto.randomUUID();
 const workspaceMatrix=cloneDefaultPermissionMatrix();workspaceMatrix.billing.billing_view='owner';
 const settings={flashagent:{openai_api_key_enc:'inert-fixture-envelope'},device_health:{stale_after_days:14},rbac:{permission_matrix:workspaceMatrix}};
 const features={assistant:{enabled:true},unrelated:{keep:true},rbac:{custom_label:'keep'}};
 beforeAll(async()=>{
  const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/flash_roles_rbac_fixture')throw Error('Refusing non-disposable database');
  process.env.DATABASE_URL=url;process.env.NODE_ENV='development';pool=new pg.Pool({connectionString:url});for(const m of MIGRATIONS)await pool.query(m.sql);
 },30000);
 afterAll(async()=>{await closeDatabasePool();await pool?.end();});
 beforeEach(async()=>{
  clearEnvironmentPermissionMatrixCache();clearWorkspacePermissionMatrixCache();
  await pool.query('TRUNCATE audit_log, workspaces, users CASCADE');
  for(const id of [owner,workspaceOwner,member]){await pool.query('INSERT INTO users(id,email) VALUES($1,$2)',[id,id+'@fixture.invalid']);await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",[id,hashToken('fixture-'+id)]);}
  await pool.query("INSERT INTO workspaces(id,name,settings) VALUES($1,'Fixture',$3),($2,'Outside',$3)",[workspace,other,settings]);
  await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'member','scoped'),($1,$3,'owner','workspace'),($1,$4,'member','workspace')",[workspace,owner,workspaceOwner,member]);
  await pool.query("INSERT INTO environments(id,workspace_id,name,enterprise_features) VALUES($1,$4,'Fixture',$6),($2,$4,'Sibling',$6),($3,$5,'Outside',$6)",[env,sibling,outside,workspace,other,features]);
  await pool.query("INSERT INTO environment_memberships(environment_id,user_id,role) VALUES($1,$2,'owner')",[env,owner]);
  await pool.query('INSERT INTO platform_settings(id,licensing_enabled) VALUES(1,true) ON CONFLICT(id) DO UPDATE SET licensing_enabled=true');
 });
 const call=(method:string,id=env,matrix?:unknown,user=owner,ws=workspace)=>handler(new Request('http://localhost/api/roles/rbac'+(method==='GET'||method==='DELETE'?'?workspace_id='+ws+(id?'&environment_id='+id:''):''),{method,headers:{cookie:'flash_session=fixture-'+user,'x-requested-with':'XMLHttpRequest','content-type':'application/json'},...(method==='PUT'?{body:JSON.stringify({workspace_id:ws,...(id?{environment_id:id}:{}),matrix})}:{})}),{} as never);
 const read=async()=>{const r=await call('GET');expect(r.status).toBe(200);return r.json();};
 const stored=async(id=env)=>(await pool.query('SELECT enterprise_features FROM environments WHERE id=$1',[id])).rows[0].enterprise_features;
 it('round-trips the actual scoped-owner GET matrix without workspace authority',async()=>{
  const before=await read();expect(before.view_scope).toBe('environment');expect(before.can_manage).toBe(true);expect(before.matrix.workspace).toBeUndefined();
  before.matrix.audit.read='member';const r=await call('PUT',env,before.matrix);expect(r.status).toBe(200);const body=await r.json();
  expect(body.matrix.audit.read).toBe('member');expect(body.matrix.workspace).toBeUndefined();expect(body.meta.resource_order).not.toContain('workspace');
  const saved=await stored();expect(saved.rbac.permission_matrix.workspace).toBeUndefined();expect(saved.rbac.custom_label).toBe('keep');expect(saved.assistant).toEqual(features.assistant);expect(saved.unrelated).toEqual(features.unrelated);
  expect((await pool.query('SELECT settings FROM workspaces WHERE id=$1',[workspace])).rows[0].settings).toEqual(settings);expect(await stored(sibling)).toEqual(features);
  expect((await read()).matrix.audit.read).toBe('member');expect((await pool.query("SELECT count(*)::int n FROM audit_log WHERE action='rbac.environment_permission_matrix.updated' AND environment_id=$1",[env])).rows[0].n).toBe(1);
 });
 it('accepts a legacy complete matrix but ignores its workspace resource',async()=>{
  const matrix=(await read()).matrix;matrix.workspace={arbitrary:'inert-ignored-value'};
  const r=await call('PUT',env,matrix);expect(r.status).toBe(200);expect((await r.json()).matrix.workspace).toBeUndefined();expect((await stored()).rbac.permission_matrix.workspace).toBeUndefined();
 });
 it('preserves workspace controls and their full schema',async()=>{
  const r=await call('GET','',undefined,workspaceOwner);expect(r.status).toBe(200);const body=await r.json();expect(body.matrix.workspace).toBeDefined();body.matrix.audit.read='member';
  expect((await call('PUT','',body.matrix,workspaceOwner)).status).toBe(200);expect((await pool.query('SELECT settings FROM workspaces WHERE id=$1',[workspace])).rows[0].settings.rbac.permission_matrix.workspace).toEqual(workspaceMatrix.workspace);
 });
 it('preserves inherited hidden billing even when an older client explicitly sends different values',async()=>{
  await pool.query('UPDATE platform_settings SET licensing_enabled=false WHERE id=1');const body=await read();expect(body.matrix.billing).toBeUndefined();body.matrix.audit.read='member';body.matrix.billing=cloneDefaultPermissionMatrix().billing;
  const r=await call('PUT',env,body.matrix);expect(r.status).toBe(200);const result=await r.json();expect(result.matrix.billing).toBeUndefined();expect(result.meta.resource_order).not.toContain('billing');expect(result.meta.resource_order).not.toContain('workspace');
  expect((await stored()).rbac.permission_matrix.billing).toEqual(workspaceMatrix.billing);
 });
 it('preserves an existing hidden billing override',async()=>{
  const matrix=cloneDefaultPermissionMatrix();matrix.billing.license_view='owner';await pool.query('UPDATE environments SET enterprise_features=jsonb_set(enterprise_features,\'{rbac,permission_matrix}\',$2) WHERE id=$1',[env,JSON.stringify(matrix)]);
  await pool.query('UPDATE platform_settings SET licensing_enabled=false WHERE id=1');const body=await read();expect((await call('PUT',env,body.matrix)).status).toBe(200);expect((await stored()).rbac.permission_matrix.billing.license_view).toBe('owner');
 });
 for(const kind of ['invalid-role','below-floor','unknown-resource','unknown-action','missing-resource','missing-action','old-policy-client'])it('rejects '+kind+' without a partial save',async()=>{
  const matrix=(await read()).matrix;
  if(kind==='invalid-role')matrix.audit.read='invalid';if(kind==='below-floor')matrix.policy.assign='viewer';if(kind==='unknown-resource')matrix.other={read:'viewer'};if(kind==='unknown-action')matrix.audit.other='viewer';if(kind==='missing-resource')delete matrix.device;if(kind==='missing-action')delete matrix.audit.read;if(kind==='old-policy-client')delete matrix.policy.assign;
  expect((await call('PUT',env,matrix)).status).toBe(kind==='old-policy-client'?409:400);expect(await stored()).toEqual(features);expect((await pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n).toBe(0);
 });
 it('enforces role and tenant denials',async()=>{
  const matrix=(await read()).matrix;expect((await call('PUT',env,matrix,member)).status).toBe(403);expect((await call('PUT',sibling,matrix)).status).toBe(403);expect((await call('PUT',outside,matrix,owner,workspace)).status).toBe(404);expect((await call('PUT',outside,matrix,owner,other)).status).toBe(403);
  expect(await stored()).toEqual(features);expect(await stored(sibling)).toEqual(features);expect(await stored(outside)).toEqual(features);
 });
 it('rolls the RBAC update back when primary audit persistence fails',async()=>{
  const matrix=(await read()).matrix;matrix.audit.read='member';matrix.workspace=cloneDefaultPermissionMatrix().workspace;
  await pool.query("CREATE FUNCTION fixture_rbac_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER fixture_rbac_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fixture_rbac_audit_failure()");
  try{expect((await call('PUT',env,matrix)).status).toBe(500);expect(await stored()).toEqual(features);expect((await pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n).toBe(0);}
  finally{await pool.query('DROP TRIGGER fixture_rbac_audit_failure ON audit_log;DROP FUNCTION fixture_rbac_audit_failure()');}
 });
 async function waitForLock(fragment:string) {
  for(let attempt=0;attempt<100;attempt++){
   const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1",['%'+fragment+'%']);if(r.rowCount)return;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error('Expected real PostgreSQL lock wait');
 }
 it('rereads hidden billing and unrelated RBAC metadata after a competing row edit',async()=>{
  await pool.query('UPDATE platform_settings SET licensing_enabled=false WHERE id=1');const matrix=(await read()).matrix;matrix.audit.read='member';
  const blocker=await pool.connect();await blocker.query('BEGIN');
  const concurrent=cloneDefaultPermissionMatrix();concurrent.billing.license_view='owner';
  try{
   await blocker.query("UPDATE environments SET enterprise_features=jsonb_set(jsonb_set(enterprise_features,'{rbac,custom_label}','\"concurrent label\"'),'{rbac,permission_matrix}',$2) WHERE id=$1",[env,JSON.stringify(concurrent)]);
   const request=call('PUT',env,matrix);await waitForLock('SELECT id, enterprise_features');await blocker.query('COMMIT');expect((await request).status).toBe(200);
   const saved=await stored();expect(saved.rbac.custom_label).toBe('concurrent label');expect(saved.rbac.permission_matrix.billing.license_view).toBe('owner');expect(saved.rbac.permission_matrix.audit.read).toBe('member');
  }finally{await blocker.query('ROLLBACK');blocker.release();}
 });
 it('rechecks a current owner grant after waiting for the workspace lifecycle lock',async()=>{
  const matrix=(await read()).matrix;const blocker=await pool.connect();await blocker.query('BEGIN');
  try{
   await blocker.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);await blocker.query("UPDATE environment_memberships SET role='member' WHERE environment_id=$1 AND user_id=$2",[env,owner]);
   const request=call('PUT',env,matrix);await waitForLock('SELECT id FROM workspaces');await blocker.query('COMMIT');expect((await request).status).toBe(403);expect(await stored()).toEqual(features);
  }finally{await blocker.query('ROLLBACK');blocker.release();}
 });
 it('does not audit success when an update affects no row',async()=>{
  const matrix=(await read()).matrix;
  await pool.query("CREATE FUNCTION fixture_rbac_no_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER fixture_rbac_no_update BEFORE UPDATE ON environments FOR EACH ROW EXECUTE FUNCTION fixture_rbac_no_update()");
  try{expect((await call('PUT',env,matrix)).status).toBe(409);expect(await stored()).toEqual(features);expect((await pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n).toBe(0);}
  finally{await pool.query('DROP TRIGGER fixture_rbac_no_update ON environments;DROP FUNCTION fixture_rbac_no_update()');}
 });

 it.skipIf(!process.env.RBAC_BROWSER)('uses the real editor, hooks and handlers in desktop and narrow Chrome',async()=>{
  const {inspectEnvironmentRbac}=await import('../../../scripts/qa/roles-rbac-browser.mjs');
  await inspectEnvironmentRbac({workspace,environment:env,user:owner,handler,
   verifySaved:async()=>{expect((await stored()).rbac.permission_matrix.audit.read).toBe('member');expect((await stored()).rbac.permission_matrix.workspace).toBeUndefined();expect((await pool.query('SELECT settings FROM workspaces WHERE id=$1',[workspace])).rows[0].settings).toEqual(settings);},
   verifyCleared:async()=>{expect((await stored()).rbac.permission_matrix).toBeUndefined();expect((await stored()).unrelated).toEqual(features.unrelated);}
  });
 },90000);

 it('rolls clear back when its primary audit fails',async()=>{
  const body=await read();body.matrix.audit.read='member';expect((await call('PUT',env,body.matrix)).status).toBe(200);const before=await stored();
  await pool.query("CREATE FUNCTION fixture_rbac_clear_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic clear audit failure'; END $$; CREATE TRIGGER fixture_rbac_clear_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fixture_rbac_clear_failure()");
  try{expect((await call('DELETE')).status).toBe(500);expect(await stored()).toEqual(before);expect((await pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n).toBe(1);}
  finally{await pool.query('DROP TRIGGER fixture_rbac_clear_failure ON audit_log;DROP FUNCTION fixture_rbac_clear_failure()');}
 });
 it('bounds a blocked save and returns a retryable conflict without writing',async()=>{
  const matrix=(await read()).matrix,blocker=await pool.connect();await blocker.query('BEGIN');
  try{await blocker.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);expect((await call('PUT',env,matrix)).status).toBe(409);expect(await stored()).toEqual(features);}
  finally{await blocker.query('ROLLBACK');blocker.release();}
 },10000);

 it('clears an override and returns the same environment-scoped schema',async()=>{
  const body=await read();body.matrix.audit.read='member';expect((await call('PUT',env,body.matrix)).status).toBe(200);
  const r=await call('DELETE');expect(r.status).toBe(200);const result=await r.json();expect(result.matrix.workspace).toBeUndefined();expect(result.meta.resource_order).not.toContain('workspace');expect(result.environment_has_override).toBe(false);
  expect((await stored()).rbac.custom_label).toBe('keep');expect((await read()).matrix.audit.read).toBe(workspaceMatrix.audit.read);
 });
});
