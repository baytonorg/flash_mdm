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
  getAmapiErrorHttpStatus: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireWorkspaceResourcePermission } from '../_lib/rbac.js';
import handler from '../environment-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);

function makeCreateRequest() {
  return new Request('http://localhost/api/environments/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: 'ws_1', name: 'Customer Env' }),
  });
}

describe('environment-crud customer setup flow', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockRequireAuth.mockReset();
    mockRequireWorkspaceResourcePermission.mockReset();

    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: 'user_1',
        email: 'user@example.com',
        is_superadmin: false,
      },
    } as never);
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
  });

  it('allows first environment creation when user is setup-flagged and scoped', async () => {
    mockRequireWorkspaceResourcePermission.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), { status: 403 })
    );
    mockQueryOne.mockResolvedValueOnce({
      access_scope: 'scoped',
      needs_environment_setup: true,
      environment_count: '0',
    } as never);

    const res = await handler(makeCreateRequest(), {} as never);

    expect(res.status).toBe(201);
    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO environment_memberships (environment_id, user_id, role) VALUES ($1, $2, $3)',
      expect.arrayContaining([expect.any(String), 'user_1', 'owner'])
    );
    expect(mockExecute).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workspace_memberships'),
      expect.any(Array)
    );
  });

  it('assigns owner for setup users even when workspace write permission already allows create', async () => {
    mockRequireWorkspaceResourcePermission.mockResolvedValueOnce('viewer' as never);
    mockQueryOne.mockResolvedValueOnce({
      access_scope: 'scoped',
      needs_environment_setup: true,
      environment_count: '0',
    } as never);

    const res = await handler(makeCreateRequest(), {} as never);

    expect(res.status).toBe(201);
    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO environment_memberships (environment_id, user_id, role) VALUES ($1, $2, $3)',
      expect.arrayContaining([expect.any(String), 'user_1', 'owner'])
    );
    expect(mockExecute).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workspace_memberships'),
      expect.any(Array)
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO group_memberships'),
      expect.arrayContaining([expect.any(String), 'user_1', 'owner'])
    );
  });

  it('keeps blocking creation when setup gate conditions are not met', async () => {
    mockRequireWorkspaceResourcePermission.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), { status: 403 })
    );
    mockQueryOne.mockResolvedValueOnce({
      access_scope: 'scoped',
      needs_environment_setup: false,
      environment_count: '0',
    } as never);

    const res = await handler(makeCreateRequest(), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: insufficient workspace role',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
