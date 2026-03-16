import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  execute: vi.fn(),
}));

vi.mock('../_lib/internal-auth.js', () => ({
  requireInternalCaller: vi.fn(),
}));

import { execute } from '../_lib/db.js';
import handler from '../cleanup-scheduled.ts';

const mockExecute = vi.mocked(execute);
const DELETE_BATCH_SIZE = 10_000;

describe('cleanup-scheduled retention jobs', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ rowCount: 1 });
    process.env = { ...originalEnv };
  });

  it('runs cleanup queries with secure default retention values', async () => {
    await handler(new Request('http://localhost/.netlify/functions/cleanup-scheduled'), {} as never);

    expect(mockExecute).toHaveBeenCalledTimes(15);
    expect(mockExecute.mock.calls[6]?.[0]).toContain('totp_pending_created_at');
    expect(mockExecute.mock.calls[7]?.[0]).toContain('UPDATE api_keys');
    expect(mockExecute.mock.calls[8]?.[1]).toEqual([365, DELETE_BATCH_SIZE]); // audit log
    expect(mockExecute.mock.calls[9]?.[1]).toEqual([90, DELETE_BATCH_SIZE]); // device locations
    expect(mockExecute.mock.calls[10]?.[1]).toEqual([90, DELETE_BATCH_SIZE]); // status reports
    expect(mockExecute.mock.calls[11]?.[1]).toEqual([30, DELETE_BATCH_SIZE]); // flashagent chat messages
    expect(mockExecute.mock.calls[12]?.[1]).toEqual([30]); // audit refs nulling
    expect(mockExecute.mock.calls[13]?.[1]).toEqual([30]); // workflow refs nulling
    expect(mockExecute.mock.calls[14]?.[1]).toEqual([30, DELETE_BATCH_SIZE]); // hard delete devices
  });

  it('uses positive integer env overrides and ignores invalid values', async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = '730';
    process.env.DEVICE_LOCATION_RETENTION_DAYS = '120';
    process.env.DEVICE_STATUS_REPORT_RETENTION_DAYS = '-5'; // invalid -> fallback
    process.env.SOFT_DELETED_DEVICE_RETENTION_DAYS = '45';

    await handler(new Request('http://localhost/.netlify/functions/cleanup-scheduled'), {} as never);

    expect(mockExecute.mock.calls[8]?.[1]).toEqual([730, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[9]?.[1]).toEqual([120, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[10]?.[1]).toEqual([90, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[11]?.[1]).toEqual([30, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[12]?.[1]).toEqual([45]);
    expect(mockExecute.mock.calls[13]?.[1]).toEqual([45]);
    expect(mockExecute.mock.calls[14]?.[1]).toEqual([45, DELETE_BATCH_SIZE]);
  });

  it('clears stale pending TOTP setup secrets', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockExecute.mockImplementation(async (sql) => {
      if (sql.includes('totp_pending_created_at')) {
        return { rowCount: 3 };
      }
      return { rowCount: 1 };
    });

    await handler(new Request('http://localhost/.netlify/functions/cleanup-scheduled'), {} as never);

    const staleTotpCall = mockExecute.mock.calls.find(
      ([sql]) => sql.includes('totp_pending_created_at')
    );
    expect(staleTotpCall).toBeDefined();
    expect(logSpy).toHaveBeenCalledWith(
      'Daily cleanup completed:',
      expect.objectContaining({
        stale_totp_pending_secrets: 3,
      })
    );

    logSpy.mockRestore();
  });

  it('batches large deletes in loops until a partial batch is reached', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const auditBatchResults = [DELETE_BATCH_SIZE, DELETE_BATCH_SIZE, 5];

    mockExecute.mockImplementation(async (sql) => {
      if (sql.includes('DELETE FROM audit_log')) {
        return { rowCount: auditBatchResults.shift() ?? 0 };
      }
      return { rowCount: 1 };
    });

    await handler(new Request('http://localhost/.netlify/functions/cleanup-scheduled'), {} as never);

    const auditDeleteCalls = mockExecute.mock.calls.filter(([sql]) => sql.includes('DELETE FROM audit_log'));
    expect(auditDeleteCalls).toHaveLength(3);
    expect(auditDeleteCalls[0]?.[0]).toContain('SELECT id FROM audit_log');
    expect(auditDeleteCalls[0]?.[0]).toContain('LIMIT $2');
    expect(auditDeleteCalls[0]?.[1]).toEqual([365, DELETE_BATCH_SIZE]);

    expect(logSpy).toHaveBeenCalledWith(
      'Daily cleanup completed:',
      expect.objectContaining({
        deleted_audit_log_rows: DELETE_BATCH_SIZE * 2 + 5,
      })
    );

    logSpy.mockRestore();
  });
});
