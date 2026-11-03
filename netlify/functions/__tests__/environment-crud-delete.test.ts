import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLockClientQuery = vi.fn();

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  withClient: vi.fn(async (fn: (client: { query: typeof mockLockClientQuery }) => Promise<unknown>) => fn({ query: mockLockClientQuery })),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  getWorkspaceAccessScopeForAuth: vi.fn(),
  requireEnvironmentPermission: vi.fn(),
  requireWorkspaceResourcePermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../environment-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockLogAudit = vi.mocked(logAudit);

beforeEach(() => {
  mockQueryOne.mockReset();
  mockLockClientQuery.mockReset();
  mockLockClientQuery.mockImplementation(async (sql: string) => ({
    rows: String(sql).includes('pg_try_advisory_lock') ? [{ locked: true }] : [{ unlocked: true }],
  }));
  mockTransaction.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    authType: 'session',
    sessionId: 'sess_1',
    user: { id: '11111111-1111-4111-8111-111111111111', is_superadmin: false },
  } as never);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
  mockLogAudit.mockResolvedValue(undefined as never);
});

describe('environment-crud delete hardening', () => {
  it.each(['has_keys', 'has_signup_links'])('blocks %s without issuing deletion statements', async (dependency) => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: '22222222-2222-4222-8222-222222222222' } as never);
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ [dependency]: true }] }) };
    mockTransaction.mockImplementationOnce(async (fn) => fn(client as never));
    const res = await handler(new Request('http://localhost/api/environments/33333333-3333-4333-8333-333333333333', { method: 'DELETE' }), {} as never);
    expect(res.status).toBe(409);
    expect(String(mockLockClientQuery.mock.calls[0]?.[0])).toContain('pg_try_advisory_lock');
    expect(client.query.mock.calls.some(([sql]) => /^(DELETE|UPDATE)/.test(sql))).toBe(false);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('skips optional legacy cleanup failures and still deletes environment', async () => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: '22222222-2222-4222-8222-222222222222' } as never);

    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.startsWith('UPDATE audit_log SET details') && sql.includes('deleted_environment_id')) throw { code: '42P01' };
        if (sql.startsWith('DELETE FROM pubsub_events')) throw { code: '42703' };
        if (sql.startsWith('SELECT id FROM workspaces')) return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockTransaction.mockImplementationOnce(async (cb: (tx: typeof client) => Promise<unknown>) => cb(client) as never);

    const res = await handler(
      new Request('http://localhost/api/environments/33333333-3333-4333-8333-333333333333', { method: 'DELETE' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ message: 'Environment deleted' });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT environment_cleanup');
    expect(client.query).toHaveBeenLastCalledWith('DELETE FROM environments WHERE id = $1', expect.any(Array));
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'environment.deleted',
      workspace_id: '22222222-2222-4222-8222-222222222222',
      resource_id: '33333333-3333-4333-8333-333333333333',
    }));
  });

  it('returns 409 when delete is blocked by dependent records', async () => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: '22222222-2222-4222-8222-222222222222' } as never);
    mockTransaction.mockRejectedValueOnce({ code: '23503' } as never);

    const res = await handler(
      new Request('http://localhost/api/environments/33333333-3333-4333-8333-333333333333', { method: 'DELETE' }),
      {} as never
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Environment deletion is blocked by related records. No local changes were committed. Contact support to review the dependencies.',
    });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});
