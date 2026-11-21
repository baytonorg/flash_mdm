// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import pg from 'pg';
import {MIGRATIONS} from '../migrate.js';
import {runLicensingReconcile} from '../_lib/licensing-reconcile.js';
import {closeDatabasePool} from '../_lib/db.js';
import {sendEmail} from '../_lib/resend.js';
vi.mock('../_lib/resend.js',()=>({sendEmail:vi.fn().mockResolvedValue(undefined)}));
const url=process.env.LICENSING_NOTICE_TEST_DATABASE_URL;
(url?describe:describe.skip)('licensing notice meaning through the real PostgreSQL reconciler',()=>{
 let pool:pg.Pool;
 beforeAll(async()=>{
  const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/flash_licensing_notice_fixture')throw Error('Refusing non-disposable database');
  process.env.DATABASE_URL=url;process.env.NODE_ENV='development';pool=new pg.Pool({connectionString:url});for(const m of MIGRATIONS)await pool.query(m.sql);
 },30000);
 afterAll(async()=>{await closeDatabasePool();await pool?.end();});
 it('emits factual resolved guidance and preserves ongoing guidance, escaping and deduplication',async()=>{
  const w=crypto.randomUUID(),u=crypto.randomUUID();
  await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[w,'Synthetic <workspace>']);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2)',[u,'notice-owner@example.invalid']);
  await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'owner','workspace')",[w,u]);
  await pool.query('INSERT INTO workspace_licensing_settings(workspace_id,inherit_platform_free_tier,free_enabled,free_seat_limit) VALUES($1,false,false,0)',[w]);
  for(const name of ['Restored <seat>','Ongoing <seat>']){
   const e=crypto.randomUUID();await pool.query('INSERT INTO environments(id,name,workspace_id) VALUES($1,$2,$3)',[e,name,w]);
   await pool.query("INSERT INTO license_overage_cases(workspace_id,environment_id,started_at,phase) VALUES($1,$2,now()-interval '2 days','warn')",[w,e]);
   await pool.query("INSERT INTO devices(environment_id,amapi_name,state) VALUES($1,$2,'ACTIVE')",[e,'inert-'+e]);
   if(name.startsWith('Restored'))await pool.query("INSERT INTO environment_entitlements(workspace_id,environment_id,source,seat_count) VALUES($1,$2,'manual',1)",[w,e]);
  }
  const stats=await runLicensingReconcile({dryRun:false});expect(stats.notifications_sent).toBe(2);
  const messages=vi.mocked(sendEmail).mock.calls.map(([mail])=>mail);expect(messages).toHaveLength(2);
  const resolved=messages.find(mail=>mail.subject.includes('Overage resolved'))!;
  const ongoing=messages.find(mail=>mail.subject.includes('Overage day 1'))!;
  expect(resolved.html).toContain('Overage: <strong>0</strong>');
  expect(resolved.html).toContain("Current seat usage is within this environment's entitlement.");
  expect(resolved.html).not.toMatch(/purchase additional seats|reduce active devices|devices (?:are|have been) (?:restored|enabled)/i);
  expect(ongoing.html).toContain('Overage: <strong>1</strong>');expect(ongoing.html).toContain('Action required: purchase additional seats or reduce active devices to return to compliance.');
  for(const mail of messages){expect(mail.html).toContain('Synthetic &lt;workspace&gt;');expect(mail.html).toContain('&lt;seat&gt;');expect(mail.to).toBe('notice-owner@example.invalid');}
  expect((await pool.query('SELECT count(*)::int n FROM job_queue')).rows).toEqual([{n:0}]);
  expect((await pool.query('SELECT count(*)::int n FROM license_enforcement_actions')).rows).toEqual([{n:0}]);
  await runLicensingReconcile({dryRun:false});expect(sendEmail).toHaveBeenCalledTimes(2);
 });
});
