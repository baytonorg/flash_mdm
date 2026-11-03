import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  execute: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../_lib/internal-auth.js', () => ({
  requireInternalCaller: vi.fn(),
}));

import { execute, queryOne } from '../_lib/db.js';
import handler from '../cleanup-scheduled.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const DELETE_BATCH_SIZE = 10_000;

describe('cleanup-scheduled retention jobs', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockQueryOne.mockReset();
    mockQueryOne.mockResolvedValue({ count: 3 } as never);
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ rowCount: 1 });
    process.env = { ...originalEnv };
  });

  it('runs cleanup queries with secure default retention values', async () => {
    await handler(new Request('http://localhost/.netlify/functions/cleanup-scheduled'), {} as never);

    expect(mockExecute).toHaveBeenCalledTimes(11);
    expect(mockExecute.mock.calls[1]?.[0]).toContain("'delivery_uncertain'");
    expect(mockExecute.mock.calls.some(([sql]) => sql.includes('UPDATE api_keys'))).toBe(false);
    expect(mockExecute.mock.calls[3]?.[1]).toEqual([30, DELETE_BATCH_SIZE]); // audit log
    expect(mockExecute.mock.calls[4]?.[1]).toEqual([90, DELETE_BATCH_SIZE]); // device locations
    expect(mockExecute.mock.calls[5]?.[1]).toEqual([90, DELETE_BATCH_SIZE]); // status reports
    expect(mockExecute.mock.calls[6]?.[0]).toContain("status IN ('submitted', 'succeeded', 'failed', 'cancelled')");
    expect(mockExecute.mock.calls[6]?.[0]).not.toContain("'delivery_uncertain'");
    expect(mockExecute.mock.calls[6]?.[0]).not.toContain("'reconciling'");
    expect(mockExecute.mock.calls[6]?.[0]).not.toContain("'unresolved'");
    expect(mockExecute.mock.calls[6]?.[1]).toEqual([180, DELETE_BATCH_SIZE]); // command operations
    expect(mockExecute.mock.calls[7]?.[1]).toEqual([30, DELETE_BATCH_SIZE]); // flashagent chat messages
    expect(mockExecute.mock.calls[8]?.[1]).toEqual([30]); // audit refs nulling
    expect(mockExecute.mock.calls[9]?.[1]).toEqual([30]); // workflow refs nulling
    expect(mockExecute.mock.calls[10]?.[1]).toEqual([30, DELETE_BATCH_SIZE]); // hard delete devices
  });

  it('uses positive integer env overrides and ignores invalid values', async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = '730';
    process.env.DEVICE_LOCATION_RETENTION_DAYS = '120';
    process.env.DEVICE_STATUS_REPORT_RETENTION_DAYS = '-5'; // invalid -> fallback
    process.env.COMMAND_OPERATION_RETENTION_DAYS = '365';
    process.env.SOFT_DELETED_DEVICE_RETENTION_DAYS = '45';

    await handler(new Request('http://localhost/.netlify/functions/cleanup-scheduled'), {} as never);

    expect(mockExecute.mock.calls[3]?.[1]).toEqual([730, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[4]?.[1]).toEqual([120, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[5]?.[1]).toEqual([90, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[6]?.[1]).toEqual([365, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[7]?.[1]).toEqual([30, DELETE_BATCH_SIZE]);
    expect(mockExecute.mock.calls[8]?.[1]).toEqual([45]);
    expect(mockExecute.mock.calls[9]?.[1]).toEqual([45]);
    expect(mockExecute.mock.calls[10]?.[1]).toEqual([45, DELETE_BATCH_SIZE]);
  });

  it('observes bounded credential counts and rejects credential mutations while retaining other cleanup', async () => {
    const rejectsCredentialMutation = (sql: string) => {
      if (/\b(?:DELETE FROM|UPDATE)\s+(?:sessions|magic_links|user_invites|users|api_keys)\b/i.test(sql)) {
        throw new Error('credential mutation rejected');
      }
    };
    // Negative controls prove the guard catches the former maintenance statements.
    for (const sql of ['DELETE FROM sessions', 'DELETE FROM magic_links', "UPDATE user_invites SET status = 'expired'", 'UPDATE users SET totp_pending_enc = NULL']) {
      expect(() => rejectsCredentialMutation(sql)).toThrow('credential mutation rejected');
    }
    mockExecute.mockImplementation(async sql => { rejectsCredentialMutation(sql); return { rowCount: 1 }; });
    mockQueryOne.mockImplementation(async (sql, params) => {
      rejectsCredentialMutation(sql);
      expect(sql).toMatch(/^SELECT count\(\*\)::int AS count/);
      expect(sql).toContain('SELECT 1 FROM');
      expect(params).toEqual([10001]);
      return { count: 10001 } as never;
    });
    const response = await handler(new Request('http://localhost/.netlify/functions/cleanup-scheduled'), {} as never);
    expect(response.status).toBe(200);
    const { stats } = await response.json();
    for (const key of ['expired_sessions', 'expired_magic_links', 'expired_invites', 'stale_totp_pending_secrets']) {
      expect(stats[key]).toBe(0);
      expect(stats[`observed_${key}`]).toBe(10000);
      expect(stats[`observed_${key}_truncated`]).toBe(1);
    }
    expect(mockQueryOne).toHaveBeenCalledTimes(4);
    expect(mockExecute).toHaveBeenCalledTimes(11);
    expect(stats.deleted_jobs).toBe(1);
    expect(stats.deleted_audit_log_rows).toBe(1);
    expect(stats.deleted_soft_deleted_devices).toBe(1);
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
    expect(auditDeleteCalls[0]?.[1]).toEqual([30, DELETE_BATCH_SIZE]);

    expect(logSpy).toHaveBeenCalledWith(
      'Daily cleanup completed:',
      expect.objectContaining({
        deleted_audit_log_rows: DELETE_BATCH_SIZE * 2 + 5,
      })
    );

    logSpy.mockRestore();
  });
});
