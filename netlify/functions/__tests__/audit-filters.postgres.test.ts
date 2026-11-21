// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import pg from 'pg';
import {MIGRATIONS} from '../migrate.js';
import {closeDatabasePool} from '../_lib/db.js';
import {hashToken} from '../_lib/crypto.js';
import {cloneDefaultPermissionMatrix} from '../_lib/rbac-matrix.js';
import {AUDIT_ACTION_FAMILIES,AUDIT_EXACT_ACTIONS} from '../../../shared/audit-actions.js';
import handler from '../audit-log.js';
const url=process.env.AUDIT_FILTER_TEST_DATABASE_URL;
const samples:Record<string,string>={devices:'device.enrolled',device_commands:'device.command.lock',policies:'policy.created',groups:'group.created',authentication:'auth.login',access:'rbac.permission_matrix.updated',flashi:'flashagent.chat',api_keys:'api_key.created',billing:'workspace_billing.entitlement.granted',enrolment:'signin_enrollment.code_verified',networks:'network.deployed',applications:'app.imported',lifecycle:'environment.enterprise_bound',workflows:'workflow.custom_audit',reports:'report.exported'};
(url?describe:describe.skip)('product audit action filters with real PostgreSQL and authorisation',()=>{
 let pool:pg.Pool;const workspace=crypto.randomUUID(),env=crypto.randomUUID(),sibling=crypto.randomUUID(),foreign=crypto.randomUUID(),outside=crypto.randomUUID(),owner=crypto.randomUUID(),member=crypto.randomUUID();
 const sessions={owner:'inert-audit-owner',member:'inert-audit-member'};
 const call=(params:Record<string,string>={},actor:'owner'|'member'='owner')=>handler(new Request('http://localhost/api/audit/log?'+new URLSearchParams({environment_id:env,...params}),{headers:{cookie:'flash_session='+sessions[actor]}}),{} as never);
 beforeAll(async()=>{
  const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/flash_audit_filter_fixture')throw Error('Refusing non-disposable database');
  process.env.DATABASE_URL=url;process.env.NODE_ENV='development';pool=new pg.Pool({connectionString:url});for(const m of MIGRATIONS)await pool.query(m.sql);
  const matrix=cloneDefaultPermissionMatrix();matrix.audit.read='viewer';matrix.audit.read_privileged='owner';
  await pool.query('INSERT INTO workspaces(id,name,settings) VALUES($1,$2,$3),($4,$5,$3)',[workspace,'Synthetic workspace',JSON.stringify({rbac:{permission_matrix:matrix}}),outside,'Other synthetic workspace']);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2),($3,$4)',[owner,'audit-owner@example.invalid',member,'audit-member@example.invalid']);
  await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'owner','workspace'),($1,$3,'member','workspace')",[workspace,owner,member]);
  await pool.query('INSERT INTO environments(id,workspace_id,name) VALUES($1,$2,$3),($4,$2,$5),($6,$7,$8)',[env,workspace,'Current',sibling,'Sibling',foreign,outside,'Foreign']);
  for(const [role,user] of [['owner',owner],['member',member]] as const)await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '14 days')",[user,hashToken(sessions[role])]);
  const actions=new Set([...Object.values(samples),...AUDIT_EXACT_ACTIONS.map(a=>a.action),'workspace.user_removed','workspace.user_role_changed','workspace.user_access_updated','workspace.user_removed_extra','device.enrolled_extra','device.command.reboot','device.bulk.lock','device.commander.lock','apiXkey.created','signin_enrollmentXcode_verified','future_product.action']);
  for(const action of actions)await pool.query("INSERT INTO audit_log(workspace_id,environment_id,actor_type,visibility_scope,action,resource_type) VALUES($1,$2,'system','standard',$3,'synthetic')",[workspace,env,action]);
  for(const [w,e,visibility] of [[workspace,env,'privileged'],[workspace,sibling,'standard'],[outside,foreign,'standard']] as const)await pool.query("INSERT INTO audit_log(workspace_id,environment_id,actor_type,visibility_scope,action,resource_type) VALUES($1,$2,'system',$3,'device.command.lock','synthetic')",[w,e,visibility]);
 },30000);
 afterAll(async()=>{await closeDatabasePool();await pool?.end();});
 it.each(AUDIT_ACTION_FAMILIES)('matches a current declared $id action without widening scope',async family=>{
  const response=await call({action_family:family.id},'member');expect(response.status).toBe(200);const body=await response.json();expect(body.entries.some((r:{action:string})=>r.action===samples[family.id])).toBe(true);expect(body.total).toBe(body.entries.length);for(const r of body.entries){expect(r.environment_id).toBe(env);expect(r.visibility_scope).toBe('standard');}
 });
 it('matches literal family boundaries, preserves exact equality and applies both predicates as an intersection',async()=>{
  const commands=await(await call({action_family:'device_commands'},'member')).json();expect(commands.total).toBe(3);expect(commands.entries.map((r:{action:string})=>r.action)).not.toContain('device.commander.lock');
  expect((await(await call({action_family:'api_keys'},'member')).json()).total).toBe(1);
  expect((await(await call({action_family:'enrolment'},'member')).json()).entries.map((r:{action:string})=>r.action)).not.toContain('signin_enrollmentXcode_verified');
  const enrolment=(await(await call({action_family:'enrolment'},'member')).json()).entries.map((r:{action:string})=>r.action);expect(enrolment).toContain('device.enrolled');expect(enrolment).not.toContain('device.enrolled_extra');
  const access=(await(await call({action_family:'access'},'member')).json()).entries.map((r:{action:string})=>r.action);for(const action of ['workspace.user_removed','workspace.user_role_changed','workspace.user_access_updated'])expect(access).toContain(action);expect(access).not.toContain('workspace.user_removed_extra');
  expect((await(await call({action:'device.command.lock'},'member')).json()).total).toBe(1);expect((await(await call({action:'device.lock'},'member')).json()).total).toBe(0);
  expect((await(await call({action:'device.command.lock',action_family:'policies'},'member')).json()).total).toBe(0);
  expect((await(await call({action:'future_product.action'},'member')).json()).total).toBe(1);
 });
 it('counts and paginates after standard/privileged and environment constraints',async()=>{
  const a=await(await call({action_family:'device_commands',per_page:'1',page:'1'},'member')).json(),b=await(await call({action_family:'device_commands',per_page:'1',page:'2'},'member')).json();expect(a.total).toBe(3);expect(b.total).toBe(3);expect(a.entries).toHaveLength(1);expect(b.entries).toHaveLength(1);expect(a.entries[0].id).not.toBe(b.entries[0].id);
  const privileged=await(await call({action_family:'device_commands'})).json();expect(privileged.total).toBe(4);expect(privileged.entries.filter((r:{visibility_scope:string})=>r.visibility_scope==='privileged')).toHaveLength(1);
  expect((await call({action_family:'device_commands',include_privileged:'true'},'member')).status).toBe(403);expect((await call({environment_id:foreign,action_family:'device_commands'},'member')).status).toBe(403);
 });
 it('rejects an unknown family without treating user input as a pattern',async()=>{expect((await call({action_family:'device%'})).status).toBe(400);expect((await call({action_family:"devices') OR true--"})).status).toBe(400);});
 it.runIf(process.env.AUDIT_FILTER_BROWSER==='1')('checks real desktop and narrow filter and error controls',async()=>{
  const {inspectAuditFilters}=await import('../../../scripts/qa/audit-filters-browser.mjs');
  await inspectAuditFilters({handler,session:sessions.owner,memberSession:sessions.member,environment:env,sibling,foreign,samples});
 },120000);
});
