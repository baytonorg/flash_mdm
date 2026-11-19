import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

import { query, transaction } from '../_lib/db.js';
import handler from '../workflow-cron-scheduled.ts';

const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);

const workflow = {
  id: 'wf-1',
  environment_id: 'env-1',
  name: 'Scheduled device workflow',
  trigger_config: { interval_minutes: 60 },
  conditions: [],
  action_type: 'audit.log',
  action_config: {},
  scope_type: 'device',
  scope_id: 'dev-a',
  last_triggered_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  mockQuery.mockResolvedValue([workflow] as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workflow-cron-scheduled', () => {
  it('enqueues only the configured device for a device-scoped workflow', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [workflow], rowCount: 1 };
      if (sql.includes('SELECT id FROM devices')) return { rows: [{ id: 'dev-a' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mockTransaction.mockImplementation(async (fn) => fn({ query: clientQuery } as never));

    await handler(new Request('http://localhost/.netlify/functions/workflow-cron-scheduled'), {} as never);

    const deviceScopeCall = clientQuery.mock.calls.find(([sql]) => String(sql).includes('SELECT id FROM devices'));
    expect(deviceScopeCall?.[1]).toEqual(['dev-a', 'env-1']);
    const inserts = clientQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO job_queue'));
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(String(inserts[0]?.[1]?.[2]))).toMatchObject({
      workflow_id: 'wf-1',
      device_id: 'dev-a',
    });
  });

  it('rechecks eligibility under a row lock so a stale concurrent candidate is not enqueued twice', async () => {
    let lastTriggeredAt: string | null = null;
    let inserts = 0;
    const lockQueries: string[] = [];

    mockTransaction.mockImplementation(async (fn) => {
      const clientQuery = vi.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          lockQueries.push(sql);
          return { rows: [{ ...workflow, last_triggered_at: lastTriggeredAt }], rowCount: 1 };
        }
        if (sql.includes('SELECT id FROM devices')) return { rows: [{ id: 'dev-a' }], rowCount: 1 };
        if (sql.includes('INSERT INTO job_queue')) inserts += 1;
        if (sql.includes('UPDATE workflows SET last_triggered_at')) {
          lastTriggeredAt = new Date().toISOString();
        }
        return { rows: [], rowCount: 1 };
      });
      return fn({ query: clientQuery } as never);
    });

    await handler(new Request('http://localhost/.netlify/functions/workflow-cron-scheduled'), {} as never);
    await handler(new Request('http://localhost/.netlify/functions/workflow-cron-scheduled'), {} as never);

    expect(inserts).toBe(1);
    expect(lockQueries).toHaveLength(2);
    expect(lockQueries.every((sql) => sql.includes('FOR UPDATE'))).toBe(true);
  });
});


describe('persisted scheduled interval validation', () => {
  it.each([null, [], { interval_minutes: null }, { interval_minutes: '15' }, { interval_minutes: 0 }, { interval_minutes: -1 }, { interval_minutes: 15.5 }, { interval_minutes: Infinity }, { interval_minutes: NaN }, { interval_minutes: 10_000 }])('fails closed for %j before looking up devices', async trigger_config => {
    const clientQuery = vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? { rows: [{ ...workflow, trigger_config }] } : { rows: [{ id: 'dev-a' }] });
    mockTransaction.mockImplementation(async fn => fn({ query: clientQuery } as never));
    const response = await handler(new Request('http://localhost/.netlify/functions/workflow-cron-scheduled'), {} as never);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ stats: { enqueued: 0, errors: 1 } });
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the locked configuration, so a stale valid snapshot cannot enqueue an invalid edit', async () => {
    const clientQuery = vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? { rows: [{ ...workflow, trigger_config: { interval_minutes: 0 } }] } : { rows: [] });
    mockTransaction.mockImplementation(async fn => fn({ query: clientQuery } as never));
    const response = await handler(new Request('http://localhost/.netlify/functions/workflow-cron-scheduled'), {} as never);
    expect(response.status).toBe(500);
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it('emits the effective hourly default in the queued job for an older omitted interval', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ ...workflow, trigger_config: {} }] };
      if (sql.includes('SELECT id FROM devices')) return { rows: [{ id: 'dev-a' }] };
      return { rows: [] };
    });
    mockTransaction.mockImplementation(async fn => fn({ query: clientQuery } as never));
    const response = await handler(new Request('http://localhost/.netlify/functions/workflow-cron-scheduled'), {} as never);
    expect(response.status).toBe(200);
    const insert = clientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO job_queue'));
    expect(JSON.parse(String(insert?.[1]?.[2]))).toMatchObject({ trigger_data: { interval_minutes: 60 } });
  });
});
