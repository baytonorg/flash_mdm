// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, chmod, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { traceWindow, TraceWriter } from '../_lib/trace-writer.js';
import { traceHttp, setTraceActor, traceEvent, traceSpan, closeOperationalTrace, traceError } from '../_lib/operational-trace.js';
import { setCurrentAuditAuthContext, getCurrentAuditAuthContext } from '../_lib/request-auth-context.js';
import { readTraceTail, buildTraceReport, traceStatus, streamTraceWindow } from '../_lib/trace-reader.js';
import { writeTraceCheckpoint, traceComparisons, traceWindowBounds } from '../_lib/trace-checkpoints.js';
import { normaliseTracePath, responseOutcome, traceHttpMethod } from '../../../shared/trace-contract.js';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'flash-trace-test-')); delete process.env.FLASH_TRACE_DIR; delete process.env.FLASH_TRACE_COMPONENT; });
afterEach(async () => { await closeOperationalTrace(); delete process.env.FLASH_TRACE_DIR; delete process.env.FLASH_TRACE_COMPONENT; await rm(directory, { recursive: true, force: true }); });
async function records() { const names = (await readdir(directory)).filter(n => n.endsWith('.ndjson')); return (await Promise.all(names.map(n => readFile(join(directory, n), 'utf8')))).join('').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); }

describe('trace rotation and bounded storage', () => {
  it('rotates at 09:00 London in winter and summer, with explicit DST window lengths', () => {
    expect(traceWindow(new Date('2026-11-03T08:59:59Z'))).toBe('2026-11-02');
    expect(traceWindow(new Date('2026-11-03T09:00:00Z'))).toBe('2026-11-03');
    expect(traceWindow(new Date('2026-07-03T08:00:00Z'))).toBe('2026-07-03');
    const spring = traceWindowBounds('2026-03-28'), autumn = traceWindowBounds('2026-10-24');
    expect(spring.to.getTime() - spring.from.getTime()).toBe(23 * 3600000);
    expect(autumn.to.getTime() - autumn.from.getTime()).toBe(25 * 3600000);
  });
  it('writes private NDJSON and preserves both sides of a boundary', async () => {
    let now = new Date('2026-11-03T08:59:59Z');
    const writer = new TraceWriter({ directory, component: 'test', now: () => now, minimumFreeBytes: 0 });
    writer.write({ time: now.toISOString(), event: 'before' }); await writer.flush();
    now = new Date('2026-11-03T09:00:01Z'); writer.write({ time: now.toISOString(), event: 'after' }); await writer.close();
    const names = (await readdir(directory)).filter(n => n.endsWith('.ndjson'));
    expect(names).toHaveLength(2);
    for (const name of names) expect((await stat(join(directory, name))).mode & 0o777).toBe(0o600);
    expect((await records()).map(r => r.event).sort()).toEqual(['after', 'before']);
  });
  it('bounds queue and line sizes and accounts for every rejected event', async () => {
    const writer = new TraceWriter({ directory, component: 'test', maxQueueBytes: 150, minimumFreeBytes: 0 });
    expect(writer.write({ event: 'first', text: 'a'.repeat(70) })).toBe(true);
    expect(writer.write({ event: 'second', text: 'b'.repeat(70) })).toBe(false);
    expect(writer.write({ event: 'oversized', text: 'x'.repeat(9000) })).toBe(false);
    await writer.close();
    expect(writer.health()).toMatchObject({ written: 1, dropped: 2, oversized: 1 });
  });
  it('prunes only owned old trace files and leaves unrelated resources untouched', async () => {
    for (const day of ['01', '02', '03', '04', '05']) await writeFile(join(directory, `2026-11-${day}.test.1.00000.ndjson`), '{}\n');
    await writeFile(join(directory, 'operator-owned.env'), 'fixture-protected-value');
    const writer = new TraceWriter({ directory, component: 'test', now: () => new Date('2026-11-05T12:00:00Z'), retainWindows: 2, minimumFreeBytes: 0 });
    await writer.flush(); await writer.close();
    expect((await readdir(directory)).filter(n => n.endsWith('.ndjson')).sort()).toEqual(['2026-11-04.test.1.00000.ndjson', '2026-11-05.test.1.00000.ndjson']);
    expect(await readFile(join(directory, 'operator-owned.env'), 'utf8')).toBe('fixture-protected-value');
  });
  it('fails open with visible drops when storage is unsafe or unavailable', async () => {
    await chmod(directory, 0o755);
    const writer = new TraceWriter({ directory, component: 'test' });
    writer.write({ event: 'fixture' }); await writer.close();
    expect(writer.health()).toMatchObject({ written: 0, dropped: 1 });
    expect(writer.health().write_errors).toBeGreaterThan(0);
  });
  it('does not describe a missing or stopped worker as fresh collection', async () => {
    const writer = new TraceWriter({ directory, component: 'web', minimumFreeBytes: 0 });
    writer.write({ event: 'fixture' }); await writer.flush();
    expect((await traceStatus(directory)).components).toEqual([{ component: 'web', fresh: true }, { component: 'worker', fresh: false }]);
    await writer.close();
    expect((await traceStatus(directory)).components.every(component => !component.fresh)).toBe(true);
  });
  it('rejects a symlink storage root instead of following it', async () => {
    const link = directory + '-link'; await symlink(directory, link);
    try { const writer = new TraceWriter({ directory: link, component: 'test' }); writer.write({ event: 'fixture' }); await writer.close(); expect(writer.health().written).toBe(0); }
    finally { await rm(link); }
  });
  it('drops events at the per-window budget instead of growing indefinitely', async () => {
    const writer = new TraceWriter({ directory, component: 'test', maxWindowBytes: 60, minimumFreeBytes: 0 });
    writer.write({ event: 'one', text: 'a'.repeat(20) }); writer.write({ event: 'two', text: 'b'.repeat(20) });
    await writer.close(); expect(writer.health()).toMatchObject({ written: 1, dropped: 1 });
  });
});

describe('correlated request evidence', () => {
  it('keeps concurrent identities isolated and excludes credential-bearing inputs and outputs', async () => {
    process.env.FLASH_TRACE_DIR = directory;
    const secret = 'fixture-secret-that-must-never-be-logged';
    await Promise.all(['human', 'api_key'].map(async type => traceHttp(new Request(`http://localhost/api/invites/${secret}?token=${secret}`, { method: 'POST', headers: { authorization: 'Bearer ' + secret }, body: JSON.stringify({ password: secret }) }), async () => {
      setTraceActor({ type: type as 'human' | 'api_key', id: type });
      await traceSpan('fixture.operation', {}, async () => { await new Promise(r => setTimeout(r, type === 'human' ? 2 : 0)); traceEvent('fixture.result', { outcome: 'success' }); });
      return Response.json({ success: true, password: secret, token: secret });
    })));
    await closeOperationalTrace(); const rows = await records();
    expect(JSON.stringify(rows)).not.toContain(secret);
    const ends = rows.filter(r => r.event === 'http.end'); expect(ends).toHaveLength(2);
    for (const end of ends) expect(rows.filter(r => r.request_id === end.request_id && r.event === 'fixture.result').map(r => r.actor.type)).toEqual([end.actor.type]);
    expect(getCurrentAuditAuthContext()).toBeUndefined();
  });
  it('does not inherit an earlier key audit context into an anonymous request', async () => {
    process.env.FLASH_TRACE_DIR = directory;
    setCurrentAuditAuthContext({ authType: 'api_key', user: { id: null, email: '' } });
    await traceHttp(new Request('http://localhost/api/health'), async () => { expect(getCurrentAuditAuthContext()).toBeUndefined(); return Response.json({ status: 'ok' }); });
  });
  it('records failures hidden inside a successful bulk HTTP status and treats MFA challenges separately', async () => {
    process.env.FLASH_TRACE_DIR = directory;
    await traceHttp(new Request('http://localhost/api/devices/bulk'), async () => Response.json({ failed: 0, errors: 2 }));
    await traceHttp(new Request('http://localhost/api/auth/login'), async () => Response.json({ needs_totp: true }, { status: 401 }));
    await closeOperationalTrace();
    expect((await records()).filter(r => r.event === 'http.end').map(r => r.data.outcome)).toEqual(['partial_failure', 'challenge']);
  });
  it('cancels timed-out diagnostic inspection while preserving the product response stream', async () => {
    process.env.FLASH_TRACE_DIR = directory;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('{"success":')); } });
    const response = await traceHttp(new Request('http://localhost/api/health'), async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    stream.enqueue(new TextEncoder().encode('true}')); stream.close();
    expect(await response.json()).toEqual({ success: true });
    await closeOperationalTrace();
    expect((await records()).find(record => record.event === 'http.end').data.detail).toBe('time_limit');
  });
  it('does not place exception messages or raw paths in structured errors', () => {
    const error = new Error('fixture password=supersecret'); expect(JSON.stringify(traceError(error))).not.toContain('supersecret');
    expect(normaliseTracePath('/join/w/secret-slug?password=supersecret')).toBe('/join/w/:value');
    expect(normaliseTracePath('/api/devices/:id')).toBe('/api/devices/:id');
    expect(responseOutcome({ token: 'secret', success: true, results: [{ ok: false }] })).toEqual({ success: true, results_count: 1, results_failed: 1 });
  });
  it('shows pre-authentication spans under the established request actor when filtering',async()=>{
    const time=new Date().toISOString();
    await writeFile(join(directory,`${traceWindow()}.test.1.00000.ndjson`),[
      {event:'db.query.start',actor:{type:'anonymous'}},
      {event:'http.end',actor:{type:'human',id:'fixture-user',email:'fixture@example.invalid'}},
    ].map(record=>JSON.stringify({schema:1,time,request_id:'fixture-request',data:{},...record})).join('\n')+'\n',{mode:0o600});
    const tail=await readTraceTail(directory,{actor:'fixture@example.invalid'});
    expect(tail.events).toHaveLength(2);
    expect(tail.events.every(event=>event.actor?.id==='fixture-user')).toBe(true);
  });
  it('keeps successful empty worker polls compact but retains failing polls in full', async () => {
    process.env.FLASH_TRACE_DIR = directory; process.env.FLASH_TRACE_COMPONENT = 'worker';
    for (let i = 0; i < 20; i++) await traceHttp(new Request('http://localhost/.netlify/functions/sync-process-background'), async () => { traceEvent('db.query.start', {}); return Response.json({ jobs: 0 }); });
    await traceHttp(new Request('http://localhost/.netlify/functions/sync-process-background'), async () => Response.json({ error: 'fixture' }, { status: 500 }));
    await closeOperationalTrace(); const rows = await records();
    expect(rows.filter(r => r.event === 'http.end')).toHaveLength(1);
    expect(rows.some(r => r.event === 'worker.idle_summary')).toBe(true);
  });
  it('reports human activity separately from key/system work and does not count rolled-back audit writes', async () => {
    const now = new Date().toISOString();
    const events = [
      { actor: { type: 'human', id: 'human' }, event: 'ui.navigation', data: {} },
      { actor: { type: 'api_key', id: 'key' }, event: 'audit.write', data: { durability: 'committed' } },
      { actor: { type: 'human', id: 'rollback-only' }, event: 'audit.write', span_id: 'rolled-back', data: { durability: 'transaction_pending' } },
      { actor: { type: 'support', id: 'support' }, event: 'ui.click', data: {} },
    ];
    await writeFile(join(directory, `${traceWindow()}.test.1.00000.ndjson`), events.map(e => JSON.stringify({ schema: 1, time: now, ...e })).join('\n') + '\n', { mode: 0o600 });
    const report = await buildTraceReport(directory, new Date(Date.now() - 60000), new Date(Date.now() + 60000));
    expect(report.totals.active_humans).toBe(1);
    expect(report.actors.find(a => a.actor?.id === 'rollback-only')?.meaningful_events).toBe(0);
    expect((await readTraceTail(directory, { actor: 'support' })).events).toHaveLength(1);
  });
});


describe('trace evidence integrity', () => {
  it('masks bearer positions even when a signup slug is a static label or UUID', () => {
    const paths = [
      ['/join/w/dashboard','/join/w/:value'], ['/join/e/workspaces','/join/e/:value'],
      ['/jOin/W/settings','/join/w/:value'], ['/j%6Fin/w/settings','/join/w/:value'], ['/INVITE/devices','/invite/:value'],
      ['/join/dashboard','/join/:value'], ['/invite/settings','/invite/:value'],
      ['/api/invites/settings/accept','/api/invites/:value/accept'],
      ['/api/signup-links/resolve/11111111-1111-4111-8111-111111111111','/api/signup-links/resolve/:value'],
      ['/.netlify/functions/signup-link-resolve/workspaces','/.netlify/functions/signup-link-resolve/:value'],
      ['/api/workspaces/list','/api/workspaces/list'],
    ];
    for(const [source, expected] of paths) {
      expect(normaliseTracePath(source)).toBe(expected);
      expect(normaliseTracePath(expected)).toBe(expected);
    }
  });
  it('keeps custom workflow audit labels out of diagnostics on both write paths', async () => {
    const { logAudit } = await import('../_lib/audit.js');
    const sentinel = 'unrestricted fixture form text';
    process.env.FLASH_TRACE_DIR = directory;
    const success = { query: async () => ({}) } as never;
    const failure = { query: async () => { throw new Error('fixture unavailable'); } } as never;
    await logAudit({ action: 'auth.login' }, success);
    await logAudit({ action: sentinel, resource_type: sentinel, resource_id: sentinel }, success);
    await expect(logAudit({ action: sentinel }, failure)).rejects.toThrow('fixture unavailable');
    await closeOperationalTrace();
    const events = await records();
    expect(events.map(row => row.data.action)).toEqual(['auth.login', 'custom', 'custom']);
    expect(JSON.stringify(events)).not.toContain(sentinel);
    expect(traceHttpMethod('post')).toBe('POST');
    expect(traceHttpMethod(sentinel)).toBe('OTHER');
  });
  it('retains real stack locations and excludes multiline messages and untrusted codes', () => {
    const secret = 'fixture-confidential';
    const error = Object.assign(new Error('first line\n    at x (/tmp/' + secret + '.js:1:2)'), { code: secret.toUpperCase() });
    error.stack = error.toString() + '\n    at task (/srv/netlify/functions/_lib/db.ts:12:34)\n    at task (/tmp/' + secret + '.ts:45:67)';
    expect(traceError(error)).toMatchObject({ error_class: 'Error', frames: ['db:12:34', expect.stringMatching(/^source-[0-9a-f]{12}:45:67$/)] });
    expect(JSON.stringify(traceError(error)).toLowerCase()).not.toContain(secret);
    const broken = new Error('bad stack');
    Object.defineProperty(broken, 'stack', { get() { throw Error('diagnostic error'); } });
    expect(traceError(broken)).toEqual({error_class:'Error',frames:[]});
  });
  it('includes browser exceptions and delivery uncertainty in problems and follows server IDs', async () => {
    process.env.FLASH_TRACE_DIR = directory;
    const response = await traceHttp(new Request('http://localhost/api/workflows'), async () => Response.json({ status: 'delivery_uncertain' }));
    const id = response.headers.get('x-flash-request-id')!;
    await traceHttp(new Request('http://localhost/api/activity'), async () => {
      traceEvent('ui.api_result', {server_request_id:id});
      traceEvent('ui.javascript_error'); traceEvent('ui.react_error');
      return new Response(null,{status:204});
    });
    await closeOperationalTrace();
    const problems = await readTraceTail(directory,{outcome:'problems'});
    expect(problems.events.map(e => e.event).sort()).toEqual(['http.end','ui.javascript_error','ui.react_error']);
    expect(problems.events.find(e => e.event === 'http.end')?.data.outcome).toBe('delivery_uncertain');
    expect((await readTraceTail(directory,{requestId:id})).events.some(e => e.event === 'ui.api_result')).toBe(true);
  });
  it('counts structurally invalid records and ignores malformed heartbeats',async()=>{
    const window=traceWindow(), time=new Date().toISOString();
    await writeFile(join(directory,window+'.web.1.00000.ndjson'), [
      'x'.repeat(256*1024), 'null', JSON.stringify({schema:1,event:'http.end',time,actor:{id:{}},data:{}}),
      JSON.stringify({schema:1,event:'http.end',time,data:{status:200}})
    ].join('\n')+'\n');
    await writeFile(join(directory,window+'.web.1.health.json'),'null');
    const tail=await readTraceTail(directory,{actor:'human'});
    expect(tail.invalid_lines).toBe(3);
    const report=await buildTraceReport(directory,new Date(Date.now()-60000),new Date(Date.now()+60000));
    expect(report.coverage).toMatchObject({invalid_lines:3,invalid_health_records:1,component_coverage_incomplete:true});
    expect(report.totals.http_requests).toBe(1);
  });
  it('bounds a download to the original size and fails on a missing listed segment',async()=>{
    const window=traceWindow(), first=join(directory,window+'.web.1.00000.ndjson'), second=join(directory,window+'.web.1.00001.ndjson');
    await writeFile(first,'first\n'); await writeFile(second,'second\n');
    const download=streamTraceWindow(directory,window);
    expect((await download.next()).value?.toString()).toBe('first\n');
    await writeFile(second,'second\nnew record\n');
    let remainder=''; for await (const chunk of download) remainder+=chunk.toString();
    expect(remainder).toContain('second'); expect(remainder).not.toContain('new record');
    const missing=streamTraceWindow(directory,window);
    await missing.next(); await rm(second);
    await expect((async()=>{for await (const _ of missing) void _;})()).rejects.toMatchObject({code:'ENOENT'});
  });
  it('retains valid checkpoint evidence alongside corrupt higher and equal count candidates', async()=>{
    const window='2026-10-15', {from,to}=traceWindowBounds(window);
    await writeFile(join(directory,window+'.web.1.health.json'), JSON.stringify({schema:1,window,component:'web',closed:true,
      started_at:from.toISOString(),window_started_at:from.toISOString(),observed_at:to.toISOString(),heartbeat_gaps:0}));
    const path=join(directory,'reports'); await mkdir(path,{mode:0o700});
    await writeFile(join(path,window+'.000000000200.v2.json'),'{');
    await writeFile(join(path,window+'.000000000100.v2.json'),'{');
    const report=await buildTraceReport(directory,from,to);
    await writeTraceCheckpoint(directory,window,{...report,totals:{...report.totals,events:100,http_requests:12}});
    const comparison=await traceComparisons(directory,to);
    expect(comparison.seven_days).toMatchObject({windows_available:1,http_requests:12,partial_history:true});
  });
  it('requires both component heartbeats and selects seven completed London days across autumn DST', async () => {
    for(let day=21;day<=27;day++){
      const window='2026-10-'+day,{from,to}=traceWindowBounds(window);
      for(const component of ['worker','web']){
        await writeFile(join(directory,window+'.'+component+'.1.health.json'),JSON.stringify({schema:1,window,component,closed:true,
          started_at:from.toISOString(),window_started_at:from.toISOString(),observed_at:to.toISOString(),heartbeat_gaps:0}));
      }
      const report=await buildTraceReport(directory,from,to);
      expect(report.coverage.component_coverage_incomplete).toBe(false);
      await Promise.all([1,12,2,8].map(n=>writeTraceCheckpoint(directory,window,{...report,totals:{...report.totals,events:n,http_requests:n}})));
    }
    const {from,to}=traceWindowBounds('2026-10-27');
    const comparisons=await traceComparisons(directory,new Date(+to+60000));
    expect(comparisons.seven_days).toMatchObject({windows_available:7,http_requests:84,partial_history:false});
    const worker=join(directory,'2026-10-27.worker.1.health.json'), original=JSON.parse(await readFile(worker,'utf8'));
    await writeFile(worker,JSON.stringify({...original,heartbeat_gaps:1}));
    expect((await buildTraceReport(directory,from,to)).coverage.component_coverage_incomplete).toBe(true);
    await writeFile(worker,JSON.stringify({...original,observed_at:new Date(+from+300000).toISOString()}));
    expect((await buildTraceReport(directory,from,to)).coverage.component_coverage_incomplete).toBe(true);
    await rm(worker);
    expect((await buildTraceReport(directory,from,to)).coverage.component_coverage_incomplete).toBe(true);
  });
});
