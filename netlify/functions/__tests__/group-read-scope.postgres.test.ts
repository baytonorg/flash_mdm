// @vitest-environment node
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import pg from 'pg';
import {MIGRATIONS} from '../migrate.js';
import {closeDatabasePool} from '../_lib/db.js';
import {hashToken} from '../_lib/crypto.js';
import {cloneDefaultPermissionMatrix} from '../_lib/rbac-matrix.js';
import {clearWorkspacePermissionMatrixCache,clearEnvironmentPermissionMatrixCache,requireEnvironmentAccessScopeForResourcePermission} from '../_lib/rbac.js';
import {requireAuth} from '../_lib/auth.js';
import devices from '../device-list.js';
import groups from '../group-crud.js';
import policies from '../policy-crud.js';
import dashboard from '../dashboard-data.js';
import assignments from '../policy-assign.js';
const url=process.env.GROUP_READ_SCOPE_TEST_DATABASE_URL;
(url?describe:describe.skip)('group-only read scope with real PostgreSQL and public handlers',()=>{
 let pool:pg.Pool;let workspace:string,env:string,otherEnv:string,outside:string,foreignEnv:string,actor:string,owner:string,policy:string;
 let ids:Record<string,string>,deviceIds:Record<string,string>;
 const parents:Record<string,string|null>={parent:null,weak:'parent',inherited:'weak',regained:'inherited',low:null,high:null,plain:'parent'};
 const allowed=['parent','regained','high','plain'];
 const actorToken='inert-group-only-session',ownerToken='inert-owner-session';
 const request=(path:string,token=actorToken,bearer=false)=>new Request('http://localhost'+path,{headers:bearer?{authorization:'Bearer '+token}:{cookie:'flash_session='+token}});
 const scope=async(permission='read',resource='device')=>requireEnvironmentAccessScopeForResourcePermission(await requireAuth(request('/api/devices/list')),env,resource,permission as never);
 const getDevices=async(params:Record<string,string>={},token=actorToken,bearer=false)=>devices(request('/api/devices/list?'+new URLSearchParams({environment_id:env,...params}),token,bearer),{} as never);
 async function fingerprint(){return (await pool.query(`SELECT json_build_object('devices',(SELECT json_agg(d ORDER BY id) FROM devices d),'policies',(SELECT json_agg(p ORDER BY id) FROM policies p),'assignments',(SELECT json_agg(a ORDER BY id) FROM policy_assignments a),'groups',(SELECT json_agg(g ORDER BY id) FROM groups g),'memberships',(SELECT json_agg(m ORDER BY id) FROM group_memberships m),'jobs',(SELECT json_agg(j ORDER BY id) FROM job_queue j)) AS snapshot`)).rows[0].snapshot;}
 beforeAll(async()=>{
  const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/flash_group_read_scope_fixture')throw Error('Refusing non-disposable database');
  process.env.DATABASE_URL=url;process.env.NODE_ENV='development';pool=new pg.Pool({connectionString:url});for(const m of MIGRATIONS)await pool.query(m.sql);
 },30000);
 beforeEach(async()=>{
  await pool.query('TRUNCATE workspaces,users CASCADE');clearWorkspacePermissionMatrixCache();clearEnvironmentPermissionMatrixCache();
  [workspace,env,otherEnv,outside,foreignEnv,actor,owner,policy]=Array.from({length:8},()=>crypto.randomUUID());ids={};deviceIds={};
  const matrix=cloneDefaultPermissionMatrix();for(const resource of ['device','policy','group','environment'])matrix[resource].read='admin';
  await pool.query('INSERT INTO workspaces(id,name,settings) VALUES($1,$2,$3),($4,$5,$3)',[workspace,'Synthetic workspace',JSON.stringify({rbac:{permission_matrix:matrix}}),outside,'Synthetic outside']);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2),($3,$4)',[actor,'scoped@example.invalid',owner,'owner@example.invalid']);
  await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'owner','workspace'),($1,$3,'member','scoped')",[workspace,owner,actor]);
  await pool.query('INSERT INTO environments(id,workspace_id,name) VALUES($1,$2,$3),($4,$2,$5),($6,$7,$8)',[env,workspace,'Current',otherEnv,'Other',foreignEnv,outside,'Foreign']);
  for(const [user,token] of [[actor,actorToken],[owner,ownerToken]])await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '14 days')",[user,hashToken(token)]);
  await pool.query("INSERT INTO policies(id,environment_id,name,config) VALUES($1,$2,'Shared synthetic policy','{}')",[policy,env]);
  await pool.query("INSERT INTO policy_assignments(policy_id,scope_type,scope_id) VALUES($1,'environment',$2)",[policy,env]);
  for(const [name,parent] of Object.entries(parents)){
   ids[name]=crypto.randomUUID();await pool.query('INSERT INTO groups(id,environment_id,name,parent_group_id) VALUES($1,$2,$3,$4)',[ids[name],env,name,parent?ids[parent]:null]);
   let ancestor:string|null=name,depth=0;while(ancestor){await pool.query('INSERT INTO group_closures(ancestor_id,descendant_id,depth) VALUES($1,$2,$3)',[ids[ancestor],ids[name],depth++]);ancestor=parents[ancestor];}
   deviceIds[name]=crypto.randomUUID();await pool.query("INSERT INTO devices(id,environment_id,group_id,policy_id,amapi_name,name,manufacturer,state) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE')",[deviceIds[name],env,ids[name],policy,'inert-'+name,'Synthetic '+name,'Maker '+name]);
  }
  deviceIds.ungrouped=crypto.randomUUID();await pool.query("INSERT INTO devices(id,environment_id,policy_id,amapi_name,name,manufacturer,state) VALUES($1,$2,$3,'inert-ungrouped','Synthetic ungrouped','Maker ungrouped','ACTIVE')",[deviceIds.ungrouped,env,policy]);
  for(const [name,role] of [['parent','admin'],['weak','viewer'],['regained','admin'],['low','member'],['high','owner']])await pool.query('INSERT INTO group_memberships(group_id,user_id,role) VALUES($1,$2,$3)',[ids[name],actor,role]);
  ids.foreign=crypto.randomUUID();await pool.query("INSERT INTO groups(id,environment_id,name) VALUES($1,$2,'foreign')",[ids.foreign,foreignEnv]);await pool.query('INSERT INTO group_closures(ancestor_id,descendant_id,depth) VALUES($1,$1,0),($2,$1,1)',[ids.foreign,ids.parent]);
  await pool.query("INSERT INTO devices(environment_id,group_id,amapi_name,name,manufacturer,state) VALUES($1,$2,'inert-foreign','Synthetic foreign','Maker foreign','ACTIVE')",[foreignEnv,ids.foreign]);
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('Unexpected provider egress from read-only fixture')));
 });
 afterAll(async()=>{vi.unstubAllGlobals();await closeDatabasePool();await pool?.end();});
 it('chooses nearest grants before thresholding, including a weaker child and deeper re-grant',async()=>{
  const result=await scope();expect(result.mode).toBe('group');expect(result.role).toBe('owner');expect(new Set(result.accessible_group_ids)).toEqual(new Set(allowed.map(name=>ids[name])));
  const before=await fingerprint();await getDevices();expect(await fingerprint()).toEqual(before);expect(fetch).not.toHaveBeenCalled();
 });
 it('uses the same allowed set for device rows, facets, totals and explicit descendant selection',async()=>{
  const all=await(await getDevices()).json();expect(new Set(all.devices.map((d:{id:string})=>d.id))).toEqual(new Set(allowed.map(name=>deviceIds[name])));expect(all.pagination.total).toBe(4);expect(new Set(all.facets.manufacturers.map((m:{value:string})=>m.value))).toEqual(new Set(allowed.map(name=>'Maker '+name)));
  const parent=await(await getDevices({group_id:ids.parent})).json();expect(new Set(parent.devices.map((d:{id:string})=>d.id))).toEqual(new Set(['parent','plain','regained'].map(name=>deviceIds[name])));expect(parent.pagination.total).toBe(3);expect(parent.facets.manufacturers).toHaveLength(3);
  expect((await getDevices({group_id:ids.weak})).status).toBe(403);
  const page=await(await getDevices({per_page:'1',page:'2',manufacturer:'Maker regained'})).json();expect(page.pagination.total).toBe(1);expect(page.devices).toEqual([]);expect(page.facets.manufacturers).toHaveLength(4);
 });
 it('projects only visible groups and clears an excluded parent link in both list forms',async()=>{
  const list=await(await groups(request('/api/groups/list?environment_id='+env),{} as never)).json();expect(new Set(list.groups.map((g:{id:string})=>g.id))).toEqual(new Set(allowed.map(name=>ids[name])));expect(list.groups.find((g:{id:string})=>g.id===ids.regained)).toMatchObject({parent_id:null,parent_group_id:null});
  const descendants=await(await groups(request('/api/groups/descendants?group_id='+ids.parent),{} as never)).json();expect(new Set(descendants.groups.map((g:{id:string})=>g.id))).toEqual(new Set([ids.plain,ids.regained]));expect(descendants.descendants).toEqual(descendants.groups);expect(descendants.groups.find((g:{id:string})=>g.id===ids.regained)).toMatchObject({parent_id:null,parent_group_id:null});
 });
 it('restricts shared policy device counts and existing dashboard aggregates to the selected group set',async()=>{
  const before=await fingerprint();const listed=await(await policies(request('/api/policies/list?environment_id='+env),{} as never)).json();expect(listed.policies).toHaveLength(1);expect(listed.policies[0].device_count).toBe(4);
  const ownerList=await(await policies(request('/api/policies/list?environment_id='+env,ownerToken),{} as never)).json();expect(ownerList.policies[0].device_count).toBe(8);
  const summary=await(await dashboard(request('/api/dashboard/data?environment_id='+env),{} as never)).json();expect(summary.total_devices).toBe(4);expect(await fingerprint()).toEqual(before);expect(fetch).not.toHaveBeenCalled();
 });
 it('preserves independently qualifying direct environment and workspace-wide access',async()=>{
  expect((await(await getDevices({},ownerToken)).json()).pagination.total).toBe(8);
  await pool.query("INSERT INTO environment_memberships(environment_id,user_id,role) VALUES($1,$2,'admin')",[env,actor]);expect((await scope()).mode).toBe('environment');expect((await(await getDevices()).json()).pagination.total).toBe(8);
 });
 it('returns an empty selected group without borrowing unrelated rows or facets',async()=>{
  const empty=crypto.randomUUID();
  await pool.query("INSERT INTO groups(id,environment_id,name) VALUES($1,$2,'Empty permitted group')",[empty,env]);
  await pool.query('INSERT INTO group_closures(ancestor_id,descendant_id,depth) VALUES($1,$1,0)',[empty]);
  await pool.query("INSERT INTO group_memberships(group_id,user_id,role) VALUES($1,$2,'admin')",[empty,actor]);
  const response=await getDevices({group_id:empty});expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({devices:[],pagination:{total:0,total_pages:0},facets:{manufacturers:[]}});
  expect(fetch).not.toHaveBeenCalled();
 });
 it('uses the current resource threshold without filtering away a nearer weaker grant first',async()=>{
  await pool.query("UPDATE workspaces SET settings=jsonb_set(settings,'{rbac,permission_matrix,device,read}','\"viewer\"') WHERE id=$1",[workspace]);clearWorkspacePermissionMatrixCache();clearEnvironmentPermissionMatrixCache();
  expect(new Set((await scope()).accessible_group_ids)).toEqual(new Set(Object.keys(parents).map(name=>ids[name])));
  await pool.query("UPDATE workspaces SET settings=jsonb_set(settings,'{rbac,permission_matrix,device,read}','\"admin\"') WHERE id=$1",[workspace]);clearWorkspacePermissionMatrixCache();clearEnvironmentPermissionMatrixCache();
  await pool.query("INSERT INTO environment_memberships(environment_id,user_id,role) VALUES($1,$2,'viewer')",[env,actor]);expect(new Set((await scope()).accessible_group_ids)).toEqual(new Set(allowed.map(name=>ids[name])));
  await pool.query('DELETE FROM group_memberships WHERE user_id=$1 AND group_id<>$2',[actor,ids.weak]);expect((await getDevices()).status).toBe(403);
 });
 it('keeps independent key roles and tenant scope separate from stronger creator memberships',async()=>{
  for(const [name,role,keyWorkspace,keyEnv,kind] of [['weak','viewer',workspace,env,'environment'],['allowed','admin',workspace,env,'environment'],['wrong-environment','owner',workspace,otherEnv,'environment'],['wrong-workspace','owner',outside,null,'workspace']] as const)await pool.query('INSERT INTO api_keys(name,scope_type,workspace_id,environment_id,role,token_hash,token_enc,token_prefix,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[name,kind,keyWorkspace,keyEnv,role,hashToken('inert-'+name),'inert-unread-envelope','inert',owner]);
  expect((await getDevices({},'inert-weak',true)).status).toBe(403);expect((await(await getDevices({},'inert-allowed',true)).json()).pagination.total).toBe(8);expect((await getDevices({},'inert-wrong-environment',true)).status).toBe(403);expect((await getDevices({},'inert-wrong-workspace',true)).status).toBe(403);expect((await getDevices({environment_id:foreignEnv})).status).toBe(403);
 });
 it.runIf(process.env.GROUP_READ_SCOPE_BROWSER==='1')('renders scoped rows and counts in actual desktop and narrow pages without writes',async()=>{
  // Browser requests use loopback HTTP; server-side provider fetch remains
  // rejected by the fixture. No device detail/provider adapter is exercised.
  const before=await fingerprint();
  const {inspectGroupReadScope}=await import('../../../scripts/qa/group-read-scope-browser.mjs');
  await inspectGroupReadScope({handlers:{'/api/devices/list':devices,'/api/groups/':groups,'/api/policies/assignments':assignments,'/api/policies/list':policies},session:actorToken,environment:env,otherEnvironment:foreignEnv,parent:ids.parent});
  expect(await fingerprint()).toEqual(before);expect(fetch).not.toHaveBeenCalled();
 },120000);
});
