import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/command-operation-ledger.js', () => ({
  enqueueOutstandingCommandReconciliations: vi.fn(),
}));

import { query, queryOne, execute, transaction } from '../_lib/db.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import { enqueueOutstandingCommandReconciliations } from '../_lib/command-operation-ledger.js';
import handler from '../sync-reconcile-scheduled.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockClientQuery = vi.fn();
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);
const mockEnqueueOutstandingCommandReconciliations = vi.mocked(enqueueOutstandingCommandReconciliations);

describe('sync-reconcile-scheduled', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockTransaction.mockReset();
    mockClientQuery.mockReset();
    mockAmapiCall.mockReset();
    mockLogAudit.mockReset();
    mockEnqueueOutstandingCommandReconciliations.mockReset();
    mockExecute.mockResolvedValue({ rowCount: 0 } as never);
    mockTransaction.mockImplementation(async (callback) => callback({ query: mockClientQuery } as never));
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    mockQueryOne.mockResolvedValue(null as never);
    mockLogAudit.mockResolvedValue(undefined as never);
    mockEnqueueOutstandingCommandReconciliations.mockResolvedValue(0);
  });

  it('wakes the worker when an orphaned command reconciliation is queued', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    mockQuery.mockResolvedValueOnce([] as never);
    mockEnqueueOutstandingCommandReconciliations.mockResolvedValueOnce(1);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'));

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost/.netlify/functions/sync-process-background',
      expect.objectContaining({ method: 'POST' })
    );
    fetchSpy.mockRestore();
  });

  it('URL-encodes device pagination page tokens', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'env_1',
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        },
      ] as never)
      .mockResolvedValueOnce([] as never) // local devices
      .mockResolvedValueOnce([] as never); // enrollment_tokens local rows

    mockAmapiCall
      .mockResolvedValueOnce({ devices: [], nextPageToken: 'abc+/=' } as never)
      .mockResolvedValueOnce({ devices: [], nextPageToken: undefined } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    expect(mockAmapiCall).toHaveBeenNthCalledWith(
      2,
      'enterprises/e1/devices?pageSize=100&pageToken=abc%2B%2F%3D',
      'ws_1',
      expect.any(Object)
    );
  });

  it('retires stale tokens and only hard-deletes expired tokens after grace period', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'env_1',
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        },
      ] as never)
      .mockResolvedValueOnce([] as never) // local devices
      .mockResolvedValueOnce([
        {
          id: 'tok_1',
          amapi_name: 'enterprises/e1/enrollmentTokens/t1',
          expires_at: null,
        },
      ] as never)
      .mockResolvedValueOnce([] as never); // no hard-deletes yet (within grace)

    mockAmapiCall
      .mockResolvedValueOnce({ devices: [], nextPageToken: undefined } as never)
      .mockResolvedValueOnce({ enrollmentTokens: [], nextPageToken: undefined } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    const hardDeleteCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes('DELETE FROM enrollment_tokens') &&
      String(call[0]).includes("interval '1 hour'")
    );
    expect(hardDeleteCall).toBeDefined();
    expect(hardDeleteCall?.[1]).toEqual(['env_1', 24]);

    const retireCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE enrollment_tokens') &&
      String(call[0]).includes('amapi_value = NULL') &&
      String(call[0]).includes('expires_at = COALESCE(LEAST(expires_at, now()), now())')
    );
    expect(retireCall).toBeDefined();
    expect(retireCall?.[1]).toEqual([['tok_1']]);

    expect(
      mockExecute.mock.calls.some((call) => String(call[0]).trim() === 'DELETE FROM enrollment_tokens WHERE id = ANY($1::uuid[])')
    ).toBe(false);
  });

  it('skips device soft-delete pass when AMAPI device pagination fails mid-stream', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'env_1',
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        },
      ] as never)
      .mockResolvedValueOnce([] as never); // enrollment_tokens local rows (still reconciled)

    mockAmapiCall
      .mockResolvedValueOnce({
        devices: [{ name: 'enterprises/e1/devices/d1' }],
        nextPageToken: 'page-2',
      } as never)
      .mockRejectedValueOnce(new Error('AMAPI page 2 failed') as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    const softDeleteDbScanCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes('SELECT id, amapi_name FROM devices')
    );
    expect(softDeleteDbScanCall).toBeUndefined();

    const enrollmentTokenQueryCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes('FROM enrollment_tokens')
    );
    expect(enrollmentTokenQueryCall).toBeDefined();

    const deviceSoftDeleteUpdate = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes("state = 'DELETED'") && String(call[0]).includes('WHERE id = $1')
    );
    expect(deviceSoftDeleteUpdate).toBeUndefined();

    consoleErrorSpy.mockRestore();
  });

  it('runs device soft-delete pass after successful multi-page AMAPI pagination', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'env_1',
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        },
      ] as never)
      .mockResolvedValueOnce([
        { id: 'db_seen_1', amapi_name: 'enterprises/e1/devices/d1' },
        { id: 'db_missing_1', amapi_name: 'enterprises/e1/devices/missing' },
      ] as never)
      .mockResolvedValueOnce([] as never); // enrollment_tokens local rows

    mockAmapiCall
      .mockResolvedValueOnce({
        devices: [{ name: 'enterprises/e1/devices/d1' }],
        nextPageToken: 'page-2',
      } as never)
      .mockResolvedValueOnce({
        devices: [{ name: 'enterprises/e1/devices/d2' }],
        nextPageToken: undefined,
      } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    const softDeleteDbScanCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes('SELECT id, amapi_name FROM devices')
    );
    expect(softDeleteDbScanCall).toBeDefined();

    const deviceSoftDeleteUpdate = mockExecute.mock.calls.find(
      (call) =>
        String(call[0]).includes("state = 'DELETED'") &&
        String(call[0]).includes('WHERE id = $1') &&
        Array.isArray(call[1]) &&
        call[1][0] === 'db_missing_1'
    );
    expect(deviceSoftDeleteUpdate).toBeDefined();

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'device.deleted_by_reconciliation',
        resource_id: 'db_missing_1',
      })
    );
  });

  it('ingests current networkInfo IMEI and plural telephony metadata', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'env_1',
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        },
      ] as never)
      .mockResolvedValueOnce([] as never) // local devices
      .mockResolvedValueOnce([] as never); // enrollment_tokens local rows

    const device = {
      name: 'enterprises/e1/devices/d1',
      networkInfo: {
        imei: 'current-top-level-imei',
        telephonyInfos: [
          {
            phoneNumber: '+441234567890',
            carrierName: 'Example Mobile',
            iccId: '8944000000000000001',
            activationState: 'ACTIVATED',
            configMode: 'ADMIN_CONFIGURED',
          },
        ],
        telephonyInfo: [{ imei: 'legacy-imei-must-not-win' }],
      },
    };

    mockAmapiCall
      .mockResolvedValueOnce({ devices: [device], nextPageToken: undefined } as never)
      .mockResolvedValueOnce({ enrollmentTokens: [], nextPageToken: undefined } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    const upsert = mockExecute.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO devices')
    );
    expect(upsert).toBeDefined();
    expect(upsert?.[1]?.[5]).toBe('current-top-level-imei');
    expect(JSON.parse(String(upsert?.[1]?.[17]))).toEqual(device);
  });

  it('falls back to legacy singular telephonyInfo IMEI when reading an old shape', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'env_1',
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    mockAmapiCall
      .mockResolvedValueOnce({
        devices: [{
          name: 'enterprises/e1/devices/legacy',
          networkInfo: { telephonyInfo: [{ imei: 'legacy-snapshot-imei' }] },
        }],
        nextPageToken: undefined,
      } as never)
      .mockResolvedValueOnce({ enrollmentTokens: [], nextPageToken: undefined } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    const upsert = mockExecute.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO devices')
    );
    expect(upsert?.[1]?.[5]).toBe('legacy-snapshot-imei');
  });

  it('retains an existing current row and preserves predecessor history', async () => {
    const previousName = 'enterprises/e1/devices/old-device';
    const currentName = 'enterprises/e1/devices/current-device';
    mockQuery
      .mockResolvedValueOnce([{
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj_1',
      }] as never)
      .mockResolvedValueOnce([
        { id: 'current_1', amapi_name: currentName },
        { id: 'predecessor_1', amapi_name: previousName },
      ] as never)
      .mockResolvedValueOnce([] as never);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'current_1',
            amapi_name: currentName,
            serial_number: 'SERIAL-1',
            imei: null,
            deleted_at: null,
            enrollment_time: '2026-02-01T00:00:00.000Z',
            last_status_report_at: '2026-02-02T00:00:00.000Z',
            created_at: '2026-02-01T00:00:00.000Z',
          },
          {
            id: 'predecessor_1',
            amapi_name: previousName,
            serial_number: 'SERIAL-1',
            imei: null,
            deleted_at: null,
            enrollment_time: '2026-01-01T00:00:00.000Z',
            last_status_report_at: '2026-01-02T00:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    mockAmapiCall
      .mockResolvedValueOnce({
        devices: [{
          name: currentName,
          previousDeviceNames: [previousName],
          hardwareInfo: { serialNumber: 'SERIAL-1' },
          enrollmentTime: '2026-03-01T00:00:00.000Z',
        }],
        nextPageToken: undefined,
      } as never)
      .mockResolvedValueOnce({ enrollmentTokens: [], nextPageToken: undefined } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    const allSql = [
      ...mockExecute.mock.calls.map(([sql]) => String(sql)),
      ...mockClientQuery.mock.calls.map(([sql]) => String(sql)),
    ];
    expect(allSql.some((sql) => sql.includes('DELETE FROM devices'))).toBe(false);
    expect(allSql.some((sql) => sql.includes('UPDATE devices SET amapi_name'))).toBe(false);

    const upsertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO devices')
    );
    expect(upsertCall?.[1]?.[14]).toBe('2026-03-01T00:00:00.000Z');
    expect(upsertCall?.[1]?.[16]).toEqual([previousName]);

    expect(mockExecute.mock.calls.some(([sql, params]) =>
      String(sql).includes("state = 'DELETED'") && params?.[0] === 'predecessor_1'
    )).toBe(true);
  });

  it('renames the best canonical predecessor atomically when no current row exists', async () => {
    const stalePreviousName = 'enterprises/e1/devices/old-stale';
    const matchingPreviousName = 'enterprises/e1/devices/old-matching';
    const currentName = 'enterprises/e1/devices/current-device';
    mockQuery
      .mockResolvedValueOnce([{
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj_1',
      }] as never)
      .mockResolvedValueOnce([{ id: 'predecessor_matching', amapi_name: currentName }] as never)
      .mockResolvedValueOnce([] as never);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'predecessor_stale',
            amapi_name: stalePreviousName,
            serial_number: 'OTHER',
            imei: null,
            deleted_at: null,
            enrollment_time: '2026-02-01T00:00:00.000Z',
            last_status_report_at: '2026-02-02T00:00:00.000Z',
            created_at: '2026-02-01T00:00:00.000Z',
          },
          {
            id: 'predecessor_matching',
            amapi_name: matchingPreviousName,
            serial_number: 'SERIAL-1',
            imei: 'IMEI-1',
            deleted_at: null,
            enrollment_time: '2026-01-01T00:00:00.000Z',
            last_status_report_at: '2026-01-02T00:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    mockAmapiCall
      .mockResolvedValueOnce({
        devices: [{
          name: currentName,
          previousDeviceNames: [stalePreviousName, matchingPreviousName],
          hardwareInfo: { serialNumber: 'SERIAL-1' },
          networkInfo: { imei: 'IMEI-1' },
        }],
        nextPageToken: undefined,
      } as never)
      .mockResolvedValueOnce({ enrollmentTokens: [], nextPageToken: undefined } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    expect(mockClientQuery.mock.calls.some(([sql, params]) =>
      String(sql).includes('UPDATE devices SET amapi_name = $1')
      && params?.[0] === currentName
      && params?.[1] === 'predecessor_matching'
    )).toBe(true);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO devices')
    )).toBe(true);
    expect(mockExecute.mock.calls.some(([sql]) =>
      String(sql).includes('DELETE FROM devices')
    )).toBe(false);
  });

  it('falls back to preserving the current row when a concurrent rename wins', async () => {
    const previousName = 'enterprises/e1/devices/old-device';
    const currentName = 'enterprises/e1/devices/current-device';
    mockQuery
      .mockResolvedValueOnce([{
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj_1',
      }] as never)
      .mockResolvedValueOnce([{ id: 'current_1', amapi_name: currentName }] as never)
      .mockResolvedValueOnce([] as never);
    mockTransaction.mockRejectedValueOnce(Object.assign(new Error(
      'duplicate key value violates unique constraint "devices_amapi_name_key"'
    ), {
      code: '23505',
      constraint: 'devices_amapi_name_key',
    }));
    mockAmapiCall
      .mockResolvedValueOnce({
        devices: [{ name: currentName, previousDeviceNames: [previousName] }],
        nextPageToken: undefined,
      } as never)
      .mockResolvedValueOnce({ enrollmentTokens: [], nextPageToken: undefined } as never);

    const response = await handler(
      new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'),
      {} as never
    );

    expect(response.status).toBe(200);
    expect(mockExecute.mock.calls.some(([sql, params]) =>
      String(sql).includes('INSERT INTO devices') && params?.[2] === currentName
    )).toBe(true);
    expect(mockExecute.mock.calls.some(([sql]) =>
      String(sql).includes('DELETE FROM devices')
    )).toBe(false);
  });

  it('does not revive a historical predecessor referenced by an active successor', async () => {
    const historicalName = 'enterprises/e1/devices/historical';
    mockQuery
      .mockResolvedValueOnce([{
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj_1',
      }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    mockQueryOne.mockResolvedValueOnce({
      id: 'successor_1',
      amapi_name: 'enterprises/e1/devices/current',
    } as never);
    mockAmapiCall.mockResolvedValueOnce({
      devices: [{ name: historicalName }],
      nextPageToken: undefined,
    } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    expect(mockExecute.mock.calls.some(([sql, params]) =>
      String(sql).includes('INSERT INTO devices') && params?.[2] === historicalName
    )).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('soft-deletes every stale local device after a successful empty AMAPI listing', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'env_1',
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        },
      ] as never)
      .mockResolvedValueOnce([
        { id: 'db_missing_1', amapi_name: 'enterprises/e1/devices/missing-1' },
        { id: 'db_missing_2', amapi_name: 'enterprises/e1/devices/missing-2' },
      ] as never)
      .mockResolvedValueOnce([] as never);

    mockAmapiCall.mockResolvedValueOnce({ devices: [], nextPageToken: undefined } as never);

    await handler(new Request('http://localhost/.netlify/functions/sync-reconcile-scheduled'), {} as never);

    const deletedIds = mockExecute.mock.calls
      .filter(([sql]) => String(sql).includes("state = 'DELETED'") && String(sql).includes('WHERE id = $1'))
      .map(([, params]) => params?.[0]);
    expect(deletedIds).toEqual(['db_missing_1', 'db_missing_2']);
    expect(mockLogAudit).toHaveBeenCalledTimes(2);
  });
});
