import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: vi.fn(),
  requireEnvironmentPermission: vi.fn(),
  getWorkspaceAccessScopeForAuth: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { getWorkspaceAccessScopeForAuth, requireWorkspaceResourcePermission } from '../_lib/rbac.js';
import handler from '../environment-crud.ts';

const mockQuery = vi.mocked(query);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockGetWorkspaceAccessScopeForAuth = vi.mocked(getWorkspaceAccessScopeForAuth);

beforeEach(() => {
  mockQuery.mockReset();
  mockRequireAuth.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockGetWorkspaceAccessScopeForAuth.mockReset();

  mockRequireWorkspaceResourcePermission.mockResolvedValue('viewer' as never);
  mockGetWorkspaceAccessScopeForAuth.mockResolvedValue('workspace' as never);
});

describe('environment-crud API key scope listing', () => {
  it('returns only the keyed environment for environment-scoped API keys', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: { id: 'user_1', is_superadmin: false },
      apiKey: {
        id: 'ak_1',
        scope_type: 'environment',
        scope_id: 'env_1',
        workspace_id: 'ws_1',
        environment_id: 'env_1',
        role: 'viewer',
      },
    } as never);
    mockQuery.mockResolvedValueOnce([{ id: 'env_1', workspace_id: 'ws_1', name: 'Env 1' }] as never);

    const res = await handler(
      new Request('http://localhost/api/environments/list?workspace_id=ws_1'),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      environments: [{ id: 'env_1', workspace_id: 'ws_1', name: 'Env 1' }],
    });
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('AND e.id = $2'), ['ws_1', 'env_1', 'viewer']);
  });

  it('uses workspace listing query (not membership query) for workspace-scoped API keys', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: { id: 'user_1', is_superadmin: false },
      apiKey: {
        id: 'ak_ws',
        scope_type: 'workspace',
        scope_id: 'ws_1',
        workspace_id: 'ws_1',
        environment_id: null,
        role: 'admin',
      },
    } as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('workspace' as never);
    mockQuery.mockResolvedValueOnce([{ id: 'env_1', workspace_id: 'ws_1', name: 'Env 1' }] as never);

    const res = await handler(
      new Request('http://localhost/api/environments/list?workspace_id=ws_1'),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenCalledWith(expect.anything(), 'ws_1', 'environment', 'read');
    expect(mockQuery.mock.calls[0]?.[0]).not.toContain('em.user_id = $2');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(['ws_1']);
  });

  it('returns a clean 403 response when access scope does not match workspace', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: { id: 'user_1', is_superadmin: false },
      apiKey: {
        id: 'ak_env',
        scope_type: 'environment',
        scope_id: 'env_1',
        workspace_id: 'ws_1',
        environment_id: 'env_1',
        role: 'owner',
      },
    } as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce(null as never);

    const res = await handler(
      new Request('http://localhost/api/environments/list?workspace_id=other_ws'),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: no access to workspace',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns a clean 403 response when workspace-scoped key fails environment read gate', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: { id: 'user_1', is_superadmin: false },
      apiKey: {
        id: 'ak_ws',
        scope_type: 'workspace',
        scope_id: 'ws_1',
        workspace_id: 'ws_1',
        environment_id: null,
        role: 'viewer',
      },
    } as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('workspace' as never);
    mockRequireWorkspaceResourcePermission.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient environment permission' }), { status: 403 })
    );

    const res = await handler(
      new Request('http://localhost/api/environments/list?workspace_id=ws_1'),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: insufficient environment permission',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('uses membership listing query for scoped session users', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      sessionId: 'sess_1',
      user: { id: 'user_scoped', is_superadmin: false },
    } as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValueOnce('scoped' as never);
    mockQuery.mockResolvedValueOnce([{ id: 'env_1', workspace_id: 'ws_1', name: 'Env 1', user_role: 'member' }] as never);

    const res = await handler(
      new Request('http://localhost/api/environments/list?workspace_id=ws_1'),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[0]?.[0]).toContain('em.user_id = $2');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(['ws_1', 'user_scoped']);
  });

  it('masks unexpected internal errors with a generic 500 response', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('relation "environments" does not exist'));

    const res = await handler(
      new Request('http://localhost/api/environments/list?workspace_id=ws_1'),
      {} as never
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Internal server error',
    });
  });
});
