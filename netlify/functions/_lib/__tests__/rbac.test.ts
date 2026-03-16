import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthContext } from '../auth.js';

// Mock the database module
vi.mock('../db.js', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}));

import { queryOne, query } from '../db.js';
import {
  clearWorkspacePermissionMatrixCacheForTests,
  clearEnvironmentPermissionMatrixCache,
  checkPermission,
  getEffectivePermissionMatrixForWorkspace,
  getEffectivePermissionMatrixForEnvironment,
  getWorkspaceRole,
  getEnvironmentRole,
  getGroupRole,
  requireEnvironmentPermission,
  requireEnvironmentResourcePermission,
  requireEnvironmentAccessScopeForResourcePermission,
  requireWorkspaceRole,
  requireWorkspacePermission,
  requireEnvironmentRole,
  requireGroupPermission,
  getWorkspaceRoleForAuth,
  getEnvironmentRoleForAuth,
  getGroupRoleForAuth,
} from '../rbac.js';

const mockQueryOne = vi.mocked(queryOne);
const mockQuery = vi.mocked(query);

beforeEach(() => {
  clearWorkspacePermissionMatrixCacheForTests();
  clearEnvironmentPermissionMatrixCache();
  mockQuery.mockReset();
});

function makeAuth(overrides: Partial<AuthContext['user']> = {}): AuthContext {
  return {
    sessionId: 'sess_test_123',
    authType: 'session',
    user: {
      id: 'user_1',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User',
      is_superadmin: false,
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      active_group_id: null,
      ...overrides,
    },
  };
}

function makeSuperadmin(): AuthContext {
  return makeAuth({ is_superadmin: true });
}

function makeApiKeyAuth(input: {
  scope_type: 'workspace' | 'environment';
  workspace_id: string;
  environment_id?: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}): AuthContext {
  return {
    sessionId: null,
    authType: 'api_key',
    user: {
      id: 'user_1',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User',
      is_superadmin: false,
      totp_enabled: false,
      workspace_id: input.workspace_id,
      environment_id: input.environment_id ?? null,
      active_group_id: null,
    },
    apiKey: {
      id: 'ak_1',
      name: 'Local client',
      scope_type: input.scope_type,
      scope_id: input.scope_type === 'workspace' ? input.workspace_id : (input.environment_id ?? ''),
      workspace_id: input.workspace_id,
      environment_id: input.environment_id ?? null,
      role: input.role,
      created_by_user_id: 'user_1',
    },
  };
}

describe('checkPermission', () => {
  describe('role hierarchy', () => {
    it('owner has higher privilege than admin', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'workspace', 'manage_settings', 'owner')).toBe(true);
      expect(checkPermission(auth, 'workspace', 'manage_settings', 'admin')).toBe(false);
    });

    it('admin has higher privilege than member', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'group', 'delete', 'admin')).toBe(true);
      expect(checkPermission(auth, 'group', 'delete', 'member')).toBe(false);
    });

    it('member has higher privilege than viewer', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'device', 'write', 'member')).toBe(true);
      expect(checkPermission(auth, 'device', 'write', 'viewer')).toBe(false);
    });
  });

  describe('sufficient role', () => {
    it('returns true when user role meets the minimum required role', () => {
      const auth = makeAuth();
      // Viewer can read workspaces
      expect(checkPermission(auth, 'workspace', 'read', 'viewer')).toBe(true);
      // Member can also read workspaces (higher than viewer)
      expect(checkPermission(auth, 'workspace', 'read', 'member')).toBe(true);
      // Admin can read and write workspaces
      expect(checkPermission(auth, 'workspace', 'write', 'admin')).toBe(true);
      // Owner can do everything
      expect(checkPermission(auth, 'workspace', 'delete', 'owner')).toBe(true);
    });
  });

  describe('insufficient role', () => {
    it('returns false when user role is below the minimum required role', () => {
      const auth = makeAuth();
      // Viewer cannot write to workspaces (requires admin)
      expect(checkPermission(auth, 'workspace', 'write', 'viewer')).toBe(false);
      // Member cannot delete workspaces (requires owner)
      expect(checkPermission(auth, 'workspace', 'delete', 'member')).toBe(false);
      // Viewer cannot write to devices (requires member)
      expect(checkPermission(auth, 'device', 'write', 'viewer')).toBe(false);
    });
  });

  describe('superadmin bypass', () => {
    it('returns true for any resource and action when user is superadmin', () => {
      const auth = makeSuperadmin();
      expect(checkPermission(auth, 'workspace', 'delete')).toBe(true);
      expect(checkPermission(auth, 'environment', 'manage_settings')).toBe(true);
      expect(checkPermission(auth, 'audit', 'read')).toBe(true);
      expect(checkPermission(auth, 'nonexistent', 'anything')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns false for unknown resource type', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'unknown_resource', 'read', 'owner')).toBe(false);
    });

    it('returns false for unknown action', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'workspace', 'unknown_action', 'owner')).toBe(false);
    });

    it('returns false when no userRole is provided and not superadmin', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'workspace', 'read')).toBe(false);
    });

    it('returns false for unknown role string', () => {
      const auth = makeAuth();
      // Unknown role gets level 0, which is below viewer (25)
      expect(checkPermission(auth, 'workspace', 'read', 'unknown_role')).toBe(false);
    });
  });

  describe('permission matrix coverage', () => {
    it('audit read requires viewer', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'audit', 'read', 'viewer')).toBe(true);
      expect(checkPermission(auth, 'audit', 'read', 'unknown_role')).toBe(false);
    });

    it('group write requires member', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'group', 'write', 'member')).toBe(true);
      expect(checkPermission(auth, 'group', 'write', 'viewer')).toBe(false);
    });

    it('policy write requires member', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'policy', 'write', 'member')).toBe(true);
      expect(checkPermission(auth, 'policy', 'write', 'viewer')).toBe(false);
    });

    it('invite management requires admin', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'invite', 'read', 'admin')).toBe(true);
      expect(checkPermission(auth, 'invite', 'write', 'admin')).toBe(true);
      expect(checkPermission(auth, 'invite', 'delete', 'admin')).toBe(true);
      expect(checkPermission(auth, 'invite', 'read', 'member')).toBe(false);
    });

    it('certificate management requires member for write and admin for delete', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'certificate', 'read', 'viewer')).toBe(true);
      expect(checkPermission(auth, 'certificate', 'write', 'member')).toBe(true);
      expect(checkPermission(auth, 'certificate', 'write', 'viewer')).toBe(false);
      expect(checkPermission(auth, 'certificate', 'delete', 'admin')).toBe(true);
      expect(checkPermission(auth, 'certificate', 'delete', 'member')).toBe(false);
    });

    it('bulk destructive device operations require admin', () => {
      const auth = makeAuth();
      expect(checkPermission(auth, 'device', 'bulk_destructive', 'admin')).toBe(true);
      expect(checkPermission(auth, 'device', 'bulk_destructive', 'member')).toBe(false);
    });
  });
});

describe('getEffectivePermissionMatrixForWorkspace', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('merges saved workspace overrides with defaults', async () => {
    mockQueryOne.mockResolvedValueOnce({
      settings: {
        rbac: {
          permission_matrix: {
            group: { write: 'viewer' },
          },
        },
      },
    } as never);

    const matrix = await getEffectivePermissionMatrixForWorkspace('ws_1');
    expect(matrix.group.write).toBe('viewer');
    expect(matrix.group.delete).toBe('admin');
    expect(matrix.workspace.read).toBe('viewer');
  });

  it('caches workspace matrix lookups per workspace', async () => {
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never);

    await getEffectivePermissionMatrixForWorkspace('ws_1');
    await getEffectivePermissionMatrixForWorkspace('ws_1');

    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne).toHaveBeenCalledWith('SELECT settings FROM workspaces WHERE id = $1', ['ws_1']);
  });

  it('enforces minimum floors for high-risk persisted overrides', async () => {
    mockQueryOne.mockResolvedValueOnce({
      settings: {
        rbac: {
          permission_matrix: {
            workspace: { manage_users: 'member', manage_settings: 'viewer' },
            environment: { delete: 'admin', manage_settings: 'member' },
            group: { delete: 'member' },
            policy: { delete: 'member' },
            certificate: { delete: 'member' },
            device: { bulk_destructive: 'member' as never, command_destructive: 'member' as never },
            audit: { read: 'unknown_role' as never, read_privileged: 'viewer' },
            invite: { write: 'member' },
          },
        },
      },
    } as never);

    const matrix = await getEffectivePermissionMatrixForWorkspace('ws_1');
    expect(matrix.workspace.manage_users).toBe('admin');
    expect(matrix.workspace.manage_settings).toBe('owner');
    expect(matrix.environment.delete).toBe('owner');
    expect(matrix.environment.manage_settings).toBe('admin');
    expect(matrix.group.delete).toBe('admin');
    expect(matrix.policy.delete).toBe('admin');
    expect(matrix.certificate.delete).toBe('admin');
    expect(matrix.device.command_destructive).toBe('admin');
    expect(matrix.device.bulk_destructive).toBe('admin');
    expect(matrix.audit.read).toBe('viewer');
    expect(matrix.audit.read_privileged).toBe('admin');
    expect(matrix.invite.write).toBe('admin');
  });
});

describe('getEffectivePermissionMatrixForEnvironment', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('returns environment override when present in enterprise_features', async () => {
    // First call: environment enterprise_features
    mockQueryOne.mockResolvedValueOnce({
      enterprise_features: {
        rbac: {
          permission_matrix: {
            device: { write: 'admin' },
          },
        },
      },
    } as never);

    const matrix = await getEffectivePermissionMatrixForEnvironment('env_1', 'ws_1');
    // device.write overridden to admin (default is member)
    expect(matrix.device.write).toBe('admin');
    // Other defaults preserved
    expect(matrix.device.read).toBe('viewer');
    expect(matrix.workspace.read).toBe('viewer');
  });

  it('falls back to workspace matrix when no environment override', async () => {
    // First call: environment with no rbac in enterprise_features
    mockQueryOne.mockResolvedValueOnce({
      enterprise_features: {},
    } as never);
    // Second call: workspace settings (for workspace matrix fallback)
    mockQueryOne.mockResolvedValueOnce({
      settings: {
        rbac: {
          permission_matrix: {
            group: { write: 'admin' },
          },
        },
      },
    } as never);

    const matrix = await getEffectivePermissionMatrixForEnvironment('env_1', 'ws_1');
    // Should inherit workspace override
    expect(matrix.group.write).toBe('admin');
  });

  it('falls back to defaults when no env override and no workspace override', async () => {
    mockQueryOne.mockResolvedValueOnce({ enterprise_features: {} } as never);
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never);

    const matrix = await getEffectivePermissionMatrixForEnvironment('env_1', 'ws_1');
    expect(matrix.device.write).toBe('member');
    expect(matrix.group.delete).toBe('admin');
  });

  it('caches environment matrix lookups', async () => {
    mockQueryOne.mockResolvedValueOnce({ enterprise_features: {} } as never);
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never);

    await getEffectivePermissionMatrixForEnvironment('env_1', 'ws_1');
    await getEffectivePermissionMatrixForEnvironment('env_1', 'ws_1');

    // Only 2 DB calls (env + workspace), not 4
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });

  it('enforces minimum floors on environment overrides', async () => {
    mockQueryOne.mockResolvedValueOnce({
      enterprise_features: {
        rbac: {
          permission_matrix: {
            workspace: { manage_settings: 'viewer' },
            device: { command_destructive: 'viewer' },
          },
        },
      },
    } as never);

    const matrix = await getEffectivePermissionMatrixForEnvironment('env_1', 'ws_1');
    // Floor: manage_settings >= owner
    expect(matrix.workspace.manage_settings).toBe('owner');
    // Floor: command_destructive >= admin
    expect(matrix.device.command_destructive).toBe('admin');
  });
});

describe('requireEnvironmentResourcePermission with environment overrides', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('uses environment override threshold instead of workspace matrix', async () => {
    const auth = makeAuth();
    // getWorkspaceIdForEnvironment
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);
    // getEffectivePermissionMatrixForEnvironment: env enterprise_features
    mockQueryOne.mockResolvedValueOnce({
      enterprise_features: {
        rbac: {
          permission_matrix: {
            device: { write: 'admin' },
          },
        },
      },
    } as never);
    // requireEnvironmentRole: direct env membership
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' } as never);

    // Default device.write = member, but env override = admin
    // Admin user should still pass
    await expect(
      requireEnvironmentResourcePermission(auth, 'env_1', 'device', 'write')
    ).resolves.toBe('admin');
  });

  it('rejects member when environment override raises threshold to admin', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);
    mockQueryOne.mockResolvedValueOnce({
      enterprise_features: {
        rbac: {
          permission_matrix: {
            device: { write: 'admin' },
          },
        },
      },
    } as never);
    // requireEnvironmentRole: user has member role
    mockQueryOne.mockResolvedValueOnce({ role: 'member' } as never);

    // member < admin, should be rejected
    await expect(
      requireEnvironmentResourcePermission(auth, 'env_1', 'device', 'write')
    ).rejects.toBeInstanceOf(Response);
  });
});

describe('requireEnvironmentAccessScopeForResourcePermission', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('uses the effective matrix threshold and returns environment scope for matching API key role', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'environment',
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      role: 'member',
    });

    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_1' } as never); // getWorkspaceIdForEnvironment
    mockQueryOne.mockResolvedValueOnce({ enterprise_features: {} } as never); // environment features (no override)
    mockQueryOne.mockResolvedValueOnce({ settings: {} } as never); // workspace settings for matrix fallback

    const scope = await requireEnvironmentAccessScopeForResourcePermission(auth, 'env_1', 'device', 'write');
    expect(scope.mode).toBe('environment');
    expect(scope.role).toBe('member');
    expect(scope.accessible_group_ids).toBeNull();
  });

  it('throws 404 when environment does not exist', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce(null);

    await expect(
      requireEnvironmentAccessScopeForResourcePermission(auth, 'missing_env', 'policy', 'read')
    ).rejects.toBeInstanceOf(Response);
  });
});

describe('getWorkspaceRole', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('returns the role when user is a member of the workspace', async () => {
    mockQueryOne.mockResolvedValue({ role: 'admin', access_scope: 'workspace' });
    const role = await getWorkspaceRole('user_1', 'ws_1');
    expect(role).toBe('admin');
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      ['ws_1', 'user_1']
    );
  });

  it('returns null when user is not a member', async () => {
    mockQueryOne.mockResolvedValue(null);
    const role = await getWorkspaceRole('user_1', 'ws_999');
    expect(role).toBeNull();
  });

  it('returns null when query returns undefined', async () => {
    mockQueryOne.mockResolvedValue(undefined);
    const role = await getWorkspaceRole('user_1', 'ws_999');
    expect(role).toBeNull();
  });
});

describe('getEnvironmentRole', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('returns direct environment membership role when present', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'member' });
    const role = await getEnvironmentRole('user_1', 'env_1');
    expect(role).toBe('member');
  });

  it('falls back to workspace role when no direct env membership', async () => {
    // First call: no environment membership
    mockQueryOne.mockResolvedValueOnce(null);
    // Second call: get workspace_id from environment
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_1' });
    // Third call: get workspace membership for access scope check
    mockQueryOne.mockResolvedValueOnce({ role: 'admin', access_scope: 'workspace' });
    // Fourth call: get workspace membership for role resolution
    mockQueryOne.mockResolvedValueOnce({ role: 'admin', access_scope: 'workspace' });

    const role = await getEnvironmentRole('user_1', 'env_1');
    expect(role).toBe('admin');
  });

  it('does not inherit workspace role when workspace access is scoped', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no env membership
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_1' }); // environment exists
    mockQueryOne.mockResolvedValueOnce({ role: 'admin', access_scope: 'scoped' }); // workspace membership

    const role = await getEnvironmentRole('user_1', 'env_1');
    expect(role).toBeNull();
  });

  it('returns null when environment does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no env membership
    mockQueryOne.mockResolvedValueOnce(null); // no environment found

    const role = await getEnvironmentRole('user_1', 'env_999');
    expect(role).toBeNull();
  });

  it('returns null when user has no workspace membership and no env membership', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no env membership
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_1' }); // environment exists
    mockQueryOne.mockResolvedValueOnce(null); // no workspace membership

    const role = await getEnvironmentRole('user_1', 'env_1');
    expect(role).toBeNull();
  });
});

describe('getGroupRole', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('returns group membership role via closure table when present', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'member' });
    const role = await getGroupRole('user_1', 'grp_1');
    expect(role).toBe('member');
  });

  it('falls back to environment role when no group membership', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no group membership
    mockQueryOne.mockResolvedValueOnce({ environment_id: 'env_1' }); // group exists
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' }); // env membership

    const role = await getGroupRole('user_1', 'grp_1');
    expect(role).toBe('admin');
  });

  it('returns null when group does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no group membership
    mockQueryOne.mockResolvedValueOnce(null); // no group found

    const role = await getGroupRole('user_1', 'grp_999');
    expect(role).toBeNull();
  });
});

describe('requireWorkspaceRole', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('returns owner role for superadmin without checking DB', async () => {
    const auth = makeSuperadmin();
    const role = await requireWorkspaceRole(auth, 'ws_1', 'admin');
    expect(role).toBe('owner');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns role when user meets minimum requirement', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    const role = await requireWorkspaceRole(auth, 'ws_1', 'member');
    expect(role).toBe('admin');
  });

  it('throws 403 Response when user has insufficient role', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce({ role: 'viewer' });

    try {
      await requireWorkspaceRole(auth, 'ws_1', 'admin');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      const response = e as Response;
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('insufficient workspace role');
    }
  });

  it('throws 403 Response when user is scoped even with a sufficient role', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce({ role: 'owner', access_scope: 'scoped' });

    await expect(requireWorkspaceRole(auth, 'ws_1', 'viewer')).rejects.toBeInstanceOf(Response);
  });

  it('throws 403 Response when user is not a member', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce(null);

    try {
      await requireWorkspaceRole(auth, 'ws_999', 'viewer');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).status).toBe(403);
    }
  });

  it('uses workspace API key scope/role without membership lookup', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      role: 'admin',
    });

    const role = await requireWorkspaceRole(auth, 'ws_1', 'viewer');
    expect(role).toBe('admin');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rejects workspace API key outside its workspace scope', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      role: 'owner',
    });

    await expect(requireWorkspaceRole(auth, 'ws_2', 'viewer')).rejects.toBeInstanceOf(Response);
  });

  it('does not grant superadmin bypass to API keys even if auth.user.is_superadmin is true', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'environment',
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      role: 'owner',
    });
    auth.user.is_superadmin = true;

    await expect(requireWorkspaceRole(auth, 'ws_1', 'viewer')).rejects.toBeInstanceOf(Response);
  });
});

describe('requireEnvironmentRole', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('returns owner role for superadmin without checking DB', async () => {
    const auth = makeSuperadmin();
    const role = await requireEnvironmentRole(auth, 'env_1', 'admin');
    expect(role).toBe('owner');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns role when user meets minimum requirement via direct membership', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    const role = await requireEnvironmentRole(auth, 'env_1', 'member');
    expect(role).toBe('admin');
  });

  it('throws 403 Response when user has insufficient role', async () => {
    const auth = makeAuth();
    mockQueryOne.mockResolvedValueOnce({ role: 'viewer' });

    try {
      await requireEnvironmentRole(auth, 'env_1', 'admin');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      const response = e as Response;
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('insufficient environment role');
    }
  });

  it('allows environment API key within matching environment scope', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'environment',
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      role: 'admin',
    });

    const role = await requireEnvironmentRole(auth, 'env_1', 'member');
    expect(role).toBe('admin');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rejects environment API key for a different environment', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'environment',
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      role: 'owner',
    });

    await expect(requireEnvironmentRole(auth, 'env_2', 'viewer')).rejects.toBeInstanceOf(Response);
  });

  it('allows workspace API key on environments in the same workspace only', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      role: 'member',
    });
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);

    await expect(requireEnvironmentRole(auth, 'env_1', 'viewer')).resolves.toBe('member');
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT workspace_id FROM environments WHERE id = $1',
      ['env_1']
    );
  });

  it('rejects workspace API key on environment in another workspace', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      role: 'owner',
    });
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'ws_2' } as never);

    await expect(requireEnvironmentRole(auth, 'env_2', 'viewer')).rejects.toBeInstanceOf(Response);
  });
});

describe('requireWorkspacePermission', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('uses workspace override thresholds instead of defaults', async () => {
    const auth = makeAuth();
    mockQueryOne
      .mockResolvedValueOnce({
        settings: {
          rbac: {
            permission_matrix: {
              workspace: { write: 'member' },
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({ role: 'member', access_scope: 'workspace' } as never);

    await expect(requireWorkspacePermission(auth, 'ws_1', 'write')).resolves.toBe('member');
  });
});

describe('requireEnvironmentPermission', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('uses workspace override thresholds for environment permissions when no env override', async () => {
    const auth = makeAuth();
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never) // getWorkspaceIdForEnvironment
      .mockResolvedValueOnce({ enterprise_features: {} } as never) // env features (no override)
      .mockResolvedValueOnce({
        settings: {
          rbac: {
            permission_matrix: {
              environment: { write: 'member' },
            },
          },
        },
      } as never) // workspace settings fallback
      .mockResolvedValueOnce({ role: 'member' } as never); // env membership

    await expect(requireEnvironmentPermission(auth, 'env_1', 'write')).resolves.toBe('member');
  });
});

describe('requireEnvironmentResourcePermission', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('uses non-environment resource thresholds from the workspace matrix when no env override', async () => {
    const auth = makeAuth();
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never) // getWorkspaceIdForEnvironment
      .mockResolvedValueOnce({ enterprise_features: {} } as never) // env features (no override)
      .mockResolvedValueOnce({
        settings: {
          rbac: {
            permission_matrix: {
              audit: { read: 'member' },
            },
          },
        },
      } as never) // workspace settings fallback
      .mockResolvedValueOnce({ role: 'member' } as never); // env membership

    await expect(requireEnvironmentResourcePermission(auth, 'env_1', 'audit', 'read')).resolves.toBe('member');
  });
});

describe('requireGroupPermission', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('returns immediately for superadmin without checking DB', async () => {
    const auth = makeSuperadmin();
    await requireGroupPermission(auth, 'grp_1', 'delete');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('succeeds when user has sufficient group role', async () => {
    const auth = makeAuth();
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({ settings: {} } as never)
      .mockResolvedValueOnce({ role: 'member' } as never);

    // group write requires member
    await expect(requireGroupPermission(auth, 'grp_1', 'write')).resolves.toBeUndefined();
  });

  it('throws 403 when user has no access to group', async () => {
    const auth = makeAuth();
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never) // group->workspace
      .mockResolvedValueOnce({ settings: {} } as never) // workspace settings
      .mockResolvedValueOnce(null) // no group membership
      .mockResolvedValueOnce(null); // no group found

    try {
      await requireGroupPermission(auth, 'grp_999', 'read');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      const response = e as Response;
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('no access to group');
    }
  });

  it('throws 403 when user has group access but insufficient permission', async () => {
    const auth = makeAuth();
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({ settings: {} } as never)
      .mockResolvedValueOnce({ role: 'viewer' } as never);

    try {
      // group write requires member, viewer is insufficient
      await requireGroupPermission(auth, 'grp_1', 'write');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      const response = e as Response;
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('insufficient group permission');
    }
  });

  it('allows environment API key to access groups within its environment', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'environment',
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      role: 'member',
    });
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({ settings: {} } as never)
      .mockResolvedValueOnce({ environment_id: 'env_1', workspace_id: 'ws_1' } as never);

    await expect(requireGroupPermission(auth, 'grp_1', 'write')).resolves.toBeUndefined();
  });

  it('rejects environment API key for groups outside its environment', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'environment',
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      role: 'owner',
    });
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({ settings: {} } as never)
      .mockResolvedValueOnce({ environment_id: 'env_2', workspace_id: 'ws_1' } as never);

    await expect(requireGroupPermission(auth, 'grp_2', 'read')).rejects.toBeInstanceOf(Response);
  });

  it('honors workspace RBAC override for group permissions', async () => {
    const auth = makeAuth();
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({
        settings: {
          rbac: {
            permission_matrix: {
              group: { write: 'viewer' },
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({ role: 'viewer' } as never);

    await expect(requireGroupPermission(auth, 'grp_1', 'write')).resolves.toBeUndefined();
  });
});

describe('API key auth role helpers', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('getWorkspaceRoleForAuth resolves workspace API key role and blocks other workspaces', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      role: 'admin',
    });

    await expect(getWorkspaceRoleForAuth(auth, 'ws_1')).resolves.toBe('admin');
    await expect(getWorkspaceRoleForAuth(auth, 'ws_2')).resolves.toBeNull();
  });

  it('getEnvironmentRoleForAuth returns null for environment API key outside scope', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'environment',
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      role: 'viewer',
    });

    await expect(getEnvironmentRoleForAuth(auth, 'env_2')).resolves.toBeNull();
  });

  it('getGroupRoleForAuth maps workspace API key to groups in same workspace only', async () => {
    const auth = makeApiKeyAuth({
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      role: 'member',
    });
    mockQueryOne
      .mockResolvedValueOnce({ environment_id: 'env_1', workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({ environment_id: 'env_2', workspace_id: 'ws_2' } as never);

    await expect(getGroupRoleForAuth(auth, 'grp_1')).resolves.toBe('member');
    await expect(getGroupRoleForAuth(auth, 'grp_2')).resolves.toBeNull();
  });
});
