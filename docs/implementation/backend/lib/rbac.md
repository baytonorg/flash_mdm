# `netlify/functions/_lib/rbac.ts`

> Role-based access control engine with hierarchical role checks across workspaces, environments, and groups, supporting both session and API key authentication.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkspaceRole` | `'owner' \| 'admin' \| 'member' \| 'viewer'` | Union type for workspace role levels |
| `WorkspaceAccessScope` | `'workspace' \| 'scoped'` | Whether a membership grants full workspace or scoped access |
| `Permission` | Union of `'read' \| 'read_privileged' \| 'write' \| 'delete' \| 'manage_users' \| 'manage_settings' \| 'command' \| 'command_destructive' \| 'bulk_destructive' \| 'license_view' \| 'billing_view' \| 'billing_manage' \| 'billing_customer'` | All supported permission actions |
| `PermissionMatrix` | `Record<string, Record<string, WorkspaceRole>>` | Maps resource types to actions to minimum required role |
| `RBAC_ROLE_VALUES` | `WorkspaceRole[]` | Ordered array of roles from lowest to highest: `['viewer', 'member', 'admin', 'owner']` |
| `DEFAULT_PERMISSION_MATRIX` | `PermissionMatrix` | Built-in permission matrix defining minimum roles per resource/action |
| `EnvironmentAccessScope` | `interface` | Describes access mode (`'environment'` or `'group'`), effective role, and optional list of accessible group IDs |
| `clearWorkspacePermissionMatrixCache` | `() => void` | Clears the in-memory permission matrix cache |
| `clearWorkspacePermissionMatrixCacheForTests` | `() => void` | Alias for `clearWorkspacePermissionMatrixCache` |
| `workspaceRoleMeetsMinimum` | `(userRole: string, minRole: WorkspaceRole) => boolean` | Returns true if `userRole` is at or above `minRole` in the hierarchy |
| `getPermissionMatrixMinimumRoleFloor` | `(resource: string, action: string) => WorkspaceRole \| null` | Returns the absolute minimum role floor for a resource/action that cannot be overridden by workspace settings |
| `getEffectivePermissionMatrixForWorkspace` | `(workspaceId: string) => Promise<PermissionMatrix>` | Returns the effective permission matrix for a workspace (custom overrides merged with defaults), with 30s caching |
| `checkPermission` | `(auth: AuthContext, resource: string, action: string, userRole?: string, permissionMatrix?: PermissionMatrix) => boolean` | Synchronous permission check; superadmins always pass |
| `getWorkspaceRole` | `(userId: string, workspaceId: string) => Promise<WorkspaceRole \| null>` | Queries the user's role in a workspace |
| `getWorkspaceAccessScope` | `(userId: string, workspaceId: string) => Promise<WorkspaceAccessScope \| null>` | Queries the user's access scope in a workspace |
| `getEnvironmentRole` | `(userId: string, environmentId: string) => Promise<WorkspaceRole \| null>` | Returns environment membership role, falling back to inherited workspace role |
| `getGroupRole` | `(userId: string, groupId: string) => Promise<WorkspaceRole \| null>` | Returns group role using closure table for nested groups, falling back to environment/workspace role |
| `requireWorkspaceRole` | `(auth: AuthContext, workspaceId: string, minRole: WorkspaceRole) => Promise<WorkspaceRole>` | Throws 403 if user lacks minimum workspace role |
| `requireEnvironmentRole` | `(auth: AuthContext, environmentId: string, minRole: WorkspaceRole) => Promise<WorkspaceRole>` | Throws 403 if user lacks minimum environment role |
| `requireWorkspacePermission` | `(auth: AuthContext, workspaceId: string, permission: Permission) => Promise<WorkspaceRole>` | Resolves required role from permission matrix, then enforces workspace role |
| `requireWorkspaceResourcePermission` | `(auth: AuthContext, workspaceId: string, resource: string, permission: Permission) => Promise<WorkspaceRole>` | Like `requireWorkspacePermission` but for any resource type |
| `requireEnvironmentPermission` | `(auth: AuthContext, environmentId: string, permission: Permission) => Promise<WorkspaceRole>` | Resolves required role from permission matrix, then enforces environment role |
| `requireEnvironmentResourcePermission` | `(auth: AuthContext, environmentId: string, resource: string, permission: Permission) => Promise<WorkspaceRole>` | Like `requireEnvironmentPermission` but for any resource type |
| `requireEnvironmentAccessScope` | `(auth: AuthContext, environmentId: string, minRole: WorkspaceRole) => Promise<EnvironmentAccessScope>` | Returns access scope with group-level fallback via closure table; throws 403 on failure |
| `requireEnvironmentAccessScopeForPermission` | `(auth: AuthContext, environmentId: string, permission: Permission) => Promise<EnvironmentAccessScope>` | Permission-matrix-aware variant of `requireEnvironmentAccessScope` |
| `requireEnvironmentAccessScopeForResourcePermission` | `(auth: AuthContext, environmentId: string, resource: string, permission: Permission) => Promise<EnvironmentAccessScope>` | Resource-specific variant of `requireEnvironmentAccessScopeForPermission` |
| `requireGroupPermission` | `(auth: AuthContext, groupId: string, permission: Permission) => Promise<void>` | Throws 403 if user lacks required group permission |
| `getWorkspaceRoleForAuth` | `(auth: AuthContext, workspaceId: string) => Promise<WorkspaceRole \| null>` | Returns effective workspace role for any auth type (session, API key, superadmin) |
| `getWorkspaceAccessScopeForAuth` | `(auth: AuthContext, workspaceId: string) => Promise<WorkspaceAccessScope \| null>` | Returns effective access scope for any auth type |
| `getEnvironmentRoleForAuth` | `(auth: AuthContext, environmentId: string) => Promise<WorkspaceRole \| null>` | Returns effective environment role for any auth type |
| `getGroupRoleForAuth` | `(auth: AuthContext, groupId: string) => Promise<WorkspaceRole \| null>` | Returns effective group role for any auth type |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `clonePermissionMatrix` | 149-151 | Deep clones a permission matrix via JSON round-trip |
| `mergePermissionMatrixWithDefaults` | 153-172 | Merges workspace-custom overrides into the default matrix, enforcing floor roles |
| `getPermissionMatrixFromWorkspaceSettings` | 174-181 | Extracts and merges permission matrix from workspace settings JSONB |
| `getCachedWorkspacePermissionMatrix` | 183-191 | Returns cached matrix if present and not expired |
| `setCachedWorkspacePermissionMatrix` | 193-198 | Stores a matrix in the in-memory cache with TTL |
| `roleLevel` | 206-208 | Maps a role string to its numeric hierarchy value |
| `meetsMinimumRole` | 210-212 | Compares two roles numerically |
| `getWorkspacePermissionRequiredRole` | 238-245 | Looks up the minimum role for a resource/action in a workspace's effective matrix |
| `getApiKeyRoleForWorkspace` | 247-255 | Extracts API key role if scoped to the given workspace |
| `getApiKeyRoleForEnvironment` | 257-275 | Extracts API key role for environment (direct or via workspace scope) |
| `getApiKeyRoleForGroup` | 277-299 | Extracts API key role for group (environment or workspace scope with DB lookup) |
| `getWorkspaceIdForEnvironment` | 301-307 | Queries workspace ID for an environment |
| `getWorkspaceIdForGroup` | 309-318 | Queries workspace ID for a group via environments join |
| `getWorkspaceMembership` | 762-783 | Queries workspace membership with legacy fallback for missing `access_scope` column |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `query` | `_lib/db.ts` | Database queries for memberships and workspace settings |
| `AuthContext` (type) | `_lib/auth.ts` | Authenticated request context (session or API key) |

## Key Logic

The RBAC system uses a numeric role hierarchy (viewer=25, member=50, admin=75, owner=100) where higher values grant more access. Superadmins bypass all checks.

Permission checks resolve through three layers: workspace, environment, and group. Each layer can have direct memberships or inherit from the parent scope. Groups use a closure table (`group_closures`) for nested group access -- a user with membership in an ancestor group gains access to all descendant groups.

Workspaces can customize their permission matrix via `settings.rbac.permission_matrix` JSONB. Custom matrices are merged with defaults and validated against non-overridable minimum role floors (e.g., workspace delete always requires owner). The effective matrix is cached in-memory for 30 seconds.

API key authentication follows the same role/permission model but resolves scope differently: workspace-scoped keys get their role directly, environment-scoped keys check scope match, and both types can access child resources within their scope.
