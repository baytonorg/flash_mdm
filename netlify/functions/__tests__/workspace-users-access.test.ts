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
  requireWorkspacePermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
  getWorkspaceRole: vi.fn(),
  getWorkspaceAccessScope: vi.fn(),
  getWorkspaceRoleForAuth: vi.fn(),
  getWorkspaceAccessScopeForAuth: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query, queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import {
  getWorkspaceAccessScope,
  getWorkspaceAccessScopeForAuth,
  getWorkspaceRole,
  getWorkspaceRoleForAuth,
  requireEnvironmentResourcePermission,
  requireWorkspacePermission,
} from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../workspace-users.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspacePermission = vi.mocked(requireWorkspacePermission);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockGetWorkspaceRole = vi.mocked(getWorkspaceRole);
const mockGetWorkspaceAccessScope = vi.mocked(getWorkspaceAccessScope);
const mockGetWorkspaceRoleForAuth = vi.mocked(getWorkspaceRoleForAuth);
const mockGetWorkspaceAccessScopeForAuth = vi.mocked(getWorkspaceAccessScopeForAuth);
const mockLogAudit = vi.mocked(logAudit);

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/workspaces/users/access', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(workspaceId: string) {
  return new Request(`http://localhost/api/workspaces/users?workspace_id=${workspaceId}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockTransaction.mockReset();
  mockRequireAuth.mockReset();
  mockRequireWorkspacePermission.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockGetWorkspaceRole.mockReset();
  mockGetWorkspaceAccessScope.mockReset();
  mockGetWorkspaceRoleForAuth.mockReset();
  mockGetWorkspaceAccessScopeForAuth.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    user: { id: '22222222-2222-4222-8222-222222222222', is_superadmin: false },
  } as never);
  mockRequireWorkspacePermission.mockResolvedValue('admin' as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue('admin' as never);
  mockGetWorkspaceRole.mockResolvedValue('admin' as never);
  mockGetWorkspaceAccessScope.mockResolvedValue('workspace' as never);
  mockGetWorkspaceRoleForAuth.mockResolvedValue('admin' as never);
  mockGetWorkspaceAccessScopeForAuth.mockResolvedValue('workspace' as never);
});

describe('workspace-users access assignments', () => {
  it('rejects malformed workspace_id on GET before RBAC checks', async () => {
    const res = await handler(makeGetRequest('not-a-uuid'), {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'workspace_id must be a valid UUID',
    });
    expect(mockGetWorkspaceRoleForAuth).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns a limited scoped view for scoped admins', async () => {
    mockGetWorkspaceRoleForAuth.mockResolvedValueOnce('admin' as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('scoped' as never).mockResolvedValueOnce('scoped' as never);
    mockGetWorkspaceRole.mockResolvedValueOnce('admin' as never);
    mockGetWorkspaceAccessScope.mockResolvedValueOnce('scoped' as never);
    mockQuery
      .mockResolvedValueOnce([{ environment_id: '44444444-4444-4444-8444-444444444444' }] as never)
      .mockResolvedValueOnce([{ group_id: '66666666-6666-4666-8666-666666666666', environment_id: '44444444-4444-4444-8444-444444444444' }] as never)
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'actor@example.com',
          first_name: 'Actor',
          last_name: 'Admin',
          role: 'admin',
          access_scope: 'scoped',
          joined_at: new Date().toISOString(),
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          email: 'user2@example.com',
          first_name: 'User',
          last_name: 'Two',
          role: 'member',
          access_scope: 'scoped',
          joined_at: new Date().toISOString(),
        },
      ] as never)
      .mockResolvedValueOnce([
        { user_id: '22222222-2222-4222-8222-222222222222', environment_id: '44444444-4444-4444-8444-444444444444', environment_name: 'Env 1', role: 'admin' },
        { user_id: '33333333-3333-4333-8333-333333333333', environment_id: '44444444-4444-4444-8444-444444444444', environment_name: 'Env 1', role: 'member' },
      ] as never)
      .mockResolvedValueOnce([
        { user_id: '22222222-2222-4222-8222-222222222222', group_id: '66666666-6666-4666-8666-666666666666', group_name: 'HR', role: 'admin', environment_id: '44444444-4444-4444-8444-444444444444', environment_name: 'Env 1', parent_group_id: null },
        { user_id: '33333333-3333-4333-8333-333333333333', group_id: '66666666-6666-4666-8666-666666666666', group_name: 'HR', role: 'member', environment_id: '44444444-4444-4444-8444-444444444444', environment_name: 'Env 1', parent_group_id: null },
      ] as never);

    const res = await handler(makeGetRequest('11111111-1111-4111-8111-111111111111'), {} as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.limited_view).toBe(true);
    expect(body.users).toHaveLength(2);
    expect(body.users.map((u: any) => u.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'manage_users'
    );
  });

  it('honors RBAC permission checks for GET instead of a hardcoded member floor', async () => {
    mockRequireWorkspacePermission.mockResolvedValueOnce('viewer' as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('workspace' as never);
    mockGetWorkspaceRole.mockResolvedValueOnce('viewer' as never);

    mockQuery
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'actor@example.com',
          first_name: 'Actor',
          last_name: 'Viewer',
          role: 'viewer',
          access_scope: 'workspace',
          joined_at: new Date().toISOString(),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const res = await handler(makeGetRequest('11111111-1111-4111-8111-111111111111'), {} as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      users: [
        expect.objectContaining({
          id: '22222222-2222-4222-8222-222222222222',
          role: 'viewer',
        }),
      ],
      limited_view: false,
    });
    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'manage_users'
    );
  });

  it('returns scoped limited view when caller lacks manage_users but has read access', async () => {
    mockRequireWorkspacePermission
      .mockRejectedValueOnce(
        new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce('viewer' as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('scoped' as never);
    mockQuery
      .mockResolvedValueOnce([
        {
          environment_id: '44444444-4444-4444-8444-444444444444',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          group_id: '66666666-6666-4666-8666-666666666666',
          environment_id: '44444444-4444-4444-8444-444444444444',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'actor@example.com',
          first_name: 'Actor',
          last_name: 'Viewer',
          role: 'viewer',
          access_scope: 'scoped',
          joined_at: new Date().toISOString(),
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          email: 'teammate@example.com',
          first_name: 'Team',
          last_name: 'Mate',
          role: 'member',
          access_scope: 'scoped',
          joined_at: new Date().toISOString(),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          user_id: '22222222-2222-4222-8222-222222222222',
          environment_id: '44444444-4444-4444-8444-444444444444',
          environment_name: 'Env 1',
          role: 'owner',
        },
        {
          user_id: '33333333-3333-4333-8333-333333333333',
          environment_id: '44444444-4444-4444-8444-444444444444',
          environment_name: 'Env 1',
          role: 'member',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          user_id: '22222222-2222-4222-8222-222222222222',
          group_id: '66666666-6666-4666-8666-666666666666',
          group_name: 'Root',
          role: 'owner',
          environment_id: '44444444-4444-4444-8444-444444444444',
          environment_name: 'Env 1',
          parent_group_id: null,
        },
        {
          user_id: '33333333-3333-4333-8333-333333333333',
          group_id: '66666666-6666-4666-8666-666666666666',
          group_name: 'Root',
          role: 'member',
          environment_id: '44444444-4444-4444-8444-444444444444',
          environment_name: 'Env 1',
          parent_group_id: null,
        },
      ] as never);

    const res = await handler(makeGetRequest('11111111-1111-4111-8111-111111111111'), {} as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.limited_view).toBe(true);
    expect(body.users).toHaveLength(2);
    expect(body.users.map((u: any) => u.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(body.users[0]).toEqual(expect.objectContaining({
      id: '22222222-2222-4222-8222-222222222222',
      environment_assignments: [expect.objectContaining({ role: 'owner' })],
      group_assignments: [expect.objectContaining({ role: 'owner' })],
    }));
    expect(mockRequireWorkspacePermission).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'manage_users'
    );
    expect(mockRequireWorkspacePermission).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'read'
    );
  });

  it('returns scoped limited view even when workspace read is denied', async () => {
    mockRequireWorkspacePermission
      .mockRejectedValueOnce(
        new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(
        new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('scoped' as never);
    mockQuery
      .mockResolvedValueOnce([
        {
          environment_id: '44444444-4444-4444-8444-444444444444',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          group_id: '66666666-6666-4666-8666-666666666666',
          environment_id: '44444444-4444-4444-8444-444444444444',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'actor@example.com',
          first_name: 'Actor',
          last_name: 'Member',
          role: 'member',
          access_scope: 'scoped',
          joined_at: new Date().toISOString(),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          user_id: '22222222-2222-4222-8222-222222222222',
          environment_id: '44444444-4444-4444-8444-444444444444',
          environment_name: 'Env 1',
          role: 'member',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          user_id: '22222222-2222-4222-8222-222222222222',
          group_id: '66666666-6666-4666-8666-666666666666',
          group_name: 'Root',
          role: 'member',
          environment_id: '44444444-4444-4444-8444-444444444444',
          environment_name: 'Env 1',
          parent_group_id: null,
        },
      ] as never);

    const res = await handler(makeGetRequest('11111111-1111-4111-8111-111111111111'), {} as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.limited_view).toBe(true);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toEqual(expect.objectContaining({
      id: '22222222-2222-4222-8222-222222222222',
      role: 'member',
    }));
  });

  it('uses correct fallback params when scoped access_scope column is missing', async () => {
    mockGetWorkspaceRoleForAuth.mockResolvedValueOnce('admin' as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('scoped' as never).mockResolvedValueOnce('scoped' as never);
    mockGetWorkspaceRole.mockResolvedValueOnce('admin' as never);
    mockGetWorkspaceAccessScope.mockResolvedValueOnce('scoped' as never);

    mockQuery
      .mockResolvedValueOnce([{ environment_id: '44444444-4444-4444-8444-444444444444' }] as never)
      .mockResolvedValueOnce([{ group_id: '66666666-6666-4666-8666-666666666666', environment_id: '44444444-4444-4444-8444-444444444444' }] as never)
      .mockRejectedValueOnce(new Error('column wm.access_scope does not exist') as never)
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'actor@example.com',
          first_name: 'Actor',
          last_name: 'Admin',
          role: 'admin',
          access_scope: 'workspace',
          joined_at: new Date().toISOString(),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const res = await handler(makeGetRequest('11111111-1111-4111-8111-111111111111'), {} as never);
    expect(res.status).toBe(200);

    const fallbackCall = mockQuery.mock.calls[3];
    expect(String(fallbackCall?.[0])).toContain('FROM workspace_memberships wm');
    expect(fallbackCall?.[1]).toEqual(['11111111-1111-4111-8111-111111111111']);
  });

  it('updates access scope and scoped assignments transactionally', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    mockTransaction.mockImplementation(async (cb: any) => cb(client) as never);

    mockQueryOne.mockResolvedValueOnce({ role: 'member' } as never);
    mockQuery
      .mockResolvedValueOnce([{ id: '44444444-4444-4444-8444-444444444444' }, { id: '55555555-5555-4555-8555-555555555555' }] as never)
      .mockResolvedValueOnce([{ id: '66666666-6666-4666-8666-666666666666' }] as never);

    const res = await handler(
      makeRequest({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        user_id: '33333333-3333-4333-8333-333333333333',
        access_scope: 'scoped',
        environment_ids: ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'],
        group_ids: ['66666666-6666-4666-8666-666666666666'],
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith(expect.anything(), '11111111-1111-4111-8111-111111111111', 'manage_users');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect((client.query as any).mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE workspace_memberships'))).toBe(true);
    expect((client.query as any).mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO environment_memberships'))).toBe(true);
    expect((client.query as any).mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO group_memberships'))).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace.user_access_updated',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      resource_id: '33333333-3333-4333-8333-333333333333',
    }));
  });

  it('rejects changing your own access assignment', async () => {
    const res = await handler(
      makeRequest({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        user_id: '22222222-2222-4222-8222-222222222222',
        access_scope: 'workspace',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Cannot change your own access assignment',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed environment_ids/group_ids before validation queries', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'member' } as never);

    const res = await handler(
      makeRequest({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        user_id: '33333333-3333-4333-8333-333333333333',
        access_scope: 'scoped',
        environment_ids: ['bad-env-id'],
        group_ids: ['bad-group-id'],
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'environment_ids must contain only valid UUIDs',
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('allows environment-scoped managers to update assignments inside acting environment only', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    mockTransaction.mockImplementation(async (cb: any) => cb(client) as never);

    mockRequireWorkspacePermission
      .mockRejectedValueOnce(
        new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    mockQueryOne.mockImplementation(async (_sql: string, params?: unknown[]) => {
      const userId = Array.isArray(params) ? String(params[1] ?? '') : '';
      if (userId === '22222222-2222-4222-8222-222222222222') {
        return { role: 'member', access_scope: 'workspace' } as never;
      }
      if (userId === '33333333-3333-4333-8333-333333333333') {
        return { role: 'member', access_scope: 'scoped' } as never;
      }
      return { id: '44444444-4444-4444-8444-444444444444' } as never;
    });

    mockQuery
      .mockResolvedValueOnce([{ id: '44444444-4444-4444-8444-444444444444' }] as never)
      .mockResolvedValueOnce([{ id: '66666666-6666-4666-8666-666666666666' }] as never)
      .mockResolvedValueOnce([{ id: '66666666-6666-4666-8666-666666666666' }] as never);

    const res = await handler(
      makeRequest({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        user_id: '33333333-3333-4333-8333-333333333333',
        access_scope: 'scoped',
        acting_environment_id: '44444444-4444-4444-8444-444444444444',
        environment_ids: ['44444444-4444-4444-8444-444444444444'],
        group_ids: ['66666666-6666-4666-8666-666666666666'],
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'User environment access assignment updated',
    });
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      '44444444-4444-4444-8444-444444444444',
      'environment',
      'manage_users'
    );
    expect((client.query as any).mock.calls.some((c: any[]) => String(c[0]).includes('DELETE FROM environment_memberships'))).toBe(true);
    const envInsertCall = (client.query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO environment_memberships')
    );
    expect(envInsertCall).toBeTruthy();
    expect(envInsertCall[1]).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'member',
    ]);
    expect((client.query as any).mock.calls.some((c: any[]) => String(c[0]).includes('DELETE FROM group_memberships'))).toBe(true);
    const groupInsertCall = (client.query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO group_memberships')
    );
    expect(groupInsertCall).toBeTruthy();
    expect(groupInsertCall[1]).toEqual([
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'member',
    ]);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace.user_environment_access_updated',
      environment_id: '44444444-4444-4444-8444-444444444444',
    }));
  });

  it('blocks removing users inherited from workspace scope in environment-scoped mode', async () => {
    mockRequireWorkspacePermission
      .mockRejectedValueOnce(
        new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    mockQueryOne.mockImplementation(async (_sql: string, params?: unknown[]) => {
      const userId = Array.isArray(params) ? String(params[1] ?? '') : '';
      if (userId === '22222222-2222-4222-8222-222222222222') {
        return { role: 'member', access_scope: 'workspace' } as never;
      }
      if (userId === '33333333-3333-4333-8333-333333333333') {
        return { role: 'member', access_scope: 'workspace' } as never;
      }
      return { id: '44444444-4444-4444-8444-444444444444' } as never;
    });

    const res = await handler(
      makeRequest({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        user_id: '33333333-3333-4333-8333-333333333333',
        access_scope: 'scoped',
        acting_environment_id: '44444444-4444-4444-8444-444444444444',
        environment_ids: [],
        group_ids: [],
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Cannot remove or overwrite users inherited from workspace scope',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe('workspace-users role changes', () => {
  it('blocks workspace role changes for scoped callers', async () => {
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('scoped' as never);

    const res = await handler(
      new Request('http://localhost/api/workspaces/users/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: '11111111-1111-4111-8111-111111111111', user_id: '33333333-3333-4333-8333-333333333333', role: 'admin' }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: insufficient workspace scope',
    });
    expect(mockRequireWorkspacePermission).not.toHaveBeenCalled();
  });

  it('rejects role changes from non-admin members', async () => {
    mockRequireWorkspacePermission.mockImplementationOnce(() => {
      throw new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await handler(
      new Request('http://localhost/api/workspaces/users/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: '11111111-1111-4111-8111-111111111111', user_id: '33333333-3333-4333-8333-333333333333', role: 'admin' }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: insufficient workspace role',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('prevents admins from promoting users to owner', async () => {
    mockRequireWorkspacePermission.mockResolvedValueOnce('admin' as never);

    const res = await handler(
      new Request('http://localhost/api/workspaces/users/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: '11111111-1111-4111-8111-111111111111', user_id: '33333333-3333-4333-8333-333333333333', role: 'owner' }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Only owners can promote to owner',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
