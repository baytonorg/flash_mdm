import type { SessionAuthContext } from './auth.js';
import { query, queryOne } from './db.js';
import { errorResponse } from './helpers.js';
import { mergePermissionMatrixWithDefaults } from './rbac-matrix.js';
import {
  getEffectivePermissionMatrixForWorkspace,
  getEffectivePermissionMatrixForEnvironment,
  requireEnvironmentAccessScopeForResourcePermission,
  workspaceRoleMeetsMinimum,
  type WorkspaceRole,
} from './rbac.js';

// Describe only this session's actionable scopes. The write handlers independently
// authenticate, resolve grants and recheck permission under their lifecycle lock.
export async function getUserManagementControls(auth: SessionAuthContext, workspaceId: string, environmentId: string | null) {
  const superadmin = !!auth.user.is_superadmin;
  const workspace = await queryOne<{ role: WorkspaceRole | null; access_scope: string | null; settings: { rbac?: { permission_matrix?: unknown } } | null }>(
    `SELECT wm.role, wm.access_scope, w.settings FROM workspaces w
     LEFT JOIN workspace_memberships wm ON wm.workspace_id=w.id AND wm.user_id=$2
     WHERE w.id=$1 AND (wm.user_id IS NOT NULL OR $3)`, [workspaceId, auth.user.id, superadmin],
  );
  if (!workspace) throw errorResponse('Workspace access required', 403);
  const workspaceRole = superadmin ? 'owner' : workspace.access_scope === 'workspace' ? workspace.role : null;
  const allowed = (role: WorkspaceRole | null, ...floors: WorkspaceRole[]) =>
    role && (superadmin || floors.every(floor => workspaceRoleMeetsMinimum(role, floor))) ? role : null;
  const workspaceMatrix = await getEffectivePermissionMatrixForWorkspace(workspaceId);
  const workspaceRaw = workspace.settings?.rbac?.permission_matrix;
  const workspaceWriteMatrix = mergePermissionMatrixWithDefaults(workspaceRaw);
  const result = {
    workspace_invite: allowed(workspaceRole, workspaceMatrix.invite.write, workspaceWriteMatrix.invite.write),
    workspace_manage: allowed(workspaceRole, workspaceMatrix.workspace.manage_users, workspaceWriteMatrix.workspace.manage_users),
    environment_invite: null as WorkspaceRole | null,
    environment_manage: null as WorkspaceRole | null,
    group_invites: {} as Record<string, WorkspaceRole>,
  };
  if (!environmentId) return result;
  const environment = await queryOne<{ role: WorkspaceRole | null; enterprise_features: { rbac?: { permission_matrix?: unknown } } | null }>(
    `SELECT em.role, e.enterprise_features FROM environments e
     LEFT JOIN environment_memberships em ON em.environment_id=e.id AND em.user_id=$3
     WHERE e.id=$1 AND e.workspace_id=$2`, [environmentId, workspaceId, auth.user.id],
  );
  if (!environment) return result;
  const environmentRole = superadmin ? 'owner' : environment.role ?? workspaceRole;
  const environmentMatrix = await getEffectivePermissionMatrixForEnvironment(environmentId, workspaceId);
  const writeMatrix = mergePermissionMatrixWithDefaults(environment.enterprise_features?.rbac?.permission_matrix ?? workspaceRaw);
  result.environment_invite = allowed(environmentRole, 'admin', writeMatrix.environment.manage_users);
  result.environment_manage = allowed(environmentRole, environmentMatrix.environment.manage_users, writeMatrix.environment.manage_users);

  let visibility;
  try {
    visibility = await requireEnvironmentAccessScopeForResourcePermission(auth, environmentId, 'group', 'read');
  } catch (error) {
    if (error instanceof Response && error.status === 403) return result;
    throw error;
  }
  const visibleIds = visibility.mode === 'group' ? visibility.accessible_group_ids ?? [] : null;
  const groups = await query<{ id: string; role: WorkspaceRole | null }>(
    `SELECT g.id, direct.role FROM groups g
     LEFT JOIN LATERAL (
       SELECT gm.role FROM group_memberships gm
       JOIN groups assigned ON assigned.id=gm.group_id AND assigned.environment_id=g.environment_id
       JOIN group_closures gc ON gc.ancestor_id=gm.group_id
       WHERE gm.user_id=$2 AND gc.descendant_id=g.id ORDER BY gc.depth ASC LIMIT 1
     ) direct ON true
     WHERE g.environment_id=$1 AND ($3::uuid[] IS NULL OR g.id=ANY($3::uuid[]))`,
    [environmentId, auth.user.id, visibleIds],
  );
  for (const group of groups) {
    const role = allowed(superadmin ? 'owner' : group.role ?? environmentRole, 'admin', writeMatrix.group.manage_users);
    if (role) result.group_invites[group.id] = role;
  }
  return result;
}
