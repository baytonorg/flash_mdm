import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/blobs.js', () => ({
  storeBlob: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { storeBlob } from '../_lib/blobs.js';
import handler from '../pubsub-webhook.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockStoreBlob = vi.mocked(storeBlob);

function makePubSubRequest(
  payload: Record<string, unknown>,
  messageId = 'msg1',
  attributes?: Record<string, string>
) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return new Request('http://localhost/.netlify/functions/pubsub-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        messageId,
        data,
        ...(attributes ? { attributes } : {}),
      },
      subscription: 'projects/p/subscriptions/s',
    }),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockStoreBlob.mockReset();
  mockExecute.mockResolvedValue({ rowCount: 1 } as never);
  mockStoreBlob.mockResolvedValue(undefined as never);
});

describe('pubsub-webhook enterprise routing', () => {
  it('routes COMMAND events by deriving enterprise from resourceName when enterpriseId is missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1' } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await handler(
      makePubSubRequest({
        notificationType: 'COMMAND',
        resourceName: 'enterprises/LC034k05pi/devices/3f1e082ddac2b005/operations/1772118629665',
      }),
      {} as never
    );

    expect(res.status).toBe(204);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM environments'),
      ['enterprises/LC034k05pi', 'LC034k05pi']
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pubsub_events'),
      ['env1', 'msg1', 'COMMAND', 'enterprises/LC034k05pi/devices/3f1e082ddac2b005']
    );
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('no matching environment for enterprise'));

    fetchSpy.mockRestore();
  });

  it('routes events by deriving enterprise and device from top-level name when resourceName is absent', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1' } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await handler(
      makePubSubRequest({
        notificationType: 'STATUS_REPORT',
        name: 'enterprises/LC034k05pi/devices/3f1e082ddac2b005',
      }),
      {} as never
    );

    expect(res.status).toBe(204);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM environments'),
      ['enterprises/LC034k05pi', 'LC034k05pi']
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pubsub_events'),
      ['env1', 'msg1', 'STATUS_REPORT', 'enterprises/LC034k05pi/devices/3f1e082ddac2b005']
    );

    fetchSpy.mockRestore();
  });

  it('uses notificationType from PubSub message attributes (AMAPI documented format)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1' } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await handler(
      makePubSubRequest(
        { name: 'enterprises/LC034k05pi/devices/3f1e082ddac2b005' },
        'msg-attr',
        { notificationType: 'STATUS_REPORT' }
      ),
      {} as never
    );

    expect(res.status).toBe(204);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pubsub_events'),
      ['env1', 'msg-attr', 'STATUS_REPORT', 'enterprises/LC034k05pi/devices/3f1e082ddac2b005']
    );

    fetchSpy.mockRestore();
  });

  it('stores unroutable payloads for later inspection', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await handler(
      makePubSubRequest({
        notificationType: 'ENROLLMENT',
        name: 'enterprises/LC034k05pi/devices/3f1e082ddac2b005',
      }, 'msg-unroutable'),
      {} as never
    );

    expect(res.status).toBe(204);
    expect(mockStoreBlob).toHaveBeenCalledWith(
      'pubsub-raw',
      '_unroutable/msg-unroutable.json',
      expect.stringContaining('"extracted_enterprise_id":"LC034k05pi"')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'PubSub event msg-unroutable: no matching environment for enterprise LC034k05pi'
    );
  });

  it('ingests ENTERPRISE_UPGRADE notifications and enqueues the dedicated job type', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1' } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await handler(
      makePubSubRequest(
        {
          notificationType: 'ENTERPRISE_UPGRADE',
          enterprise: 'enterprises/LC034k05pi',
        },
        'msg-upgrade'
      ),
      {} as never
    );

    expect(res.status).toBe(204);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pubsub_events'),
      ['env1', 'msg-upgrade', 'ENTERPRISE_UPGRADE', null]
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO job_queue'),
      [
        'process_enterprise_upgrade',
        'env1',
        expect.stringContaining('"notification_type":"ENTERPRISE_UPGRADE"'),
      ]
    );

    fetchSpy.mockRestore();
  });

  it('routes USAGE_LOGS events using batchUsageLogEvents.device', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1' } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await handler(
      makePubSubRequest(
        {
          batchUsageLogEvents: {
            device: 'enterprises/LC034k05pi/devices/3f1e082ddac2b005',
            retrievalTime: '2026-03-03T14:00:00Z',
            usageLogEvents: [],
          },
        },
        'msg-usage',
        { notificationType: 'USAGE_LOGS' }
      ),
      {} as never
    );

    expect(res.status).toBe(204);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM environments'),
      ['enterprises/LC034k05pi', 'LC034k05pi']
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pubsub_events'),
      ['env1', 'msg-usage', 'USAGE_LOGS', 'enterprises/LC034k05pi/devices/3f1e082ddac2b005']
    );

    fetchSpy.mockRestore();
  });

  it('uses matching column/value count for fast-path device upsert', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1' } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const res = await handler(
      makePubSubRequest(
        {
          notificationType: 'STATUS_REPORT',
          name: 'enterprises/LC034k05pi/devices/3f1e082ddac2b005',
          hardwareInfo: {
            model: 'Pixel 9a',
            serialNumber: 'SER123',
          },
        },
        'msg-fast-path'
      ),
      {} as never
    );

    expect(res.status).toBe(204);
    const fastPathCall = mockExecute.mock.calls.find(([sql]) =>
      typeof sql === 'string' &&
      sql.includes('INSERT INTO devices') &&
      sql.includes('snapshot')
    );
    expect(fastPathCall).toBeDefined();
    const [sql, params] = fastPathCall as [string, unknown[]];
    expect(sql).toContain('$17::jsonb');
    expect(sql).not.toContain('$18::jsonb');
    expect(Array.isArray(params)).toBe(true);
    expect((params as unknown[]).length).toBe(17);

    fetchSpy.mockRestore();
  });
});
