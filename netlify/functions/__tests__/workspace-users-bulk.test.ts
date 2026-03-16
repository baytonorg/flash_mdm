import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({
  requireWorkspacePermission: vi.fn(),
  getWorkspaceAccessScope: vi.fn(),
  getWorkspaceAccessScopeForAuth: vi.fn(),
  getWorkspaceRole: vi.fn(),
  getWorkspaceRoleForAuth: vi.fn(),
}));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));

import { query, queryOne, execute, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireWorkspacePermission } from '../_lib/rbac.js';
import handler from '../workspace-users.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspacePermission = vi.mocked(requireWorkspacePermission);

describe('POST /api/workspaces/users/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      user: { id: '11111111-1111-4111-8111-111111111111', is_superadmin: false },
    } as never);
    mockRequireWorkspacePermission.mockResolvedValue('admin' as never);
  });

  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/workspaces/users/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('bulk remove blocks modifying self', async () => {
    const res = await handler(makeRequest({
      workspace_id: '22222222-2222-4222-8222-222222222222',
      operation: 'remove',
      selection: { ids: ['11111111-1111-4111-8111-111111111111'] },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      ok: false,
      error: 'Cannot modify your own membership in bulk',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('bulk access_overwrite enforces owner promotion guardrails', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'member' } as never);

    const res = await handler(makeRequest({
      workspace_id: '22222222-2222-4222-8222-222222222222',
      operation: 'access_overwrite',
      selection: { ids: ['33333333-3333-4333-8333-333333333333'] },
      options: {
        role: 'owner',
        access_scope: 'workspace',
      },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      ok: false,
      error: 'Only owners can promote to owner',
    });
  });

  it('all_matching selection excludes excluded_ids in remove operation', async () => {
    mockQuery.mockResolvedValueOnce([
      { user_id: '33333333-3333-4333-8333-333333333333' },
      { user_id: '44444444-4444-4444-8444-444444444444' },
    ] as never);
    mockQueryOne.mockResolvedValueOnce({ role: 'member' } as never);

    const res = await handler(makeRequest({
      workspace_id: '22222222-2222-4222-8222-222222222222',
      operation: 'remove',
      selection: {
        all_matching: true,
        excluded_ids: ['33333333-3333-4333-8333-333333333333'],
      },
    }), {} as never);
    const body = await res.json() as {
      total_targeted: number;
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(body.total_targeted).toBe(1);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results).toEqual([{ id: '44444444-4444-4444-8444-444444444444', ok: true }]);
    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      ['22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444'],
    );
  });

  it('bulk access_overwrite rewrites role, scope, and direct assignments on success', async () => {
    mockRequireWorkspacePermission.mockResolvedValueOnce('owner' as never);
    mockQuery
      .mockResolvedValueOnce([{ id: '55555555-5555-4555-8555-555555555555' }] as never)
      .mockResolvedValueOnce([{ id: '66666666-6666-4666-8666-666666666666' }] as never);
    mockQueryOne.mockResolvedValueOnce({ role: 'member' } as never);

    const txQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (cb: (client: { query: typeof txQuery }) => unknown) => cb({ query: txQuery }) as never);

    const res = await handler(makeRequest({
      workspace_id: '22222222-2222-4222-8222-222222222222',
      operation: 'access_overwrite',
      selection: { ids: ['33333333-3333-4333-8333-333333333333'] },
      options: {
        role: 'admin',
        access_scope: 'scoped',
        environment_ids: ['55555555-5555-4555-8555-555555555555'],
        group_ids: ['66666666-6666-4666-8666-666666666666'],
      },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean }> };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results).toEqual([{ id: '33333333-3333-4333-8333-333333333333', ok: true }]);
    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workspace_memberships SET role = $1'),
      ['admin', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'],
    );
    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET access_scope = $1'),
      ['scoped', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'],
    );
    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO environment_memberships'),
      ['55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', 'admin'],
    );
    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO group_memberships'),
      ['66666666-6666-4666-8666-666666666666', '33333333-3333-4333-8333-333333333333', 'admin'],
    );
  });
});
