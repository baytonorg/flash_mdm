// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { inspect } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]) }));
import { MIGRATIONS } from '../migrate';
import { closeDatabasePool } from '../_lib/db';
import { closeOperationalTrace } from '../_lib/operational-trace';
import workflowHandler from '../workflow-evaluate-background';
import workerHandler from '../sync-process-background';

const url = process.env.WEBHOOK_PRIVACY_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const markers = ['SYNTHETIC_PATH_BEARER', 'SYNTHETIC_QUERY_BEARER', 'SYNTHETIC_FRAGMENT_BEARER'];
const destination = `https://hooks.example.test/${markers[0]}?signature=${markers[1]}#${markers[2]}`;

suite('webhook output privacy with real PostgreSQL and transport boundary', () => {
  let pool: pg.Pool; let directory: string; let workflow: string; let device: string; let environment: string;
  let captured: string[];
  const request = () => new Request('http://localhost/internal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'synthetic-internal-only' }, body: JSON.stringify({ workflow_id: workflow, device_id: device, trigger_data: {} }) });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/flash_webhook_fixture') throw Error('Refusing non-disposable webhook database');
    process.env.DATABASE_URL = url!; process.env.NODE_ENV = 'development'; process.env.INTERNAL_FUNCTION_SECRET = 'synthetic-internal-only';
    directory = await mkdtemp(join(tmpdir(), 'flash-webhook-privacy-'));
    process.env.FLASH_TRACE_DIR = directory;
    pool = new pg.Pool({ connectionString: url });
    for (const migration of MIGRATIONS) await pool.query(migration.sql);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE workspaces, users CASCADE');
    const workspace = (await pool.query("INSERT INTO workspaces(name) VALUES('Webhook fixture') RETURNING id")).rows[0].id;
    environment = (await pool.query("INSERT INTO environments(workspace_id,name) VALUES($1,'Webhook fixture') RETURNING id", [workspace])).rows[0].id;
    device = (await pool.query("INSERT INTO devices(environment_id,amapi_name,state) VALUES($1,'enterprises/synthetic/devices/synthetic','ACTIVE') RETURNING id", [environment])).rows[0].id;
    workflow = (await pool.query("INSERT INTO workflows(environment_id,name,trigger_type,action_type,action_config,enabled) VALUES($1,'Webhook fixture','scheduled','notification.webhook',$2,true) RETURNING id", [environment, JSON.stringify({ url: destination, secret: 'SYNTHETIC_HEADER_BEARER' })])).rows[0].id;
    captured = [];
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...args) => { captured.push(inspect(args)); });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    try {
      await closeOperationalTrace();
      const trace = (await Promise.all((await readdir(directory)).filter(x => x.endsWith('.ndjson')).map(x => readFile(join(directory,x),'utf8')))).join('');
      for (const marker of [...markers, 'SYNTHETIC_HEADER_BEARER']) expect(trace).not.toContain(marker);
    } finally {
      delete process.env.FLASH_TRACE_DIR;
      await closeDatabasePool(); await pool?.end();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([200, 503, 'transport', 'abort'] as const)('keeps the original delivery and bounded output on %s', async outcome => {
    const transport = vi.fn(async () => {
      if (outcome === 'transport' || outcome === 'abort') throw Object.assign(new Error('Delivery of ' + destination, { cause: new Error('SYNTHETIC_HEADER_BEARER') }), { name: outcome === 'abort' ? 'AbortError' : 'TypeError' });
      return new Response('SYNTHETIC_QUERY_BEARER response body', { status: outcome });
    });
    vi.stubGlobal('fetch', transport);
    const response = await workflowHandler(request(), {} as never);
    expect(response?.status).toBe(200);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toBe(destination);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'SYNTHETIC_HEADER_BEARER' } });
    const execution = (await pool.query('SELECT status,result FROM workflow_executions')).rows[0];
    expect(execution.status).toBe(outcome === 200 ? 'success' : 'failed');
    const audit = (await pool.query('SELECT details FROM audit_log')).rows;
    expect(audit).toHaveLength(1);
    const output = JSON.stringify({ execution, audit, captured });
    for (const marker of [...markers, 'SYNTHETIC_HEADER_BEARER']) expect(output).not.toContain(marker);
    if (typeof outcome === 'number') expect(execution.result.webhook_url).toBe('https://hooks.example.test');
    else expect(execution.result.error).toBe(outcome === 'abort' ? 'Webhook delivery timed out' : 'Webhook delivery failed');
    expect((await pool.query('SELECT action_config FROM workflows')).rows[0].action_config.url).toBe(destination);
  });

  it('rejects a blocked configured destination without echoing it or sending', async () => {
    await pool.query('UPDATE workflows SET action_config=$1 WHERE id=$2', [JSON.stringify({ url: 'https://127.0.0.1/' + markers[0] + '?signature=' + markers[1] }), workflow]);
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    await workflowHandler(request(), {} as never);
    expect(transport).not.toHaveBeenCalled();
    const row = (await pool.query('SELECT status,result FROM workflow_executions')).rows[0];
    expect(row).toMatchObject({ status: 'failed', result: { success: false, error: 'Webhook URL points to a blocked address' } });
    const audit = (await pool.query('SELECT details FROM audit_log')).rows;
    for (const marker of markers) expect(JSON.stringify({ row, audit, captured })).not.toContain(marker);
  });

  it('keeps transport details out of geofence worker retry errors without changing its payload', async () => {
    const transport = vi.fn().mockRejectedValue(new Error(destination, { cause: new Error('SYNTHETIC_HEADER_BEARER') }));
    vi.stubGlobal('fetch', transport);
    await pool.query("INSERT INTO job_queue(environment_id,job_type,payload,status) VALUES($1,'webhook',$2,'pending')", [environment, JSON.stringify({ url: destination, body: {} })]);
    expect((await workerHandler(request(), {} as never))?.status).toBe(200);
    const row = (await pool.query('SELECT status,error,payload,attempts FROM job_queue')).rows[0];
    expect(row).toMatchObject({ status: 'pending', attempts: 1, error: 'Error: Webhook delivery failed' });
    expect(String(transport.mock.calls[0]?.[0])).toBe(destination);
    expect(row.payload.url).toBe(destination);
    for (const marker of markers) expect(JSON.stringify({ error: row.error, captured })).not.toContain(marker);
  });
});
