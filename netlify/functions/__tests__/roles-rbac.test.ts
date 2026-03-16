import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', async () => {
  const actual = await vi.importActual<typeof import('../_lib/rbac.js')>('../_lib/rbac.js');
  return {
    ...actual,
    requireWorkspaceRole: vi.fn(),
    requireEnvironmentRole: vi.fn(),
    clearEnvironmentPermissionMatrixCache: vi.fn(),
  };
});

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: vi.fn(),
}));

import { execute, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { clearEnvironmentPermissionMatrixCache, requireEnvironmentRole, requireWorkspaceRole } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import { getWorkspaceLicensingSettings } from '../_lib/licensing.js';
import handler from '../roles-rbac.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceRole = vi.mocked(requireWorkspaceRole);
const mockRequireEnvironmentRole = vi.mocked(requireEnvironmentRole);
const mockLogAudit = vi.mocked(logAudit);
const mockGetWorkspaceLicensingSettings = vi.mocked(getWorkspaceLicensingSettings);

function ownerAuth() {
  return {
    authType: 'session',
    sessionId: 'sess_1',
    user: {
      id: 'user_1',
      email: 'owner@example.com',
      is_superadmin: false,
    },
  } as never;
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireWorkspaceRole.mockReset();
  mockRequireEnvironmentRole.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue(ownerAuth());
  mockRequireWorkspaceRole.mockResolvedValue('owner' as never);
  mockRequireEnvironmentRole.mockResolvedValue('member' as never);
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
  mockExecute.mockResolvedValue({ rowCount: 1 } as never);
});

describe('roles-rbac', () => {
  it('returns default/effective matrix for a workspace', async () => {
    mockQueryOne.mockResolvedValueOnce({
      settings: {
        rbac: {
          permission_matrix: {
            audit: { read: 'viewer', read_privileged: 'admin' },
          },
        },
      },
    } as never);

    const res = await handler(new Request('http://localhost/api/roles/rbac?workspace_id=ws_1'), {} as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspace_id).toBe('ws_1');
    expect(body.defaults.workspace.manage_settings).toBe('owner');
    expect(body.matrix.audit.read).toBe('viewer');
    expect(body.has_override).toBe(true);
    expect(body.view_scope).toBe('workspace');
    expect(body.can_manage).toBe(true);
    expect(body.meta.roles).toEqual(['viewer', 'member', 'admin', 'owner']);
    expect(mockRequireWorkspaceRole).toHaveBeenCalledWith(expect.anything(), 'ws_1', 'owner');
  });

  it('hides billing permissions from RBAC matrix when licensing is disabled', async () => {
    mockGetWorkspaceLicensingSettings.mockResolvedValueOnce({
      platform_licensing_enabled: true,
      workspace_licensing_enabled: false,
      effective_licensing_enabled: false,
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
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never);

    const res = await handler(new Request('http://localhost/api/roles/rbac?workspace_id=ws_1'), {} as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaults.billing).toBeUndefined();
    expect(body.matrix.billing).toBeUndefined();
    expect(body.meta.resource_order).not.toContain('billing');
    expect(body.meta.action_order).not.toContain('billing_view');
  });

  it('returns read-only environment-scoped matrix for non-owner callers with environment access', async () => {
    mockRequireWorkspaceRole.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), { status: 403 })
    );
    // First call: requireEnvironmentRole('owner') check — reject (not env owner)
    mockRequireEnvironmentRole.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient environment role' }), { status: 403 })
    );
    // Second call: requireEnvironmentRole('member') check — pass
    mockRequireEnvironmentRole.mockResolvedValueOnce('member' as never);
    mockQueryOne
      .mockResolvedValueOnce({
        settings: {
          rbac: {
            permission_matrix: {
              workspace: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'admin', manage_settings: 'owner' },
              environment: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'admin', manage_settings: 'admin' },
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({ id: 'env_1', enterprise_features: {} } as never);

    const res = await handler(
      new Request('http://localhost/api/roles/rbac?workspace_id=ws_1&environment_id=env_1'),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.view_scope).toBe('environment');
    expect(body.can_manage).toBe(false);
    expect(body.environment_id).toBe('env_1');
    expect(body.matrix.workspace).toBeUndefined();
    expect(body.defaults.workspace).toBeUndefined();
    expect(body.meta.resource_order).not.toContain('workspace');
    expect(body.environment_has_override).toBe(false);
  });

  it('requires environment_id for non-owner read-only RBAC view', async () => {
    mockRequireWorkspaceRole.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), { status: 403 })
    );
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never);

    const res = await handler(new Request('http://localhost/api/roles/rbac?workspace_id=ws_1'), {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'environment_id is required for environment-scoped RBAC view',
    });
    expect(mockRequireEnvironmentRole).not.toHaveBeenCalled();
  });

  it('updates workspace rbac matrix and writes to workspace settings', async () => {
    mockQueryOne.mockResolvedValueOnce({
      settings: { some_existing_setting: true },
    } as never);

    const matrix = {
      workspace: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'admin', manage_settings: 'owner' },
      environment: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'admin', manage_settings: 'admin' },
      group: { read: 'viewer', write: 'member', delete: 'admin', manage_users: 'admin' },
      device: { read: 'viewer', write: 'member', delete: 'member', command: 'member', command_destructive: 'admin', bulk_destructive: 'admin' },
      policy: { read: 'viewer', write: 'member', delete: 'admin' },
      certificate: { read: 'viewer', write: 'member', delete: 'admin' },
      geofence: { read: 'viewer', write: 'member', delete: 'admin' },
      audit: { read: 'viewer', read_privileged: 'admin' },
      invite: { read: 'admin', write: 'admin', delete: 'admin' },
      billing: { license_view: 'viewer', billing_view: 'admin', billing_manage: 'admin', billing_customer: 'owner' },
      flashagent: { read: 'viewer', write: 'admin', manage_settings: 'admin' },
    };

    const res = await handler(
      new Request('http://localhost/api/roles/rbac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: 'ws_1',
          matrix: {
            ...matrix,
            audit: { read: 'viewer', read_privileged: 'owner' },
          },
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matrix.audit.read).toBe('viewer');
    expect(body.matrix.audit.read_privileged).toBe('owner');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workspaces SET settings'),
      [expect.any(String), 'ws_1']
    );
    const savedSettingsJson = mockExecute.mock.calls[0]?.[1]?.[0];
    expect(typeof savedSettingsJson).toBe('string');
    const savedSettings = JSON.parse(savedSettingsJson as string);
    expect(savedSettings.some_existing_setting).toBe(true);
    expect(savedSettings.rbac.permission_matrix.audit.read).toBe('viewer');
    expect(savedSettings.rbac.permission_matrix.audit.read_privileged).toBe('owner');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rbac.permission_matrix.updated',
      workspace_id: 'ws_1',
    }));
  });

  it('rejects invalid matrix payloads', async () => {
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never);

    const res = await handler(
      new Request('http://localhost/api/roles/rbac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: 'ws_1',
          matrix: {
            workspace: { read: 'viewer' },
          },
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: expect.stringContaining('Missing action(s) for workspace'),
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects matrix updates below destructive/sensitive minimum floors', async () => {
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never);

    const matrix = {
      workspace: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'member', manage_settings: 'owner' },
      environment: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'admin', manage_settings: 'admin' },
      group: { read: 'viewer', write: 'member', delete: 'admin', manage_users: 'admin' },
      device: { read: 'viewer', write: 'member', delete: 'member', command: 'member', command_destructive: 'admin', bulk_destructive: 'admin' },
      policy: { read: 'viewer', write: 'member', delete: 'admin' },
      certificate: { read: 'viewer', write: 'member', delete: 'admin' },
      geofence: { read: 'viewer', write: 'member', delete: 'admin' },
      audit: { read: 'viewer', read_privileged: 'admin' },
      invite: { read: 'admin', write: 'admin', delete: 'admin' },
      billing: { license_view: 'viewer', billing_view: 'admin', billing_manage: 'admin', billing_customer: 'owner' },
      flashagent: { read: 'viewer', write: 'admin', manage_settings: 'admin' },
    };

    const res = await handler(
      new Request('http://localhost/api/roles/rbac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: 'ws_1',
          matrix,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'matrix.workspace.manage_users cannot be lower than admin',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('clears a saved workspace override', async () => {
    mockQueryOne.mockResolvedValueOnce({
      settings: {
        some_existing_setting: true,
        rbac: {
          permission_matrix: {
            audit: { read: 'viewer', read_privileged: 'admin' },
          },
          updated_at: '2026-02-25T00:00:00.000Z',
          updated_by_user_id: 'user_1',
        },
      },
    } as never);

    const res = await handler(
      new Request('http://localhost/api/roles/rbac?workspace_id=ws_1', { method: 'DELETE' }),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.has_override).toBe(false);
    expect(body.matrix).toEqual(body.defaults);

    const savedSettingsJson = mockExecute.mock.calls[0]?.[1]?.[0];
    const savedSettings = JSON.parse(savedSettingsJson as string);
    expect(savedSettings.some_existing_setting).toBe(true);
    expect(savedSettings.rbac).toBeUndefined();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rbac.permission_matrix.cleared',
      workspace_id: 'ws_1',
    }));
  });

  it('masks unexpected internal errors with a generic 500 response', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('column permission_matrix does not exist'));

    const res = await handler(new Request('http://localhost/api/roles/rbac?workspace_id=ws_1'), {} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Internal server error',
    });
  });

  // --- Environment-level RBAC override tests ---

  it('returns editable environment matrix for environment owners', async () => {
    mockRequireWorkspaceRole.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), { status: 403 })
    );
    // First requireEnvironmentRole('owner') check — pass (env owner)
    mockRequireEnvironmentRole.mockResolvedValueOnce('owner' as never);
    mockQueryOne
      .mockResolvedValueOnce({ settings: {} } as never) // workspace settings
      .mockResolvedValueOnce({
        id: 'env_1',
        enterprise_features: {
          rbac: {
            permission_matrix: {
              device: { read: 'viewer', write: 'admin', delete: 'admin', command: 'admin', command_destructive: 'admin', bulk_destructive: 'admin' },
            },
          },
        },
      } as never); // environment with override

    const res = await handler(
      new Request('http://localhost/api/roles/rbac?workspace_id=ws_1&environment_id=env_1'),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.view_scope).toBe('environment');
    expect(body.can_manage).toBe(true);
    expect(body.environment_has_override).toBe(true);
    // Environment override should be reflected in the matrix
    expect(body.matrix.device.write).toBe('admin');
    // workspace resource should be filtered out
    expect(body.matrix.workspace).toBeUndefined();
  });

  it('saves environment-level RBAC override via PUT with environment_id', async () => {
    mockRequireEnvironmentRole.mockResolvedValueOnce('owner' as never);
    mockQueryOne.mockResolvedValueOnce({
      id: 'env_1',
      enterprise_features: { some_existing: true },
      workspace_id: 'ws_1',
    } as never);

    const matrix = {
      workspace: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'admin', manage_settings: 'owner' },
      environment: { read: 'viewer', write: 'admin', delete: 'owner', manage_users: 'admin', manage_settings: 'admin' },
      group: { read: 'viewer', write: 'member', delete: 'admin', manage_users: 'admin' },
      device: { read: 'viewer', write: 'admin', delete: 'admin', command: 'admin', command_destructive: 'admin', bulk_destructive: 'admin' },
      policy: { read: 'viewer', write: 'member', delete: 'admin' },
      certificate: { read: 'viewer', write: 'member', delete: 'admin' },
      geofence: { read: 'viewer', write: 'member', delete: 'admin' },
      audit: { read: 'viewer', read_privileged: 'admin' },
      invite: { read: 'admin', write: 'admin', delete: 'admin' },
      billing: { license_view: 'viewer', billing_view: 'admin', billing_manage: 'admin', billing_customer: 'owner' },
      flashagent: { read: 'viewer', write: 'admin', manage_settings: 'admin' },
    };

    const res = await handler(
      new Request('http://localhost/api/roles/rbac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: 'ws_1',
          environment_id: 'env_1',
          matrix,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.environment_has_override).toBe(true);
    expect(body.environment_id).toBe('env_1');
    expect(body.matrix.device.write).toBe('admin');

    // Verify DB update targets environments table
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE environments SET enterprise_features'),
      [expect.any(String), 'env_1']
    );

    // Verify existing enterprise_features preserved
    const savedJson = mockExecute.mock.calls[0]?.[1]?.[0];
    const savedFeatures = JSON.parse(savedJson as string);
    expect(savedFeatures.some_existing).toBe(true);
    expect(savedFeatures.rbac.permission_matrix.device.write).toBe('admin');

    // Verify audit log
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rbac.environment_permission_matrix.updated',
      environment_id: 'env_1',
      workspace_id: 'ws_1',
    }));
  });

  it('clears environment-level RBAC override via DELETE with environment_id', async () => {
    mockRequireEnvironmentRole.mockResolvedValueOnce('owner' as never);
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        enterprise_features: {
          some_existing: true,
          rbac: {
            permission_matrix: { device: { write: 'admin' } },
            updated_at: '2026-03-04T00:00:00.000Z',
            updated_by_user_id: 'user_1',
          },
        },
      } as never) // environment with override
      .mockResolvedValueOnce({ settings: {} } as never); // workspace settings for inheritance

    const res = await handler(
      new Request('http://localhost/api/roles/rbac?workspace_id=ws_1&environment_id=env_1', { method: 'DELETE' }),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.environment_has_override).toBe(false);
    expect(body.environment_id).toBe('env_1');
    // Matrix should be workspace inherited (defaults since no ws override)
    expect(body.matrix.workspace).toBeUndefined(); // filtered for env scope

    // Verify DB update clears rbac from enterprise_features
    const savedJson = mockExecute.mock.calls[0]?.[1]?.[0];
    const savedFeatures = JSON.parse(savedJson as string);
    expect(savedFeatures.some_existing).toBe(true);
    expect(savedFeatures.rbac).toBeUndefined();

    // Verify audit log
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rbac.environment_permission_matrix.cleared',
      environment_id: 'env_1',
    }));
  });

  it('rejects environment PUT when user is not environment owner', async () => {
    mockRequireEnvironmentRole.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient environment role' }), { status: 403 })
    );
    mockQueryOne.mockResolvedValueOnce({
      id: 'env_1',
      enterprise_features: {},
      workspace_id: 'ws_1',
    } as never);

    const res = await handler(
      new Request('http://localhost/api/roles/rbac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: 'ws_1',
          environment_id: 'env_1',
          matrix: {},
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
