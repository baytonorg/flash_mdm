// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import pg from 'pg';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MIGRATIONS} from '../migrate.js';
import {transaction,withClient,closeDatabasePool} from '../_lib/db.js';
import {logAudit} from '../_lib/audit.js';
import {traceHttp,setTraceActor,closeOperationalTrace,type TraceActor} from '../_lib/operational-trace.js';
import {buildTraceReport} from '../_lib/trace-reader.js';
import {traceWindowBounds,writeTraceCheckpoint,traceComparisons} from '../_lib/trace-checkpoints.js';
const url=process.env.TRANSACTION_AUDIT_TRACE_TEST_DATABASE_URL;
(url?describe:describe.skip)('committed audit receipts with actual PostgreSQL and trace reader',()=>{
 let pool:pg.Pool,directory:string,user:string;
 const request=new Request('http://localhost/api/groups/create',{method:'POST'});
 const action=(client?:pg.PoolClient,label='group.created',actor_type:'user'|'system'='user')=>logAudit({user_id:actor_type==='user'?user:undefined,actor_type,action:label},client);
 const run=async(fn:()=>Promise<unknown>,actor:TraceActor={type:'human',id:user})=>traceHttp(request,async()=>{setTraceActor(actor);await fn();return Response.json({ok:true});});
 async function rows(){const files=(await readdir(directory)).filter(n=>n.endsWith('.ndjson'));return(await Promise.all(files.map(n=>readFile(join(directory,n),'utf8')))).flatMap(s=>s.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)));}
 async function report(){await closeOperationalTrace();return buildTraceReport(directory,new Date(Date.now()-86400000),new Date(Date.now()+60000));}
 const durable=(r:Awaited<ReturnType<typeof buildTraceReport>>)=>r.actors.reduce((n,a)=>n+Object.values(a.actions).reduce((m,v)=>m+v,0),0);
 beforeAll(async()=>{const u=new URL(url!);if(u.hostname!=='127.0.0.1'||u.pathname!=='/flash_transaction_audit_trace_fixture')throw Error('Refusing non-disposable database');process.env.DATABASE_URL=url;process.env.NODE_ENV='development';pool=new pg.Pool({connectionString:url});for(const m of MIGRATIONS)await pool.query(m.sql);});
 beforeEach(async()=>{await pool.query('TRUNCATE workspaces,users,audit_log CASCADE');user=crypto.randomUUID();await pool.query('INSERT INTO users(id,email) VALUES($1,$2)',[user,'audit-receipt@example.invalid']);directory=await mkdtemp(join(tmpdir(),'flash-audit-receipt-'));process.env.FLASH_TRACE_DIR=directory;process.env.FLASH_TRACE_COMPONENT='web';vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('No provider egress permitted')));});
 afterEach(async()=>{await closeOperationalTrace();delete process.env.FLASH_TRACE_DIR;delete process.env.FLASH_TRACE_COMPONENT;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();await rm(directory,{recursive:true,force:true});});
 afterAll(async()=>{await closeDatabasePool();await pool.end();});
 it('counts autocommit and two identical committed labels as three distinct durable actions',async()=>{
  await run(async()=>{await action();await transaction(async c=>{await action(c);await action(c);});});
  expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(3);const r=await report();expect(durable(r)).toBe(3);expect(r.totals.active_humans).toBe(1);expect(r.coverage.unconfirmed_audit_attempts).toBe(0);expect(fetch).not.toHaveBeenCalled();
 });
 it('uses surviving rows across repeated and nested savepoints, releases and replacement writes',async()=>{
  await run(()=>transaction(async c=>{await action(c,'group.created');await c.query('SAVEPOINT same');await action(c,'group.deleted');await c.query('SAVEPOINT same');await action(c,'group.moved');await c.query('ROLLBACK TO SAVEPOINT same');await action(c,'group.updated');await c.query('RELEASE SAVEPOINT same');await c.query('ROLLBACK TO SAVEPOINT same');await action(c,'policy.created');await c.query('RELEASE SAVEPOINT same');}));
  expect((await pool.query('SELECT action FROM audit_log ORDER BY created_at,id')).rows.map(r=>r.action).sort()).toEqual(['group.created','policy.created']);const r=await report();expect(durable(r)).toBe(2);expect(r.actors.find(a=>a.actor.id===user)?.actions).toEqual({'group.created':1,'policy.created':1});expect(r.coverage.audit_verification_unconfirmed).toBe(3);
 });
 it('does not count an audit row explicitly removed before commit',async()=>{
  await run(()=>transaction(async c=>{await action(c);await c.query('DELETE FROM audit_log WHERE user_id=$1',[user]);}));expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(0);const r=await report();expect(durable(r)).toBe(0);expect(r.coverage.audit_verification_unconfirmed).toBe(1);
 });
 it('keeps an independently committed nested physical transaction when its outer transaction rolls back',async()=>{
  await expect(run(()=>transaction(async outer=>{await action(outer,'group.deleted');await transaction(inner=>action(inner,'group.created'));throw Error('Synthetic outer failure');}))).rejects.toThrow('Synthetic outer failure');expect((await pool.query('SELECT action FROM audit_log')).rows).toEqual([{action:'group.created'}]);expect(durable(await report())).toBe(1);
 });
 it('keeps concurrent and sequential transactions in one request separate',async()=>{
  await run(async()=>{await Promise.all([transaction(c=>action(c)),transaction(c=>action(c))]);await transaction(c=>action(c));});expect(durable(await report())).toBe(3);
 });
 it('does not count a swallowed SQL error whose COMMIT command tag is ROLLBACK',async()=>{
  const result=await run(()=>transaction(async c=>{await action(c);try{await c.query('SELECT 1/0');}catch{/* caller swallows */}return 'unchanged-product-result';}));expect(result.status).toBe(200);expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(0);expect(durable(await report())).toBe(0);
 });
 it('preserves a committed business result when diagnostic verification fails',async()=>{
  const original=pg.Client.prototype.query;let injected=false;
  vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:unknown[]){if(String(args[0]).startsWith('SELECT id FROM audit_log WHERE id = ANY')){injected=true;return Promise.reject(Error('Synthetic diagnostic failure')) as never;}return Reflect.apply(original,this,args);});
  let result:unknown;await run(async()=>{result=await transaction(async c=>{await action(c);return 'business-success';});});expect(result).toBe('business-success');expect(injected).toBe(true);expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(1);const r=await report();expect(durable(r)).toBe(0);expect(r.coverage.audit_verification_unconfirmed).toBe(1);expect((await transaction(c=>c.query('SELECT 42 AS value'))).rows[0].value).toBe(42);
 });
 it('discards a client when diagnostic rollback fails without changing the committed business result',async()=>{
  const original=pg.Client.prototype.query;let verifying=false,pid=0;
  vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:unknown[]){
   const sql=String(args[0]);if(sql.startsWith('SELECT id FROM audit_log WHERE id = ANY')){verifying=true;return Promise.reject(Error('Synthetic diagnostic failure')) as never;}
   if(verifying&&sql==='ROLLBACK')return Promise.reject(Error('Synthetic cleanup failure')) as never;
   return Reflect.apply(original,this,args);
  });
  const result=await transaction(async c=>{pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await action(c);return 'committed';});expect(result).toBe('committed');
  // release(true) closes the damaged connection instead of returning its open
  // diagnostic transaction to the pool. Independent pool observes its exit.
  for(let attempt=0;attempt<30;attempt++){if(!(await pool.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1',[pid])).rowCount)break;await new Promise(resolve=>setTimeout(resolve,10));}
  expect((await pool.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1',[pid])).rowCount).toBe(0);expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(1);
 });
 it('keeps a lost product COMMIT acknowledgement uncertain rather than claiming a rollback',async()=>{
  const original=pg.Client.prototype.query;let injected=false;
  vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:unknown[]){const result=Reflect.apply(original,this,args);if(!injected&&String(args[0])==='COMMIT'){injected=true;return Promise.resolve(result).then(()=>{throw Error('Synthetic lost COMMIT acknowledgement');}) as never;}return result;});
  await expect(run(()=>transaction(c=>action(c)))).rejects.toThrow('Synthetic lost COMMIT acknowledgement');expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(1);expect(durable(await report())).toBe(0);expect((await rows()).some(r=>r.event==='db.transaction.outcome_unknown')).toBe(true);
 });
 it('handles the supported legacy audit insert fallback with the same receipt proof',async()=>{
  await pool.query('ALTER TABLE audit_log DROP COLUMN api_key_id');
  try{await run(()=>transaction(c=>logAudit({user_id:user,action:'group.created'},c,{requirePersistence:true})));expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(1);expect(durable(await report())).toBe(1);}finally{await pool.query('ALTER TABLE audit_log ADD COLUMN api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL');}
 });
 it.each([false,true])('preserves a permitted INSERT-only or row-security role without adding RETURNING (RLS=%s)',async rls=>{
  const role='audit_receipt_'+crypto.randomUUID().replaceAll('-','');await pool.query('CREATE ROLE '+role+' NOLOGIN');await pool.query('GRANT USAGE ON SCHEMA public TO '+role);await pool.query('GRANT INSERT ON audit_log TO '+role);
  if(rls){await pool.query('GRANT SELECT(id) ON audit_log TO '+role);await pool.query('ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY');await pool.query('CREATE POLICY fixture_insert ON audit_log FOR INSERT TO '+role+' WITH CHECK(true)');}
  try{await run(()=>transaction(async c=>{await c.query('SET LOCAL ROLE '+role);await action(c);}));expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(1);const r=await report();expect(durable(r)).toBe(0);expect(r.coverage.unconfirmed_audit_attempts).toBe(1);}finally{if(rls){await pool.query('DROP POLICY fixture_insert ON audit_log');await pool.query('ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY');}await pool.query('DROP OWNED BY '+role);await pool.query('DROP ROLE '+role);}
 });
 it('recovers a failed capability probe before exactly one unchanged business insert, under same-client concurrency',async()=>{
  const original=pg.Client.prototype.query;let injected=false,inserts=0;
  vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:unknown[]){const sql=String(args[0]);if(/INSERT INTO audit_log/.test(sql))inserts++;if(!injected&&sql.includes('has_column_privilege')){injected=true;return Reflect.apply(original,this,['SELECT 1/0']);}return Reflect.apply(original,this,args);});
  await run(()=>transaction(c=>Promise.all([action(c,'group.created'),action(c,'policy.created'),c.query("INSERT INTO audit_log(action,actor_type) VALUES('group.updated','system')")])));
  expect(inserts).toBe(3);expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(3);expect(durable(await report())).toBe(1);
 });
 it('bounds stalled diagnostic acknowledgement, destroys the client and suppresses late commands and receipts',async()=>{
  const original=pg.Client.prototype.query;const commands:string[]=[];let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let heldBegin=false;
  vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:unknown[]){const sql=String(args[0]);commands.push(sql);const result=Reflect.apply(original,this,args);if(sql==='BEGIN READ ONLY'){heldBegin=true;return Promise.resolve(result).then(async value=>{await held;return value;}) as never;}return result;});
  const started=performance.now();try{expect(await transaction(async c=>{await action(c);return 'committed-before-diagnostics';})).toBe('committed-before-diagnostics');expect(heldBegin).toBe(true);expect(performance.now()-started).toBeLessThan(1000);const before=commands.length;release();await new Promise(resolve=>setTimeout(resolve,30));expect(commands.length).toBe(before);expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(1);const r=await report();expect(durable(r)).toBe(0);expect(r.coverage.audit_verification_unconfirmed).toBe(1);}finally{release();}
 });
 it('bounds the candidate set without truncating any business audit inserts',async()=>{
  await run(()=>transaction(async c=>{for(let i=0;i<514;i++)await action(c);}));expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(514);const r=await report();expect(durable(r)).toBe(512);expect(r.coverage.audit_verification_unconfirmed).toBe(2);
 },30000);
 it('does no survivor queries when tracing is disabled or no audit rows were inserted',async()=>{
  const original=pg.Client.prototype.query;let checks=0;vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:unknown[]){if(String(args[0]).startsWith('SELECT id FROM audit_log WHERE id = ANY'))checks++;return Reflect.apply(original,this,args);});
  delete process.env.FLASH_TRACE_DIR;await transaction(c=>action(c));process.env.FLASH_TRACE_DIR=directory;await run(()=>transaction(c=>c.query('SELECT 1')));expect(checks).toBe(0);
 });
 it.each([false,true])('drains accepted work before another lease reuses the connection (tracing=%s)',async enabled=>{
  await closeDatabasePool();if(!enabled)delete process.env.FLASH_TRACE_DIR;let firstPid=0,secondPid=0;
  await expect(withClient(async c=>{firstPid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await Promise.all([c.query('SELECT pg_sleep(0.05)'),c.query("INSERT INTO audit_log(action,actor_type) VALUES('group.updated','system')"),Promise.reject(Error('Synthetic independent failure'))]);})).rejects.toThrow('Synthetic independent failure');
  await withClient(async c=>{await c.query('BEGIN');secondPid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await c.query('ROLLBACK');});expect(secondPid).toBe(firstPid);expect((await pool.query("SELECT 1 FROM audit_log WHERE action='group.updated'")).rowCount).toBe(1);
 });
 it('rejects a new external command after a normally released lease',async()=>{
  let leased!:pg.PoolClient;await withClient(async c=>{leased=c;await c.query('SELECT 1');});await expect(leased.query("INSERT INTO audit_log(action) VALUES('group.deleted')")).rejects.toThrow('lease is closed');expect((await pool.query('SELECT id FROM audit_log')).rowCount).toBe(0);
 });
 it('leaves unmanaged clients unconfirmed rather than inferring durability from a request span',async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await run(()=>action(c));await c.query('COMMIT');}finally{c.release();}const r=await report();expect(durable(r)).toBe(0);expect(r.coverage.unconfirmed_audit_attempts).toBe(1);
 });
 it('preserves explicit system and immutable original human attribution across later identity changes',async()=>{
  const later=crypto.randomUUID();await run(()=>transaction(async c=>{await action(c);setTraceActor({type:'human',id:later});await action(c,'policy.created','system');}));const r=await report();expect(r.actors.find(a=>a.actor.id===user)?.actions).toEqual({'group.created':1});expect(r.actors.find(a=>a.actor.type==='system')?.actions).toEqual({'policy.created':1});expect(r.actors.find(a=>a.actor.id===later)?.meaningful_events??0).toBe(0);
 });
 it('does not promote a captured anonymous receipt to the human who authenticates later in the request',async()=>{
  await run(()=>transaction(async c=>{await action(c);setTraceActor({type:'human',id:crypto.randomUUID()});}),{type:'anonymous',id:user});const r=await report();expect(durable(r)).toBe(1);expect(r.totals.active_humans).toBe(0);expect(r.actors.find(a=>a.actor.type==='anonymous'&&a.actor.id===user)?.actions).toEqual({'group.created':1});
 });
 it('captures identity before a queued audit operation yields to a later request identity',async()=>{
  const later=crypto.randomUUID();await run(()=>transaction(async c=>{const pending=action(c);setTraceActor({type:'human',id:later});await pending;}));const r=await report();expect(r.actors.find(a=>a.actor.id===user)?.actions).toEqual({'group.created':1});expect(r.actors.find(a=>a.actor.id===later)?.meaningful_events??0).toBe(0);
 });
 it.each(['api_key','support','scheduled','webhook','anonymous'] as const)('does not count %s receipts as active humans',async type=>{
  await run(()=>transaction(c=>action(c)),{type,id:user});const r=await report();expect(durable(r)).toBe(1);expect(r.totals.active_humans).toBe(0);
 });
 it('excludes confidential action text, SQL values and database audit IDs from receipt records',async()=>{
  const secret='private-fixture-secret-label';await run(()=>transaction(c=>logAudit({user_id:user,action:secret,custom_workflow_action:true,details:{password:secret}},c)));const ids=(await pool.query('SELECT id FROM audit_log')).rows.map(r=>r.id);await closeOperationalTrace();const receipt=(await rows()).find(r=>r.event==='audit.committed');expect(receipt.data.action).toBe('workflow.custom_audit');expect(JSON.stringify(receipt)).not.toContain(secret);for(const id of ids)expect(JSON.stringify(receipt)).not.toContain(id);expect(fetch).not.toHaveBeenCalled();
 });
 it('omits device and group UUIDs, email and role from the complete receipt envelope',async()=>{
  const device=crypto.randomUUID(),group=crypto.randomUUID(),workspace=crypto.randomUUID(),environment=crypto.randomUUID();
  await traceHttp(new Request('http://localhost/api/devices/'+device+'?group_id='+group),async()=>{setTraceActor({type:'human',id:user,email:'private-display@example.invalid',role:'owner'},{workspace_id:workspace,environment_id:environment,device_id:device,group_id:group});await transaction(c=>action(c));return Response.json({ok:true});});await closeOperationalTrace();const receipt=(await rows()).find(r=>r.event==='audit.committed');expect(receipt.scope).toEqual({workspace_id:workspace,environment_id:environment});expect(receipt.actor).toEqual({type:'human',id:user});for(const value of [device,group,'private-display@example.invalid','owner'])expect(JSON.stringify(receipt)).not.toContain(value);
 });
 it('counts verification delayed across09:00 in exactly the later completed window, without earlier raw files',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-19T08:59:59.990Z'));
  const original=pg.Client.prototype.query;vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:unknown[]){const result=Reflect.apply(original,this,args);if(String(args[0]).startsWith('SELECT id FROM audit_log WHERE id = ANY'))return Promise.resolve(result).then(value=>{vi.setSystemTime(new Date('2026-11-19T09:00:00.010Z'));return value;}) as never;return result;});
  await run(()=>transaction(c=>action(c)));await closeOperationalTrace();const a=traceWindowBounds('2026-11-18'),b=traceWindowBounds('2026-11-19');const early=await buildTraceReport(directory,a.from,a.to),late=await buildTraceReport(directory,b.from,b.to),combined=await buildTraceReport(directory,a.from,b.to);expect(durable(early)).toBe(0);expect(durable(late)).toBe(1);expect(durable(combined)).toBe(1);expect(late.actors.find(a=>a.actor.id===user)?.first_meaningful).toBe('2026-11-19T09:00:00.010Z');
  const receipt=(await rows()).find(r=>r.event==='audit.committed');expect(receipt.data.attempted_at).toBe('2026-11-19T08:59:59.990Z');expect(receipt.data.commit_observed_at).toBe('2026-11-19T08:59:59.990Z');
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));expect((await writeTraceCheckpoint(directory,'2026-11-18',early)).written).toBe(true);expect((await writeTraceCheckpoint(directory,'2026-11-19',late)).written).toBe(true);const comparison=await traceComparisons(directory,new Date('2026-11-20T09:00:00Z'));expect(comparison.available&&comparison.seven_days.meaningful_human_events).toBe(1);
  for(const name of await readdir(directory))if(name.startsWith('2026-11-18.')&&name.endsWith('.ndjson'))await rm(join(directory,name));expect(durable(await buildTraceReport(directory,b.from,b.to))).toBe(1);
 });
 it('counts an actual product transaction committing after09:00 exactly once in the later window',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-19T08:59:59.990Z'));
  await run(()=>transaction(async c=>{await action(c);vi.setSystemTime(new Date('2026-11-19T09:00:00.010Z'));}));await closeOperationalTrace();const a=traceWindowBounds('2026-11-18'),b=traceWindowBounds('2026-11-19');expect(durable(await buildTraceReport(directory,a.from,a.to))).toBe(0);expect(durable(await buildTraceReport(directory,b.from,b.to))).toBe(1);expect(durable(await buildTraceReport(directory,a.from,b.to))).toBe(1);
 });
 it('deduplicates receipt identity while preserving distinct identical action labels and legacy unknown attempts',async()=>{
  await run(()=>transaction(async c=>{await action(c);await action(c);}));await closeOperationalTrace();const records=await rows(),receipt=records.find(r=>r.event==='audit.committed');const legacy={schema:1,time:new Date().toISOString(),event:'audit.write',span_id:'legacy',actor:{type:'human',id:user},data:{action:'group.deleted',durability:'transaction_pending'}};await writeFile(join(directory,(await readdir(directory)).find(n=>n.endsWith('.ndjson'))!),records.map(r=>JSON.stringify(r)).join('\n')+'\n'+JSON.stringify(receipt)+'\n'+JSON.stringify(legacy)+'\n'+JSON.stringify({...legacy,event:'db.transaction.committed',data:{}})+'\n',{mode:0o600});const r=await report();expect(durable(r)).toBe(2);expect(r.coverage.unconfirmed_audit_attempts).toBe(1);
 });
 it('labels historical checkpoint counts as mixed-method without rewriting their evidence',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));await run(()=>transaction(c=>action(c)));await closeOperationalTrace();const bounds=traceWindowBounds('2026-11-19');const r=await buildTraceReport(directory,bounds.from,bounds.to);vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));await writeTraceCheckpoint(directory,'2026-11-19',r);
  const reports=join(directory,'reports'),name=(await readdir(reports)).find(n=>n.endsWith('.v2.json'))!;const checkpoint=JSON.parse(await readFile(join(reports,name),'utf8'));delete checkpoint.coverage.audit_durability_method;
  const legacyPath=join(reports,'2026-11-19.json'),legacy=JSON.stringify(checkpoint);await writeFile(legacyPath,legacy,{mode:0o600});await rm(join(reports,name));const comparison=await traceComparisons(directory,new Date('2026-11-20T09:00:00Z'));expect(comparison.available&&comparison.seven_days.audit_durability_mixed_history).toBe(true);expect(comparison.available&&comparison.seven_days.partial_history).toBe(true);expect(await readFile(legacyPath,'utf8')).toBe(legacy);
 });
});
