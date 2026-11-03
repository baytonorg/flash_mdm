import { changeMemberships, type MembershipRole } from './_lib/membership-lifecycle.js';
import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  requireEnvironmentResourcePermission,
  getWorkspaceAccessScope,
  getWorkspaceAccessScopeForAuth,
  getWorkspaceRole,
  requireWorkspacePermission,
} from './_lib/rbac.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp, isValidUuid } from './_lib/helpers.js';

function areValidUuids(values: string[]): boolean {
  return values.every(isValidUuid);
}

type BulkSelection = {
  ids?: string[];
  all_matching?: boolean;
  excluded_ids?: string[];
};

type WorkspaceUsersBulkBody = {
  workspace_id?: string;
  operation?: 'remove' | 'access_overwrite';
  selection?: BulkSelection;
  options?: {
    role?: string;
    cancel_pending_invites?: boolean;
    access_scope?: 'workspace' | 'scoped';
    environment_ids?: string[];
    group_ids?: string[];
  };
};

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/workspaces/users', '').split('/').filter(Boolean);

  // GET /api/workspaces/users?workspace_id=...
  if (request.method === 'GET') {
    const params = getSearchParams(request);
    const workspaceId = params.get('workspace_id');
    if (!workspaceId) return errorResponse('workspace_id is required');
    if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');
    let canManageUsers = true;
    let hasWorkspaceReadAccess = true;
    try {
      await requireWorkspacePermission(auth, workspaceId, 'manage_users');
    } catch (err) {
      const insufficientWorkspaceRole = err instanceof Response && err.status === 403;
      if (!insufficientWorkspaceRole) throw err;
      canManageUsers = false;
      try {
        await requireWorkspacePermission(auth, workspaceId, 'read');
      } catch (readErr) {
        const insufficientReadRole = readErr instanceof Response && readErr.status === 403;
        if (!insufficientReadRole) throw readErr;
        hasWorkspaceReadAccess = false;
      }
    }

    const accessScope = await getWorkspaceAccessScopeForAuth(auth, workspaceId);
    if (!canManageUsers) {
      if (accessScope === 'scoped') {
        const visibility = auth.authType === 'api_key'
          ? { envIds: [], groupIds: [] }
          : await getScopedVisibilityAssignments(auth.user.id, workspaceId);
        const scopedUsers = await listScopedWorkspaceUsers(workspaceId, visibility.envIds, visibility.groupIds);
        const users = scopedUsers.length > 0
          ? scopedUsers
          : await listWorkspaceUsers(workspaceId, auth.user.id);
        const envAssignments = await listEnvironmentAssignments(workspaceId);
        const groupAssignments = await listGroupAssignments(workspaceId);
        const scopedEnvAssignments = filterEnvironmentAssignments(envAssignments, visibility.envIds);
        const scopedGroupAssignments = filterGroupAssignments(groupAssignments, visibility.groupIds);
        return jsonResponse({
          users: mapWorkspaceUsers(users, scopedEnvAssignments, scopedGroupAssignments),
          limited_view: true,
        });
      }

      if (!hasWorkspaceReadAccess) {
        return errorResponse('Forbidden: insufficient workspace role', 403);
      }

      const users = await listWorkspaceUsers(workspaceId, auth.user.id);
      const envAssignments = await listEnvironmentAssignments(workspaceId, auth.user.id);
      const groupAssignments = await listGroupAssignments(workspaceId, auth.user.id);
      return jsonResponse({
        users: mapWorkspaceUsers(users, envAssignments, groupAssignments),
        limited_view: true,
      });
    }

    const canViewFullList = auth.authType === 'api_key'
      ? true
      : await canViewWorkspaceUsersList(auth.user.id, workspaceId, !!auth.user.is_superadmin);

    if (accessScope === 'workspace' || canViewFullList) {
      const users = await listWorkspaceUsers(workspaceId);
      const envAssignments = await listEnvironmentAssignments(workspaceId);
      const groupAssignments = await listGroupAssignments(workspaceId);
      return jsonResponse({
        users: mapWorkspaceUsers(users, envAssignments, groupAssignments),
        limited_view: false,
      });
    }

    const visibility = auth.authType === 'api_key'
      ? { envIds: [], groupIds: [] }
      : await getScopedVisibilityAssignments(auth.user.id, workspaceId);
    const scopedUsers = await listScopedWorkspaceUsers(workspaceId, visibility.envIds, visibility.groupIds);
    const users = scopedUsers.length > 0
      ? scopedUsers
      : await listWorkspaceUsers(workspaceId, auth.user.id);
    const envAssignments = await listEnvironmentAssignments(workspaceId);
    const groupAssignments = await listGroupAssignments(workspaceId);
    const scopedEnvAssignments = filterEnvironmentAssignments(envAssignments, visibility.envIds);
    const scopedGroupAssignments = filterGroupAssignments(groupAssignments, visibility.groupIds);

    return jsonResponse({
      users: mapWorkspaceUsers(users, scopedEnvAssignments, scopedGroupAssignments),
      limited_view: true,
    });
  }

  if (request.method === 'POST' && segments[0] === 'transfer-ownership') {
    if (auth.authType !== 'session') return errorResponse('Session authentication is required', 403);
    const body = await parseJsonBody<{ workspace_id: string; successor_id: string; previous_owner_role: 'admin' | 'member' | 'viewer' | 'leave'; successor_consent_acknowledged?: boolean; cancel_pending_invites?: boolean }>(request);
    if (!isValidUuid(body.workspace_id) || !isValidUuid(body.successor_id) || body.successor_id === auth.user.id) return errorResponse('Choose another existing workspace member');
    if (!['admin', 'member', 'viewer', 'leave'].includes(body.previous_owner_role) || body.successor_consent_acknowledged !== true) return errorResponse('Choose your resulting access and confirm the successor agreed to workspace-wide ownership');
    const current = await getWorkspaceMembershipForUpdate(body.workspace_id, auth.user.id);
    if (current?.role !== 'owner' || current.access_scope !== 'workspace') return errorResponse('Only a current workspace-wide owner can transfer their ownership', 403);
    await changeMemberships({ workspaceId: body.workspace_id, auth, callerRole: 'owner', selfService: true, requireCurrentWorkspaceOwner: true, ip: getClientIp(request), changes: [
      { userId: body.successor_id, operation: 'role', role: 'owner', accessScope: 'workspace' },
      { userId: auth.user.id, operation: body.previous_owner_role === 'leave' ? 'remove' : 'role', role: body.previous_owner_role === 'leave' ? undefined : body.previous_owner_role, cancelPendingInvites: body.cancel_pending_invites },
    ] });
    return jsonResponse({ message: 'Ownership transferred. Independent child roles and API keys were preserved.' });
  }

  // Deliberate self-service offboarding. It preserves identity and other workspaces.
  if (request.method === 'POST' && segments[0] === 'leave') {
    if (auth.authType !== 'session') return errorResponse('Session authentication is required', 403);
    const body = await parseJsonBody<{ workspace_id: string; confirm_leave?: boolean; cancel_pending_invites?: boolean }>(request);
    if (!isValidUuid(body.workspace_id) || body.confirm_leave !== true) return errorResponse('A workspace and explicit leave confirmation are required');
    const callerRole = await getWorkspaceRole(auth.user.id, body.workspace_id);
    if (!callerRole) return errorResponse('No workspace membership', 404);
    await changeMemberships({ workspaceId: body.workspace_id, auth, callerRole, selfService: true, ip: getClientIp(request),
      changes: [{ userId: auth.user.id, operation: 'remove', cancelPendingInvites: body.cancel_pending_invites }] });
    return jsonResponse({ message: 'You left the workspace. Your account and other workspace access were preserved.' });
  }

  // POST /api/workspaces/users/bulk
  if (request.method === 'POST' && segments[0] === 'bulk') {
    const body = await parseJsonBody<WorkspaceUsersBulkBody>(request);
    if (!body.workspace_id || !body.operation || !body.selection) {
      return errorResponse('workspace_id, operation, and selection are required');
    }
    if (!isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');

    const callerAccessScope = await getWorkspaceAccessScopeForAuth(auth, body.workspace_id);
    if (!auth.user.is_superadmin && callerAccessScope === 'scoped') {
      return errorResponse('Forbidden: insufficient workspace scope', 403);
    }

    const callerRole = await requireWorkspacePermission(auth, body.workspace_id, 'manage_users');

    const ids = Array.from(new Set((body.selection.ids ?? []).filter(Boolean)));
    const excludedIds = Array.from(new Set((body.selection.excluded_ids ?? []).filter(Boolean)));
    if (!areValidUuids(excludedIds)) return errorResponse('selection.excluded_ids must contain valid UUIDs');
    const excludedIdSet = new Set(excludedIds);
    let targetUserIds: string[] = [];
    if (body.selection.all_matching) {
      const rows = await query<{ user_id: string }>(
        'SELECT user_id FROM workspace_memberships WHERE workspace_id = $1',
        [body.workspace_id]
      );
      targetUserIds = rows
        .map((r) => r.user_id)
        .filter((id) => !excludedIdSet.has(id));
    } else {
      if (ids.length === 0) return errorResponse('selection.ids must include at least one user id');
      if (!areValidUuids(ids)) return errorResponse('selection.ids must contain valid UUIDs');
      targetUserIds = ids;
    }

    const options = body.options ?? {};
    const envIds = Array.from(new Set((options.environment_ids ?? []).filter(Boolean)));
    const groupIds = Array.from(new Set((options.group_ids ?? []).filter(Boolean)));
    if (!areValidUuids(envIds)) return errorResponse('options.environment_ids must contain valid UUIDs');
    if (!areValidUuids(groupIds)) return errorResponse('options.group_ids must contain valid UUIDs');

    if (body.operation === 'access_overwrite') {
      if (!options.access_scope) return errorResponse('options.access_scope is required for access_overwrite');
      if (!['workspace', 'scoped'].includes(options.access_scope)) {
        return errorResponse('options.access_scope must be "workspace" or "scoped"');
      }
      if (envIds.length > 0) {
        const envRows = await query<{ id: string }>(
          `SELECT id FROM environments
           WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
          [body.workspace_id, envIds]
        );
        if (envRows.length !== envIds.length) {
          return errorResponse('One or more options.environment_ids are invalid for this workspace', 400);
        }
      }
      if (groupIds.length > 0) {
        const groupRows = await query<{ id: string }>(
          `SELECT g.id
           FROM groups g
           JOIN environments e ON e.id = g.environment_id
           WHERE e.workspace_id = $1 AND g.id = ANY($2::uuid[])`,
          [body.workspace_id, groupIds]
        );
        if (groupRows.length !== groupIds.length) {
          return errorResponse('One or more options.group_ids are invalid for this workspace', 400);
        }
      }
      if (options.role) {
        const validRoles = ['owner', 'admin', 'member', 'viewer'];
        if (!validRoles.includes(options.role)) {
          return errorResponse(`options.role must be one of: ${validRoles.join(', ')}`);
        }
      }
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const targetUserId of targetUserIds) {
      if (targetUserId === auth.user.id) {
        results.push({ id: targetUserId, ok: false, error: 'Cannot modify your own membership in bulk' });
        continue;
      }

      const targetMembership = await queryOne<{ role: string; access_scope?: string }>(
        'SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [body.workspace_id, targetUserId]
      );
      if (!targetMembership) {
        results.push({ id: targetUserId, ok: false, error: 'User is not a member of this workspace' });
        continue;
      }

      if (callerRole !== 'owner' && !auth.user.is_superadmin && targetMembership.role === 'owner' && targetMembership.access_scope !== 'scoped') {
        results.push({ id: targetUserId, ok: false, error: 'Only owners can modify another owner' });
        continue;
      }

      results.push({ id: targetUserId, ok: true });
    }

    const eligible = results.filter(r => r.ok);
    if (eligible.length) {
      try {
        await changeMemberships({
          workspaceId: body.workspace_id, auth, callerRole, ip: getClientIp(request),
          changes: eligible.map(r => ({
            userId: r.id, operation: body.operation === 'remove' ? 'remove' : 'access',
            role: options.role as MembershipRole | undefined,
            assignmentRole: options.role as MembershipRole | undefined,
            accessScope: options.access_scope, environmentIds: envIds, groupIds,
            cancelPendingInvites: options.cancel_pending_invites,
          })),
        });
      } catch (err) {
        const message = err instanceof Response ? (await err.json()).error : 'Membership update failed; no eligible member changes were committed';
        for (const result of eligible) { result.ok = false; result.error = message; }
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;
    return jsonResponse({
      total_targeted: results.length,
      succeeded,
      failed,
      results,
    });
  }

  // PUT /api/workspaces/users/role — change a user's role
  if (request.method === 'PUT' && segments[0] === 'role') {
    const body = await parseJsonBody<{ workspace_id: string; user_id: string; role: string }>(request);
    if (!body.workspace_id || !body.user_id || !body.role) {
      return errorResponse('workspace_id, user_id, and role are required');
    }
    if (!isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');
    if (!isValidUuid(body.user_id)) return errorResponse('user_id must be a valid UUID');

    const validRoles = ['owner', 'admin', 'member', 'viewer'];
    if (!validRoles.includes(body.role)) {
      return errorResponse(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }

    const callerAccessScope = await getWorkspaceAccessScopeForAuth(auth, body.workspace_id);
    if (!auth.user.is_superadmin && callerAccessScope === 'scoped') {
      return errorResponse('Forbidden: insufficient workspace scope', 403);
    }

    // Require admin+ role in the workspace
    const callerRole = await requireWorkspacePermission(auth, body.workspace_id, 'manage_users');

    // Cannot change own role
    if (body.user_id === auth.user.id) {
      return errorResponse('Cannot change your own role');
    }

    // Non-owner admins cannot promote to owner or demote owners
    if (callerRole !== 'owner' && !auth.user.is_superadmin) {
      if (body.role === 'owner') {
        return errorResponse('Only owners can promote to owner', 403);
      }
      const targetMembership = await queryOne<{ role: string; access_scope?: string }>(
        'SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [body.workspace_id, body.user_id]
      );
      if (targetMembership?.role === 'owner' && targetMembership.access_scope !== 'scoped') {
        return errorResponse('Only owners can change another owner\'s role', 403);
      }
    }

    // Verify target user is a member
    const existing = await queryOne<{ role: string; access_scope?: string }>(
      'SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [body.workspace_id, body.user_id]
    );
    if (!existing) return errorResponse('User is not a member of this workspace', 404);

    await changeMemberships({ workspaceId: body.workspace_id, auth, callerRole,
      ip: getClientIp(request), changes: [{ userId: body.user_id, operation: 'role', role: body.role as MembershipRole }] });

    return jsonResponse({ message: 'Role updated' });
  }

  // PUT /api/workspaces/users/access — update workspace-wide vs scoped access and direct env/group assignments
  if (request.method === 'PUT' && segments[0] === 'access') {
    const body = await parseJsonBody<{
      workspace_id: string;
      user_id: string;
      access_scope: 'workspace' | 'scoped';
      scoped_role?: string;
      workspace_role?: string;
      cancel_pending_invites?: boolean;
      environment_ids?: string[];
      group_ids?: string[];
      acting_environment_id?: string;
    }>(request);
    if (!body.workspace_id || !body.user_id || !body.access_scope) {
      return errorResponse('workspace_id, user_id, and access_scope are required');
    }
    if (!isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');
    if (!isValidUuid(body.user_id)) return errorResponse('user_id must be a valid UUID');
    if (!['workspace', 'scoped'].includes(body.access_scope)) {
      return errorResponse('access_scope must be "workspace" or "scoped"');
    }
    if (body.scoped_role) {
      const validRoles = ['owner', 'admin', 'member', 'viewer'];
      if (!validRoles.includes(body.scoped_role)) {
        return errorResponse(`scoped_role must be one of: ${validRoles.join(', ')}`);
      }
    }
    if (body.workspace_role && !['owner', 'admin', 'member', 'viewer'].includes(body.workspace_role)) return errorResponse('Invalid workspace_role');

    let callerRole: string;
    let scopedEnvironmentManager = false;
    let actingEnvironmentId: string | null = null;
    const callerAccessScope = await getWorkspaceAccessScopeForAuth(auth, body.workspace_id);
    if (!auth.user.is_superadmin && callerAccessScope === 'scoped') {
      if (auth.authType === 'api_key') {
        return errorResponse('Forbidden: insufficient workspace scope', 403);
      }
      const callerMembership = await getWorkspaceMembershipForUpdate(body.workspace_id, auth.user.id);
      if (!callerMembership) {
        return errorResponse('Forbidden: insufficient workspace role', 403);
      }
      if (!body.acting_environment_id) {
        return errorResponse('acting_environment_id is required for environment-scoped updates', 400);
      }
      if (!isValidUuid(body.acting_environment_id)) {
        return errorResponse('acting_environment_id must be a valid UUID');
      }

      const envRow = await queryOne<{ id: string }>(
        'SELECT id FROM environments WHERE id = $1 AND workspace_id = $2',
        [body.acting_environment_id, body.workspace_id]
      );
      if (!envRow) return errorResponse('acting_environment_id is invalid for this workspace', 400);

      callerRole = await requireEnvironmentResourcePermission(
        auth,
        body.acting_environment_id,
        'environment',
        'manage_users'
      );
      scopedEnvironmentManager = true;
      actingEnvironmentId = body.acting_environment_id;
    } else {
      try {
        callerRole = await requireWorkspacePermission(auth, body.workspace_id, 'manage_users');
      } catch (err) {
        const insufficientWorkspaceRole = err instanceof Response && err.status === 403;
        if (!insufficientWorkspaceRole) throw err;

        if (auth.authType === 'session' && !auth.user.is_superadmin) {
          const callerMembership = await getWorkspaceMembershipForUpdate(body.workspace_id, auth.user.id);
          if (!callerMembership) {
            throw err;
          }
        }
        if (!body.acting_environment_id) throw err;
        if (!isValidUuid(body.acting_environment_id)) {
          return errorResponse('acting_environment_id must be a valid UUID');
        }

        const envRow = await queryOne<{ id: string }>(
          'SELECT id FROM environments WHERE id = $1 AND workspace_id = $2',
          [body.acting_environment_id, body.workspace_id]
        );
        if (!envRow) return errorResponse('acting_environment_id is invalid for this workspace', 400);

        callerRole = await requireEnvironmentResourcePermission(
          auth,
          body.acting_environment_id,
          'environment',
          'manage_users'
        );
        scopedEnvironmentManager = true;
        actingEnvironmentId = body.acting_environment_id;
      }
    }

    if (body.user_id === auth.user.id) {
      return errorResponse('Cannot change your own access assignment');
    }

    const targetMembership = await getWorkspaceMembershipForUpdate(body.workspace_id, body.user_id);
    if (!targetMembership) return errorResponse('User is not a member of this workspace', 404);

    if (callerRole !== 'owner' && !auth.user.is_superadmin && targetMembership.role === 'owner' && targetMembership.access_scope !== 'scoped') {
      return errorResponse('Only owners can change another owner', 403);
    }
    if (body.scoped_role === 'owner' && callerRole !== 'owner' && !auth.user.is_superadmin) {
      return errorResponse('Only owners can assign scoped owner role', 403);
    }
    const scopedRoleToApply = body.scoped_role ?? targetMembership.role;

    if (scopedEnvironmentManager) {
      if (body.workspace_role) return errorResponse('Environment managers cannot change workspace roles', 403);
      if (body.access_scope !== 'scoped') {
        return errorResponse('Environment-scoped access changes must use scoped mode', 400);
      }
      if (!actingEnvironmentId) {
        return errorResponse('acting_environment_id is required for environment-scoped updates', 400);
      }
      if (targetMembership.access_scope === 'workspace') {
        return errorResponse('Cannot remove or overwrite users inherited from workspace scope', 403);
      }
    }

    const envIds = Array.from(new Set((body.environment_ids ?? []).filter(Boolean)));
    const groupIds = Array.from(new Set((body.group_ids ?? []).filter(Boolean)));
    if (!areValidUuids(envIds)) return errorResponse('environment_ids must contain only valid UUIDs');
    if (!areValidUuids(groupIds)) return errorResponse('group_ids must contain only valid UUIDs');

    if (envIds.length > 0) {
      const envRows = await query<{ id: string }>(
        `SELECT id FROM environments
         WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [body.workspace_id, envIds]
      );
      if (envRows.length !== envIds.length) {
        return errorResponse('One or more environment_ids are invalid for this workspace', 400);
      }
    }

    if (groupIds.length > 0) {
      const groupRows = await query<{ id: string }>(
        `SELECT g.id
         FROM groups g
         JOIN environments e ON e.id = g.environment_id
         WHERE e.workspace_id = $1 AND g.id = ANY($2::uuid[])`,
        [body.workspace_id, groupIds]
      );
      if (groupRows.length !== groupIds.length) {
        return errorResponse('One or more group_ids are invalid for this workspace', 400);
      }
    }

    if (scopedEnvironmentManager) {
      if (!actingEnvironmentId) {
        return errorResponse('acting_environment_id is required for environment-scoped updates', 400);
      }
      if (envIds.some((id) => id !== actingEnvironmentId)) {
        return errorResponse('Environment-scoped updates can only grant/revoke the acting environment', 400);
      }
      if (groupIds.length > 0) {
        const groupRows = await query<{ id: string }>(
          `SELECT g.id
           FROM groups g
           WHERE g.environment_id = $1
             AND g.id = ANY($2::uuid[])`,
          [actingEnvironmentId, groupIds]
        );
        if (groupRows.length !== groupIds.length) {
          return errorResponse('One or more group_ids are outside the acting environment', 400);
        }
      }

      await changeMemberships({ workspaceId: body.workspace_id, auth, callerRole,
        ip: getClientIp(request), changes: [{ userId: body.user_id, operation: 'access', accessScope: 'scoped',
          assignmentRole: body.scoped_role as MembershipRole | undefined, cancelPendingInvites: body.cancel_pending_invites,
          environmentIds: envIds, groupIds, actingEnvironmentId }] });
      return jsonResponse({ message: 'User environment access assignment updated' });
    }

    await changeMemberships({ workspaceId: body.workspace_id, auth, callerRole,
      ip: getClientIp(request), changes: [{ userId: body.user_id, operation: 'access',
        accessScope: body.access_scope, role: body.workspace_role as MembershipRole | undefined, assignmentRole: body.scoped_role as MembershipRole | undefined, cancelPendingInvites: body.cancel_pending_invites,
        environmentIds: envIds, groupIds }] });

    return jsonResponse({ message: 'User access assignment updated' });
  }

  // DELETE /api/workspaces/users/:user_id?workspace_id=...
  if (request.method === 'DELETE' && segments[0]) {
    const targetUserId = segments[0];
    const params = getSearchParams(request);
    const workspaceId = params.get('workspace_id');
    if (!workspaceId) return errorResponse('workspace_id is required');
    if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');
    if (!isValidUuid(targetUserId)) return errorResponse('user_id must be a valid UUID');

    const callerRole = await requireWorkspacePermission(auth, workspaceId, 'manage_users');

    // Cannot remove yourself
    if (targetUserId === auth.user.id) {
      return errorResponse('Cannot remove yourself from the workspace');
    }

    // Non-owner admins cannot remove owners
    if (callerRole !== 'owner' && !auth.user.is_superadmin) {
      const targetMembership = await queryOne<{ role: string; access_scope?: string }>(
        'SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, targetUserId]
      );
      if (targetMembership?.role === 'owner' && targetMembership.access_scope !== 'scoped') {
        return errorResponse('Only owners can remove another owner', 403);
      }
    }

    await changeMemberships({ workspaceId, auth, callerRole, ip: getClientIp(request),
      changes: [{ userId: targetUserId, operation: 'remove', cancelPendingInvites: params.get('cancel_pending_invites') === 'true' }] });

    return jsonResponse({ message: 'User removed from workspace' });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
};

type WorkspaceUserRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  access_scope: 'workspace' | 'scoped';
  joined_at: string;
};

type WorkspaceMembershipRow = {
  role: string;
  access_scope: 'workspace' | 'scoped';
};

type EnvironmentAssignmentRow = {
  user_id: string;
  environment_id: string;
  environment_name: string;
  role: string;
};

type GroupAssignmentRow = {
  user_id: string;
  group_id: string;
  group_name: string;
  role: string;
  environment_id: string;
  environment_name: string;
  parent_group_id: string | null;
};

function roleLevel(role: string | null | undefined): number {
  switch (role) {
    case 'owner': return 100;
    case 'admin': return 75;
    case 'member': return 50;
    case 'viewer': return 25;
    default: return 0;
  }
}

async function getWorkspaceMembershipForUpdate(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMembershipRow | null> {
  try {
    const row = await queryOne<WorkspaceMembershipRow>(
      `SELECT role, access_scope
       FROM workspace_memberships
       WHERE workspace_id = $1
         AND user_id = $2`,
      [workspaceId, userId]
    );
    return row ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('column "access_scope" does not exist')) throw err;
    const legacy = await queryOne<{ role: string; access_scope?: string }>(
      `SELECT role
       FROM workspace_memberships
       WHERE workspace_id = $1
         AND user_id = $2`,
      [workspaceId, userId]
    );
    return legacy ? { role: legacy.role, access_scope: 'workspace' } : null;
  }
}

async function canViewWorkspaceUsersList(userId: string, workspaceId: string, isSuperadmin: boolean): Promise<boolean> {
  if (isSuperadmin) return true;
  const role = await getWorkspaceRole(userId, workspaceId);
  if (roleLevel(role) < roleLevel('admin')) return false;
  const accessScope = await getWorkspaceAccessScope(userId, workspaceId);
  return (accessScope ?? 'workspace') === 'workspace';
}

async function getScopedVisibilityAssignments(userId: string, workspaceId: string): Promise<{ envIds: string[]; groupIds: string[] }> {
  const envRows = await query<{ environment_id: string }>(
    `SELECT em.environment_id
     FROM environment_memberships em
     JOIN environments e ON e.id = em.environment_id
     WHERE em.user_id = $1 AND e.workspace_id = $2`,
    [userId, workspaceId]
  );

  const groupRows = await query<{ group_id: string; environment_id: string }>(
    `SELECT DISTINCT gc.descendant_id AS group_id, g.environment_id
     FROM group_memberships gm
     JOIN group_closures gc ON gc.ancestor_id = gm.group_id
     JOIN groups g ON g.id = gc.descendant_id
     JOIN environments e ON e.id = g.environment_id
     WHERE gm.user_id = $1 AND e.workspace_id = $2`,
    [userId, workspaceId]
  );

  const envIds = new Set(envRows.map((row) => row.environment_id));
  for (const row of groupRows) {
    envIds.add(row.environment_id);
  }

  return {
    envIds: [...envIds],
    groupIds: [...new Set(groupRows.map((row) => row.group_id))],
  };
}

async function listScopedWorkspaceUsers(workspaceId: string, envIds: string[], groupIds: string[]): Promise<WorkspaceUserRow[]> {
  const params = [workspaceId, envIds, groupIds];
  try {
    return await query<WorkspaceUserRow>(
      `SELECT u.id, u.email, u.first_name, u.last_name, wm.role,
              COALESCE(wm.access_scope, 'workspace') as access_scope,
              wm.created_at as joined_at
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
         AND (
           COALESCE(wm.access_scope, 'workspace') = 'workspace'
           OR EXISTS (
             SELECT 1 FROM environment_memberships em
             JOIN environments e ON e.id = em.environment_id
             WHERE em.user_id = wm.user_id
               AND e.workspace_id = $1
               AND em.environment_id = ANY($2::uuid[])
           )
           OR EXISTS (
             SELECT 1 FROM group_memberships gm
             JOIN groups g ON g.id = gm.group_id
             JOIN environments e ON e.id = g.environment_id
             WHERE gm.user_id = wm.user_id
               AND e.workspace_id = $1
               AND gm.group_id = ANY($3::uuid[])
           )
         )
       ORDER BY wm.role, u.email`,
      params
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('column wm.access_scope does not exist')) throw err;
    return query<WorkspaceUserRow>(
      `SELECT u.id, u.email, u.first_name, u.last_name, wm.role,
              'workspace'::text as access_scope,
              wm.created_at as joined_at
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.role, u.email`,
      [workspaceId]
    );
  }
}

function filterEnvironmentAssignments(assignments: EnvironmentAssignmentRow[], envIds: string[]): EnvironmentAssignmentRow[] {
  if (envIds.length === 0) return [];
  const allowed = new Set(envIds);
  return assignments.filter((row) => allowed.has(row.environment_id));
}

function filterGroupAssignments(assignments: GroupAssignmentRow[], groupIds: string[]): GroupAssignmentRow[] {
  if (groupIds.length === 0) return [];
  const allowed = new Set(groupIds);
  return assignments.filter((row) => allowed.has(row.group_id));
}

async function hasScopedInviteCapability(userId: string, workspaceId: string): Promise<boolean> {
  const envGrant = await queryOne<{ role: string; access_scope?: string }>(
    `SELECT em.role
     FROM environment_memberships em
     JOIN environments e ON e.id = em.environment_id
     WHERE em.user_id = $1
       AND e.workspace_id = $2
       AND em.role IN ('owner', 'admin')
     LIMIT 1`,
    [userId, workspaceId]
  );
  if (envGrant) return true;

  const groupGrant = await queryOne<{ role: string; access_scope?: string }>(
    `SELECT gm.role
     FROM group_memberships gm
     JOIN groups g ON g.id = gm.group_id
     JOIN environments e ON e.id = g.environment_id
     WHERE gm.user_id = $1
       AND e.workspace_id = $2
       AND gm.role IN ('owner', 'admin')
     LIMIT 1`,
    [userId, workspaceId]
  );
  return !!groupGrant;
}

async function listWorkspaceUsers(workspaceId: string, userId?: string | null): Promise<WorkspaceUserRow[]> {
  if (userId === null) return [];
  const params = userId ? [workspaceId, userId] : [workspaceId];
  const userFilter = userId ? 'AND wm.user_id = $2' : '';
  try {
    return await query<WorkspaceUserRow>(
      `SELECT u.id, u.email, u.first_name, u.last_name, wm.role,
              COALESCE(wm.access_scope, 'workspace') as access_scope,
              wm.created_at as joined_at
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ${userFilter}
       ORDER BY wm.role, u.email`,
      params
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('column wm.access_scope does not exist')) throw err;
    return query<WorkspaceUserRow>(
      `SELECT u.id, u.email, u.first_name, u.last_name, wm.role,
              'workspace'::text as access_scope,
              wm.created_at as joined_at
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ${userFilter}
       ORDER BY wm.role, u.email`,
      params
    );
  }
}

async function listEnvironmentAssignments(workspaceId: string, userId?: string | null): Promise<EnvironmentAssignmentRow[]> {
  if (userId === null) return [];
  const params = userId ? [workspaceId, userId] : [workspaceId];
  const userFilter = userId ? 'AND em.user_id = $2' : '';
  return query<EnvironmentAssignmentRow>(
    `SELECT em.user_id, em.environment_id, e.name as environment_name, em.role
     FROM environment_memberships em
     JOIN environments e ON e.id = em.environment_id
     WHERE e.workspace_id = $1
     ${userFilter}
     ORDER BY e.name`,
    params
  );
}

async function listGroupAssignments(workspaceId: string, userId?: string | null): Promise<GroupAssignmentRow[]> {
  if (userId === null) return [];
  const params = userId ? [workspaceId, userId] : [workspaceId];
  const userFilter = userId ? 'AND gm.user_id = $2' : '';
  return query<GroupAssignmentRow>(
    `SELECT gm.user_id, gm.group_id, gm.role,
            g.name as group_name, g.environment_id, g.parent_group_id,
            e.name as environment_name
     FROM group_memberships gm
     JOIN groups g ON g.id = gm.group_id
     JOIN environments e ON e.id = g.environment_id
     WHERE e.workspace_id = $1
     ${userFilter}
     ORDER BY e.name, g.name`,
    params
  );
}

function mapWorkspaceUsers(
  users: WorkspaceUserRow[],
  envAssignments: EnvironmentAssignmentRow[],
  groupAssignments: GroupAssignmentRow[]
) {
  const envByUser = new Map<string, EnvironmentAssignmentRow[]>();
  for (const row of envAssignments) {
    const list = envByUser.get(row.user_id) ?? [];
    list.push(row);
    envByUser.set(row.user_id, list);
  }

  const groupsByUser = new Map<string, GroupAssignmentRow[]>();
  for (const row of groupAssignments) {
    const list = groupsByUser.get(row.user_id) ?? [];
    list.push(row);
    groupsByUser.set(row.user_id, list);
  }

  return users.map((u) => ({
    ...u,
    environment_assignments: (envByUser.get(u.id) ?? []).map((a) => ({
      environment_id: a.environment_id,
      environment_name: a.environment_name,
      role: a.role,
    })),
    group_assignments: (groupsByUser.get(u.id) ?? []).map((a) => ({
      group_id: a.group_id,
      group_name: a.group_name,
      role: a.role,
      environment_id: a.environment_id,
      environment_name: a.environment_name,
      parent_group_id: a.parent_group_id,
    })),
  }));
}
