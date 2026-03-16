import { queryOne, query } from './db.js';
import type { AuthContext } from './auth.js';

/**
 * Role hierarchy (highest to lowest):
 * superadmin > owner > admin > member > viewer
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspaceAccessScope = 'workspace' | 'scoped';
export type Permission =
  | 'read'
  | 'read_privileged'
  | 'write'
  | 'delete'
  | 'manage_users'
  | 'manage_settings'
  | 'command'
  | 'command_destructive'
  | 'bulk_destructive'
  | 'license_view'
  | 'billing_view'
  | 'billing_manage'
  | 'billing_customer';
export type PermissionMatrix = Record<string, Record<string, WorkspaceRole>>;

export const RBAC_ROLE_VALUES: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];

const ROLE_HIERARCHY: Record<string, number> = {
  owner: 100,
  admin: 75,
  member: 50,
  viewer: 25,
};

/**
 * Resource-action permission matrix.
 * Maps resource types to the minimum role required for each action.
 */
export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  workspace: {
    read: 'viewer',
    write: 'admin',
    delete: 'owner',
    manage_users: 'admin',
    manage_settings: 'owner',
  },
  environment: {
    read: 'viewer',
    write: 'admin',
    delete: 'owner',
    manage_users: 'admin',
    manage_settings: 'admin',
  },
  group: {
    read: 'viewer',
    write: 'member',
    delete: 'admin',
    manage_users: 'admin',
  },
  device: {
    read: 'viewer',
    write: 'member',
    delete: 'member',
    command: 'member',
    command_destructive: 'admin',
    bulk_destructive: 'admin',
  },
  policy: {
    read: 'viewer',
    write: 'member',
    delete: 'admin',
  },
  certificate: {
    read: 'viewer',
    write: 'member',
    delete: 'admin',
  },
  geofence: {
    read: 'viewer',
    write: 'member',
    delete: 'admin',
  },
  audit: {
    read: 'viewer',
    read_privileged: 'admin',
  },
  invite: {
    read: 'admin',
    write: 'admin',
    delete: 'admin',
  },
  billing: {
    license_view: 'viewer',
    billing_view: 'admin',
    billing_manage: 'admin',
    billing_customer: 'owner',
  },
  flashagent: {
    read: 'viewer',
    write: 'admin',
    manage_settings: 'admin',
  },
};

const MINIMUM_PERMISSION_FLOORS: Partial<Record<string, Partial<Record<string, WorkspaceRole>>>> = {
  workspace: {
    delete: 'owner',
    manage_users: 'admin',
    manage_settings: 'owner',
  },
  environment: {
    delete: 'owner',
    manage_users: 'admin',
    manage_settings: 'admin',
  },
  group: {
    delete: 'admin',
    manage_users: 'admin',
  },
  geofence: {
    delete: 'admin',
  },
  policy: {
    delete: 'admin',
  },
  certificate: {
    delete: 'admin',
  },
  audit: {
    read: 'viewer',
    read_privileged: 'admin',
  },
  invite: {
    read: 'admin',
    write: 'admin',
    delete: 'admin',
  },
  device: {
    command: 'member',
    command_destructive: 'admin',
    bulk_destructive: 'admin',
  },
  billing: {
    license_view: 'viewer',
    billing_view: 'admin',
    billing_manage: 'admin',
    billing_customer: 'owner',
  },
  flashagent: {
    write: 'admin',
    manage_settings: 'admin',
  },
};

const PERMISSION_MATRIX_CACHE_TTL_MS = 30_000;
const workspacePermissionMatrixCache = new Map<string, { expiresAt: number; matrix: PermissionMatrix }>();
const environmentPermissionMatrixCache = new Map<string, { expiresAt: number; matrix: PermissionMatrix }>();

function clonePermissionMatrix(matrix: PermissionMatrix): PermissionMatrix {
  return JSON.parse(JSON.stringify(matrix)) as PermissionMatrix;
}

function mergePermissionMatrixWithDefaults(value: unknown): PermissionMatrix {
  const merged = clonePermissionMatrix(DEFAULT_PERMISSION_MATRIX);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return merged;

  for (const [resource, actions] of Object.entries(value as Record<string, unknown>)) {
    if (!(resource in merged) || !actions || typeof actions !== 'object' || Array.isArray(actions)) continue;
    for (const [action, minRole] of Object.entries(actions as Record<string, unknown>)) {
      if (!(action in merged[resource])) continue;
      if (typeof minRole !== 'string') continue;
      if (!RBAC_ROLE_VALUES.includes(minRole as WorkspaceRole)) continue;
      const requestedRole = minRole as WorkspaceRole;
      const floorRole = getPermissionMatrixMinimumRoleFloor(resource, action);
      merged[resource][action] = floorRole && !workspaceRoleMeetsMinimum(requestedRole, floorRole)
        ? floorRole
        : requestedRole;
    }
  }

  return merged;
}

function getPermissionMatrixFromWorkspaceSettings(settings: unknown): PermissionMatrix | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const rbac = (settings as Record<string, unknown>).rbac;
  if (!rbac || typeof rbac !== 'object' || Array.isArray(rbac)) return null;
  const permissionMatrix = (rbac as Record<string, unknown>).permission_matrix;
  if (!permissionMatrix || typeof permissionMatrix !== 'object' || Array.isArray(permissionMatrix)) return null;
  return mergePermissionMatrixWithDefaults(permissionMatrix);
}

function getCachedWorkspacePermissionMatrix(workspaceId: string): PermissionMatrix | null {
  const cached = workspacePermissionMatrixCache.get(workspaceId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    workspacePermissionMatrixCache.delete(workspaceId);
    return null;
  }
  return clonePermissionMatrix(cached.matrix);
}

function setCachedWorkspacePermissionMatrix(workspaceId: string, matrix: PermissionMatrix): void {
  workspacePermissionMatrixCache.set(workspaceId, {
    expiresAt: Date.now() + PERMISSION_MATRIX_CACHE_TTL_MS,
    matrix: clonePermissionMatrix(matrix),
  });
}

export function clearWorkspacePermissionMatrixCache(): void {
  workspacePermissionMatrixCache.clear();
  // Environment matrices may inherit from workspace, so clear both
  environmentPermissionMatrixCache.clear();
}

export function clearEnvironmentPermissionMatrixCache(): void {
  environmentPermissionMatrixCache.clear();
}

export const clearWorkspacePermissionMatrixCacheForTests = clearWorkspacePermissionMatrixCache;

function roleLevel(role: string): number {
  return ROLE_HIERARCHY[role] ?? 0;
}

function meetsMinimumRole(userRole: string, minRole: WorkspaceRole): boolean {
  return roleLevel(userRole) >= roleLevel(minRole);
}

export function workspaceRoleMeetsMinimum(userRole: string, minRole: WorkspaceRole): boolean {
  return meetsMinimumRole(userRole, minRole);
}

export function getPermissionMatrixMinimumRoleFloor(resource: string, action: string): WorkspaceRole | null {
  return MINIMUM_PERMISSION_FLOORS[resource]?.[action] ?? null;
}

export async function getEffectivePermissionMatrixForWorkspace(
  workspaceId: string
): Promise<PermissionMatrix> {
  const cached = getCachedWorkspacePermissionMatrix(workspaceId);
  if (cached) return cached;

  const workspace = await queryOne<{ settings: unknown }>(
    'SELECT settings FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  const matrix =
    getPermissionMatrixFromWorkspaceSettings(workspace?.settings) ?? clonePermissionMatrix(DEFAULT_PERMISSION_MATRIX);
  setCachedWorkspacePermissionMatrix(workspaceId, matrix);
  return clonePermissionMatrix(matrix);
}

function getPermissionMatrixFromEnvironmentFeatures(features: unknown): PermissionMatrix | null {
  if (!features || typeof features !== 'object' || Array.isArray(features)) return null;
  const rbac = (features as Record<string, unknown>).rbac;
  if (!rbac || typeof rbac !== 'object' || Array.isArray(rbac)) return null;
  const permissionMatrix = (rbac as Record<string, unknown>).permission_matrix;
  if (!permissionMatrix || typeof permissionMatrix !== 'object' || Array.isArray(permissionMatrix)) return null;
  return mergePermissionMatrixWithDefaults(permissionMatrix);
}

function getCachedEnvironmentPermissionMatrix(environmentId: string): PermissionMatrix | null {
  const cached = environmentPermissionMatrixCache.get(environmentId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    environmentPermissionMatrixCache.delete(environmentId);
    return null;
  }
  return clonePermissionMatrix(cached.matrix);
}

function setCachedEnvironmentPermissionMatrix(environmentId: string, matrix: PermissionMatrix): void {
  environmentPermissionMatrixCache.set(environmentId, {
    expiresAt: Date.now() + PERMISSION_MATRIX_CACHE_TTL_MS,
    matrix: clonePermissionMatrix(matrix),
  });
}

export async function getEffectivePermissionMatrixForEnvironment(
  environmentId: string,
  workspaceId: string
): Promise<PermissionMatrix> {
  const cached = getCachedEnvironmentPermissionMatrix(environmentId);
  if (cached) return cached;

  const env = await queryOne<{ enterprise_features: unknown }>(
    'SELECT enterprise_features FROM environments WHERE id = $1',
    [environmentId]
  );
  const envMatrix = getPermissionMatrixFromEnvironmentFeatures(env?.enterprise_features);
  if (envMatrix) {
    setCachedEnvironmentPermissionMatrix(environmentId, envMatrix);
    return clonePermissionMatrix(envMatrix);
  }

  // No environment override — inherit workspace matrix
  const wsMatrix = await getEffectivePermissionMatrixForWorkspace(workspaceId);
  setCachedEnvironmentPermissionMatrix(environmentId, wsMatrix);
  return clonePermissionMatrix(wsMatrix);
}

async function getEnvironmentPermissionRequiredRole(
  environmentId: string,
  workspaceId: string,
  resource: string,
  action: string
): Promise<WorkspaceRole | null> {
  const matrix = await getEffectivePermissionMatrixForEnvironment(environmentId, workspaceId);
  return matrix[resource]?.[action] ?? null;
}

async function getWorkspacePermissionRequiredRole(
  workspaceId: string,
  resource: string,
  action: string
): Promise<WorkspaceRole | null> {
  const matrix = await getEffectivePermissionMatrixForWorkspace(workspaceId);
  return matrix[resource]?.[action] ?? null;
}

function getApiKeyRoleForWorkspace(
  auth: AuthContext,
  workspaceId: string
): WorkspaceRole | null {
  if (auth.authType !== 'api_key' || !auth.apiKey) return null;
  if (auth.apiKey.scope_type !== 'workspace') return null;
  if (auth.apiKey.workspace_id !== workspaceId) return null;
  return auth.apiKey.role;
}

async function getApiKeyRoleForEnvironment(
  auth: AuthContext,
  environmentId: string
): Promise<WorkspaceRole | null> {
  if (auth.authType !== 'api_key' || !auth.apiKey) return null;

  if (auth.apiKey.scope_type === 'environment') {
    return auth.apiKey.environment_id === environmentId ? auth.apiKey.role : null;
  }

  if (auth.apiKey.scope_type !== 'workspace') return null;

  const env = await queryOne<{ workspace_id: string }>(
    'SELECT workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env || env.workspace_id !== auth.apiKey.workspace_id) return null;
  return auth.apiKey.role;
}

async function getApiKeyRoleForGroup(
  auth: AuthContext,
  groupId: string
): Promise<WorkspaceRole | null> {
  if (auth.authType !== 'api_key' || !auth.apiKey) return null;

  const group = await queryOne<{ environment_id: string; workspace_id: string }>(
    `SELECT g.environment_id, e.workspace_id
     FROM groups g
     JOIN environments e ON e.id = g.environment_id
     WHERE g.id = $1`,
    [groupId]
  );
  if (!group) return null;

  if (auth.apiKey.scope_type === 'environment') {
    return auth.apiKey.environment_id === group.environment_id ? auth.apiKey.role : null;
  }
  if (auth.apiKey.scope_type === 'workspace') {
    return auth.apiKey.workspace_id === group.workspace_id ? auth.apiKey.role : null;
  }
  return null;
}

async function getWorkspaceIdForEnvironment(environmentId: string): Promise<string | null> {
  const env = await queryOne<{ workspace_id: string }>(
    'SELECT workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
  return env?.workspace_id ?? null;
}

async function getWorkspaceIdForGroup(groupId: string): Promise<string | null> {
  const group = await queryOne<{ workspace_id: string }>(
    `SELECT e.workspace_id
     FROM groups g
     JOIN environments e ON e.id = g.environment_id
     WHERE g.id = $1`,
    [groupId]
  );
  return group?.workspace_id ?? null;
}

/**
 * Check if the authenticated user has permission for a resource/action.
 * Superadmins always have permission.
 */
export function checkPermission(
  auth: AuthContext,
  resource: string,
  action: string,
  userRole?: string,
  permissionMatrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX
): boolean {
  if (auth.authType === 'session' && auth.user.is_superadmin) return true;

  const matrix = permissionMatrix[resource];
  if (!matrix) return false;

  const requiredRole = matrix[action];
  if (!requiredRole) return false;

  if (!userRole) return false;

  return meetsMinimumRole(userRole, requiredRole);
}

/**
 * Get the user's role in a workspace. Returns null if not a member.
 */
export async function getWorkspaceRole(
  userId: string,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  const row = await getWorkspaceMembership(userId, workspaceId);
  return row?.role ?? null;
}

export async function getWorkspaceAccessScope(
  userId: string,
  workspaceId: string
): Promise<WorkspaceAccessScope | null> {
  const row = await getWorkspaceMembership(userId, workspaceId);
  return row?.access_scope ?? null;
}

/**
 * Get the user's role in an environment. Checks direct membership first,
 * then falls back to inherited workspace role.
 */
export async function getEnvironmentRole(
  userId: string,
  environmentId: string
): Promise<WorkspaceRole | null> {
  // Check direct environment membership
  const envMembership = await queryOne<{ role: WorkspaceRole }>(
    'SELECT role FROM environment_memberships WHERE environment_id = $1 AND user_id = $2',
    [environmentId, userId]
  );
  if (envMembership) return envMembership.role;

  // Fall back to workspace role (inherited)
  const workspace = await queryOne<{ workspace_id: string }>(
    'SELECT workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!workspace) return null;

  const accessScope = await getWorkspaceAccessScope(userId, workspace.workspace_id);
  if (accessScope !== 'workspace') return null;

  return getWorkspaceRole(userId, workspace.workspace_id);
}

/**
 * Get the user's effective role for a group. Checks group membership,
 * then environment membership, then workspace membership via inheritance.
 * Uses the closure table for nested group access.
 */
export async function getGroupRole(
  userId: string,
  groupId: string
): Promise<WorkspaceRole | null> {
  // Check if user has membership in this group or any ancestor group
  const groupMembership = await queryOne<{ role: WorkspaceRole }>(
    `SELECT gm.role
     FROM group_memberships gm
     JOIN group_closures gc ON gc.ancestor_id = gm.group_id
     WHERE gc.descendant_id = $1 AND gm.user_id = $2
     ORDER BY gc.depth ASC
     LIMIT 1`,
    [groupId, userId]
  );
  if (groupMembership) return groupMembership.role;

  // Fall back to environment role
  const group = await queryOne<{ environment_id: string }>(
    'SELECT environment_id FROM groups WHERE id = $1',
    [groupId]
  );
  if (!group) return null;

  return getEnvironmentRole(userId, group.environment_id);
}

/**
 * Require the user has at least the specified role in the workspace.
 * Throws a 403 Response if insufficient.
 */
export async function requireWorkspaceRole(
  auth: AuthContext,
  workspaceId: string,
  minRole: WorkspaceRole
): Promise<WorkspaceRole> {
  if (auth.authType === 'session' && auth.user.is_superadmin) return 'owner';

  const apiKeyRole = getApiKeyRoleForWorkspace(auth, workspaceId);
  if (apiKeyRole && meetsMinimumRole(apiKeyRole, minRole)) {
    return apiKeyRole;
  }
  if (auth.authType === 'api_key') {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const membership = await getWorkspaceMembership(auth.user.id, workspaceId);
  const role = membership?.role ?? null;
  if (!role || membership?.access_scope !== 'workspace' || !meetsMinimumRole(role, minRole)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return role;
}

/**
 * Require the user has at least the specified role in the environment.
 * Checks direct env membership OR inherited workspace role.
 * Throws a 403 Response if insufficient.
 */
export async function requireEnvironmentRole(
  auth: AuthContext,
  environmentId: string,
  minRole: WorkspaceRole
): Promise<WorkspaceRole> {
  if (auth.authType === 'session' && auth.user.is_superadmin) return 'owner';

  const apiKeyRole = await getApiKeyRoleForEnvironment(auth, environmentId);
  if (apiKeyRole && meetsMinimumRole(apiKeyRole, minRole)) {
    return apiKeyRole;
  }
  if (auth.authType === 'api_key') {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient environment role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const role = await getEnvironmentRole(auth.user.id, environmentId);
  if (!role || !meetsMinimumRole(role, minRole)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient environment role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return role;
}

export async function requireWorkspacePermission(
  auth: AuthContext,
  workspaceId: string,
  permission: Permission
): Promise<WorkspaceRole> {
  return requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', permission);
}

export async function requireWorkspaceResourcePermission(
  auth: AuthContext,
  workspaceId: string,
  resource: string,
  permission: Permission
): Promise<WorkspaceRole> {
  const requiredRole = await getWorkspacePermissionRequiredRole(workspaceId, resource, permission);
  if (!requiredRole) {
    throw new Response(JSON.stringify({ error: `RBAC misconfiguration: unknown ${resource} permission` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return requireWorkspaceRole(auth, workspaceId, requiredRole);
}

export async function requireEnvironmentPermission(
  auth: AuthContext,
  environmentId: string,
  permission: Permission
): Promise<WorkspaceRole> {
  return requireEnvironmentResourcePermission(auth, environmentId, 'environment', permission);
}

export async function requireEnvironmentResourcePermission(
  auth: AuthContext,
  environmentId: string,
  resource: string,
  permission: Permission
): Promise<WorkspaceRole> {
  const workspaceId = await getWorkspaceIdForEnvironment(environmentId);
  if (!workspaceId) {
    throw new Response(JSON.stringify({ error: 'Environment not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const requiredRole = await getEnvironmentPermissionRequiredRole(environmentId, workspaceId, resource, permission);
  if (!requiredRole) {
    throw new Response(JSON.stringify({ error: `RBAC misconfiguration: unknown ${resource} permission` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return requireEnvironmentRole(auth, environmentId, requiredRole);
}

export interface EnvironmentAccessScope {
  mode: 'environment' | 'group';
  role: WorkspaceRole;
  accessible_group_ids: string[] | null;
}

/**
 * Require access to an environment either via environment/workspace-wide role,
 * or via scoped group memberships within that environment (descendants included).
 * Returns the effective access mode and, for group-scoped access, the list of
 * accessible group ids for downstream filtering.
 */
export async function requireEnvironmentAccessScope(
  auth: AuthContext,
  environmentId: string,
  minRole: WorkspaceRole
): Promise<EnvironmentAccessScope> {
  if (auth.authType === 'session' && auth.user.is_superadmin) {
    return { mode: 'environment', role: 'owner', accessible_group_ids: null };
  }

  const apiKeyRole = await getApiKeyRoleForEnvironment(auth, environmentId);
  if (apiKeyRole && meetsMinimumRole(apiKeyRole, minRole)) {
    return { mode: 'environment', role: apiKeyRole, accessible_group_ids: null };
  }
  if (auth.authType === 'api_key') {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient environment role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const envRole = await getEnvironmentRole(auth.user.id, environmentId);
  if (envRole && meetsMinimumRole(envRole, minRole)) {
    return { mode: 'environment', role: envRole, accessible_group_ids: null };
  }

  const groupRows = await query<{ role: WorkspaceRole; descendant_id: string }>(
    `SELECT gm.role, gc.descendant_id
     FROM group_memberships gm
     JOIN groups g_direct ON g_direct.id = gm.group_id
     JOIN group_closures gc ON gc.ancestor_id = gm.group_id
     JOIN groups g_desc ON g_desc.id = gc.descendant_id
     WHERE gm.user_id = $1
       AND g_direct.environment_id = $2
       AND g_desc.environment_id = $2`,
    [auth.user.id, environmentId]
  );

  if (groupRows.length === 0) {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient environment role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let maxRole: WorkspaceRole | null = null;
  const accessibleGroupIds = new Set<string>();
  for (const row of groupRows) {
    accessibleGroupIds.add(row.descendant_id);
    if (!maxRole || roleLevel(row.role) > roleLevel(maxRole)) {
      maxRole = row.role;
    }
  }

  if (!maxRole || !meetsMinimumRole(maxRole, minRole)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient environment role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return {
    mode: 'group',
    role: maxRole,
    accessible_group_ids: [...accessibleGroupIds],
  };
}

export async function requireEnvironmentAccessScopeForPermission(
  auth: AuthContext,
  environmentId: string,
  permission: Permission
): Promise<EnvironmentAccessScope> {
  return requireEnvironmentAccessScopeForResourcePermission(auth, environmentId, 'environment', permission);
}

export async function requireEnvironmentAccessScopeForResourcePermission(
  auth: AuthContext,
  environmentId: string,
  resource: string,
  permission: Permission
): Promise<EnvironmentAccessScope> {
  const workspaceId = await getWorkspaceIdForEnvironment(environmentId);
  if (!workspaceId) {
    throw new Response(JSON.stringify({ error: 'Environment not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const requiredRole = await getEnvironmentPermissionRequiredRole(environmentId, workspaceId, resource, permission);
  if (!requiredRole) {
    throw new Response(JSON.stringify({ error: `RBAC misconfiguration: unknown ${resource} permission` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return requireEnvironmentAccessScope(auth, environmentId, requiredRole);
}

/**
 * Require the user has a specific permission on a group.
 * Checks group membership (with closure table for nested access)
 * OR inherited env/workspace role.
 * Throws a 403 Response if insufficient.
 */
export async function requireGroupPermission(
  auth: AuthContext,
  groupId: string,
  permission: Permission
): Promise<void> {
  if (auth.authType === 'session' && auth.user.is_superadmin) return;

  const workspaceId = await getWorkspaceIdForGroup(groupId);
  if (!workspaceId) {
    throw new Response(JSON.stringify({ error: 'Forbidden: no access to group' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const requiredRole = await getWorkspacePermissionRequiredRole(workspaceId, 'group', permission);
  if (!requiredRole) {
    throw new Response(JSON.stringify({ error: 'RBAC misconfiguration: unknown group permission' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKeyRole = await getApiKeyRoleForGroup(auth, groupId);
  if (apiKeyRole) {
    if (!meetsMinimumRole(apiKeyRole, requiredRole)) {
      throw new Response(JSON.stringify({ error: 'Forbidden: insufficient group permission' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return;
  }
  if (auth.authType === 'api_key') {
    throw new Response(JSON.stringify({ error: 'Forbidden: no access to group' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const role = await getGroupRole(auth.user.id, groupId);
  if (!role) {
    throw new Response(JSON.stringify({ error: 'Forbidden: no access to group' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!meetsMinimumRole(role, requiredRole)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: insufficient group permission' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function getWorkspaceRoleForAuth(
  auth: AuthContext,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  if (auth.authType === 'session' && auth.user.is_superadmin) return 'owner';
  const apiKeyRole = getApiKeyRoleForWorkspace(auth, workspaceId);
  if (apiKeyRole) return apiKeyRole;
  if (auth.authType === 'api_key') return null;
  return getWorkspaceRole(auth.user.id, workspaceId);
}

export async function getWorkspaceAccessScopeForAuth(
  auth: AuthContext,
  workspaceId: string
): Promise<WorkspaceAccessScope | null> {
  if (auth.authType === 'session' && auth.user.is_superadmin) return 'workspace';
  if (auth.authType === 'api_key') {
    if (!auth.apiKey || auth.apiKey.workspace_id !== workspaceId) return null;
    return auth.apiKey.scope_type === 'workspace' ? 'workspace' : 'scoped';
  }
  return getWorkspaceAccessScope(auth.user.id, workspaceId);
}

export async function getEnvironmentRoleForAuth(
  auth: AuthContext,
  environmentId: string
): Promise<WorkspaceRole | null> {
  if (auth.authType === 'session' && auth.user.is_superadmin) return 'owner';
  const apiKeyRole = await getApiKeyRoleForEnvironment(auth, environmentId);
  if (apiKeyRole) return apiKeyRole;
  if (auth.authType === 'api_key') return null;
  return getEnvironmentRole(auth.user.id, environmentId);
}

export async function getGroupRoleForAuth(
  auth: AuthContext,
  groupId: string
): Promise<WorkspaceRole | null> {
  if (auth.authType === 'session' && auth.user.is_superadmin) return 'owner';
  const apiKeyRole = await getApiKeyRoleForGroup(auth, groupId);
  if (apiKeyRole) return apiKeyRole;
  if (auth.authType === 'api_key') return null;
  return getGroupRole(auth.user.id, groupId);
}

async function getWorkspaceMembership(
  userId: string,
  workspaceId: string
): Promise<{ role: WorkspaceRole; access_scope: WorkspaceAccessScope } | null> {
  try {
    const row = await queryOne<{ role: WorkspaceRole; access_scope: WorkspaceAccessScope }>(
      'SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );
    return row ? { role: row.role, access_scope: row.access_scope ?? 'workspace' } : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('column "access_scope" does not exist')) {
      const legacy = await queryOne<{ role: WorkspaceRole }>(
        'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      return legacy ? { role: legacy.role, access_scope: 'workspace' } : null;
    }
    throw err;
  }
}
