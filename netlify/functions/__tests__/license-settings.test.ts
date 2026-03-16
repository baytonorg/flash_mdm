import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAuth,
  mockRequireWorkspaceResourcePermission,
  mockRequireEnvironmentPermission,
  mockRequireWorkspaceRole,
  mockExecute,
  mockQueryOne,
  mockGetWorkspaceLicensingSettings,
  mockLogAudit,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireWorkspaceResourcePermission: vi.fn(),
  mockRequireEnvironmentPermission: vi.fn(),
  mockRequireWorkspaceRole: vi.fn(),
  mockExecute: vi.fn(),
  mockQueryOne: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: mockRequireWorkspaceResourcePermission,
  requireEnvironmentPermission: mockRequireEnvironmentPermission,
  requireWorkspaceRole: mockRequireWorkspaceRole,
}));

vi.mock('../_lib/db.js', () => ({
  execute: mockExecute,
  queryOne: mockQueryOne,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

import handler from '../license-settings.ts';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockRequireWorkspaceRole.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockExecute.mockReset();
  mockQueryOne.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    authType: 'session',
    user: { id: 'user_1', workspace_id: WORKSPACE_ID },
  });
  mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined);
  mockRequireWorkspaceRole.mockResolvedValue('admin');
  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockQueryOne.mockResolvedValue({
    inherit_platform_free_tier: true,
    free_enabled: true,
    free_seat_limit: 10,
    billing_method: 'stripe',
    customer_owner_enabled: false,
    grace_day_block: 10,
    grace_day_disable: 30,
    grace_day_wipe: 45,
  });
  mockGetWorkspaceLicensingSettings.mockResolvedValue({
    platform_licensing_enabled: true,
    workspace_licensing_enabled: true,
    effective_licensing_enabled: true,
    inherit_platform_free_tier: true,
    free_enabled: true,
    free_seat_limit: 10,
    workspace_free_enabled: true,
    workspace_free_seat_limit: 10,
    platform_default_free_enabled: true,
    platform_default_free_seat_limit: 10,
    billing_method: 'stripe',
    customer_owner_enabled: false,
    grace_day_block: 10,
    grace_day_disable: 30,
    grace_day_wipe: 45,
  });
});

describe('license-settings', () => {
  it('returns workspace licensing settings', async () => {
    const res = await handler(
      new Request(`http://localhost/api/licenses/settings?workspace_id=${WORKSPACE_ID}`),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      workspace_id: WORKSPACE_ID,
      settings: expect.objectContaining({
        inherit_platform_free_tier: true,
        free_seat_limit: 10,
      }),
    });
  });

  it('allows read via active environment scope when workspace-level read is denied', async () => {
    const ENV_ID = '223e4567-e89b-12d3-a456-426614174001';
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      user: { id: 'user_1', workspace_id: null, environment_id: ENV_ID },
    });
    mockRequireWorkspaceResourcePermission.mockRejectedValueOnce(new Response(
      JSON.stringify({ error: 'Forbidden: insufficient workspace role' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    ));
    mockQueryOne.mockResolvedValueOnce({ id: ENV_ID });

    const res = await handler(
      new Request(`http://localhost/api/licenses/settings?workspace_id=${WORKSPACE_ID}`),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      expect.objectContaining({ authType: 'session' }),
      ENV_ID,
      'read'
    );
  });

  it('rejects invalid grace period ordering on update', async () => {
    const res = await handler(
      new Request('http://localhost/api/licenses/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          grace_day_block: 30,
          grace_day_disable: 10,
          grace_day_wipe: 5,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Grace day order must satisfy block < disable < wipe',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('updates workspace free-tier settings and audits change', async () => {
    const res = await handler(
      new Request('http://localhost/api/licenses/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          inherit_platform_free_tier: false,
          free_enabled: true,
          free_seat_limit: 25,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace_licensing.settings.updated',
      workspace_id: WORKSPACE_ID,
    }));
  });
});
