import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query, execute } from '../_lib/db.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../sync-reconcile-scheduled.ts';

const mockQuery = vi.mocked(query);
const mockExecute = vi.mocked(execute);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);

describe('sync-reconcile-scheduled', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockExecute.mockReset();
    mockAmapiCall.mockReset();
    mockLogAudit.mockReset();
    mockExecute.mockResolvedValue({ rowCount: 0 } as never);
    mockLogAudit.mockResolvedValue(undefined as never);
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
});
