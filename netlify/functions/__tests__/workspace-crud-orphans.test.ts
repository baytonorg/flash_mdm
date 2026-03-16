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
  requireWorkspacePermission: vi.fn(),
  requireWorkspaceResourcePermission: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  encrypt: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireWorkspacePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import handler from '../workspace-crud.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspacePermission = vi.mocked(requireWorkspacePermission);
const mockAmapiCall = vi.mocked(amapiCall);

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockRequireAuth.mockReset();
  mockRequireWorkspacePermission.mockReset();
  mockAmapiCall.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1', is_superadmin: false },
  } as never);
  mockRequireWorkspacePermission.mockResolvedValue('admin' as never);
});

describe('workspace-crud orphaned enterprise discovery', () => {
  it('lists enterprises in AMAPI project that are not attached to local environments', async () => {
    mockQueryOne.mockResolvedValueOnce({ gcp_project_id: 'proj-123' } as never);
    mockQuery.mockResolvedValueOnce([
      { enterprise_name: 'enterprises/already-linked' },
    ] as never);

    mockAmapiCall
      .mockResolvedValueOnce({
        enterprises: [
          { name: 'enterprises/already-linked', enterpriseDisplayName: 'Linked Enterprise' },
          { name: 'enterprises/orphan-1', enterpriseDisplayName: 'Recovered Candidate' },
        ],
      } as never)
      .mockResolvedValueOnce({
        name: 'enterprises/orphan-1',
        enterpriseDisplayName: 'Recovered Candidate',
        pubsubTopic: 'projects/proj-123/topics/amapi-events',
        enabledNotificationTypes: ['ENROLLMENT', 'STATUS_REPORT'],
      } as never)
      .mockResolvedValueOnce({
        devices: [{ name: 'd1' }, { name: 'd2' }],
      } as never);

    const res = await handler(
      new Request('http://localhost/api/workspaces/orphaned-enterprises?workspace_id=ws_1'),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      enterprises: [
        expect.objectContaining({
          enterprise_name: 'enterprises/orphan-1',
          enterprise_display_name: 'Recovered Candidate',
          pubsub_topic: 'projects/proj-123/topics/amapi-events',
          enabled_notification_types: ['ENROLLMENT', 'STATUS_REPORT'],
          enrolled_device_count: 2,
          enrolled_device_count_exact: true,
        }),
      ],
    });

    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith(expect.anything(), 'ws_1', 'write');
    expect(mockAmapiCall.mock.calls[0]?.[0]).toContain('enterprises?projectId=');
    expect(mockAmapiCall.mock.calls[1]?.[0]).toBe('enterprises/orphan-1');
    expect(mockAmapiCall.mock.calls[2]?.[0]).toContain('enterprises/orphan-1/devices?pageSize=100');
  });
});

describe('workspace-crud API key scope handling', () => {
  it('rejects environment-scoped API keys on workspace list', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: { id: 'user_1', is_superadmin: true },
      apiKey: {
        id: 'ak_1',
        scope_type: 'environment',
        scope_id: 'env_1',
        workspace_id: 'ws_1',
        environment_id: 'env_1',
        role: 'owner',
      },
    } as never);

    const res = await handler(new Request('http://localhost/api/workspaces/list'), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: environment-scoped API keys cannot list workspaces',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('treats GET /api/workspaces as list and rejects environment-scoped API keys', async () => {
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
        role: 'owner',
      },
    } as never);

    const res = await handler(new Request('http://localhost/api/workspaces'), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: environment-scoped API keys cannot list workspaces',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('treats direct function root path as list and rejects environment-scoped API keys', async () => {
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
        role: 'owner',
      },
    } as never);

    const res = await handler(new Request('http://localhost/.netlify/functions/workspace-crud'), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: environment-scoped API keys cannot list workspaces',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns only the keyed workspace for workspace-scoped API keys', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: { id: 'user_1', is_superadmin: false },
      apiKey: {
        id: 'ak_1',
        scope_type: 'workspace',
        scope_id: 'ws_1',
        workspace_id: 'ws_1',
        environment_id: null,
        role: 'admin',
      },
    } as never);
    mockQuery.mockResolvedValueOnce([
      { id: 'ws_1', name: 'Workspace 1', user_role: 'admin', access_scope: 'workspace' },
    ] as never);

    const res = await handler(new Request('http://localhost/api/workspaces/list'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workspaces: [{ id: 'ws_1', name: 'Workspace 1', user_role: 'admin', access_scope: 'workspace' }],
    });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE w.id = $1'), ['ws_1', 'admin']);
  });

  it('masks unexpected internal errors with a generic 500 message', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('relation "workspaces" does not exist'));

    const res = await handler(new Request('http://localhost/api/workspaces/list'), {} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Internal server error',
    });
  });
});
