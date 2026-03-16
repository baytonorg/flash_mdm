import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
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
  it('skips optional legacy cleanup failures and still deletes environment', async () => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: '22222222-2222-4222-8222-222222222222' } as never);

    const client = {
      query: vi
        .fn()
        .mockRejectedValueOnce({ code: '42P01' })
        .mockRejectedValueOnce({ code: '42703' })
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };
    mockTransaction.mockImplementationOnce(async (cb: (tx: typeof client) => Promise<unknown>) => cb(client) as never);

    const res = await handler(
      new Request('http://localhost/api/environments/33333333-3333-4333-8333-333333333333', { method: 'DELETE' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ message: 'Environment deleted' });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(vi.mocked(client.query).mock.calls[3]?.[0]).toContain('DELETE FROM environments');
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
      error: 'Environment delete blocked by dependent records. Retry after pending background activity completes.',
    });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});
