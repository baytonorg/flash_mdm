// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, chmod, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { traceWindow, TraceWriter } from '../_lib/trace-writer.js';
import { traceHttp, setTraceActor, traceEvent, traceSpan, closeOperationalTrace, traceError } from '../_lib/operational-trace.js';
import { setCurrentAuditAuthContext, getCurrentAuditAuthContext } from '../_lib/request-auth-context.js';
import { readTraceTail, buildTraceReport, traceStatus } from '../_lib/trace-reader.js';
import { traceWindowBounds } from '../_lib/trace-checkpoints.js';
import { normaliseTracePath, responseOutcome } from '../../../shared/trace-contract.js';

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
