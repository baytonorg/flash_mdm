import type { PoolClient } from 'pg';
import { transaction } from './db.js';
import { logAudit } from './audit.js';
import type { AuthContext } from './auth.js';
import { errorResponse } from './helpers.js';
import { mergePermissionMatrixWithDefaults } from './rbac-matrix.js';
import { workspaceRoleMeetsMinimum } from './rbac.js';

export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MembershipChange = {
  userId: string;
  operation: 'remove' | 'role' | 'access';
  role?: MembershipRole;
  assignmentRole?: MembershipRole;
  accessScope?: 'workspace' | 'scoped';
  environmentIds?: string[];
  groupIds?: string[];
  actingEnvironmentId?: string;
  cancelPendingInvites?: boolean;
};

// All ownership writers, including invite acceptance and account offboarding,
// take workspace locks in ascending ID order. Never call pooled queries while
// holding these locks: use this transaction's client throughout.
export async function lockMembershipWorkspaces(client: PoolClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    const result = await client.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [id]);
    if (!result.rows.length) throw errorResponse('Workspace no longer exists', 409);
  }
}

export async function requireSurvivingWorkspaceOwner(client: PoolClient, workspaceId: string) {
  const result = await client.query(
    `SELECT 1 FROM workspace_memberships
     WHERE workspace_id = $1 AND role = 'owner' AND access_scope = 'workspace' LIMIT 1`, [workspaceId]);
  if (!result.rows.length) throw errorResponse('A surviving workspace needs a workspace-wide owner. Establish another owner first.', 409);
}

export async function requireScopeManagementPaths(client: PoolClient, workspaceId: string) {
  const workspace = (await client.query('SELECT settings FROM workspaces WHERE id = $1', [workspaceId])).rows[0];
  const environments = await client.query('SELECT id, name, enterprise_features FROM environments WHERE workspace_id = $1', [workspaceId]);
  for (const environment of environments.rows) {
    const matrix = mergePermissionMatrixWithDefaults(environment.enterprise_features?.rbac?.permission_matrix ?? workspace?.settings?.rbac?.permission_matrix);
    const roles = await client.query(`SELECT COALESCE(em.role, CASE WHEN wm.access_scope = 'workspace' THEN wm.role END) AS role
      FROM workspace_memberships wm LEFT JOIN environment_memberships em ON em.user_id = wm.user_id AND em.environment_id = $2 WHERE wm.workspace_id = $1`, [workspaceId, environment.id]);
    if (!roles.rows.some(r => r.role && workspaceRoleMeetsMinimum(r.role, matrix.environment.manage_users))) throw errorResponse(`Keep an authorised management path for environment ${environment.name} before removing access.`, 409);
    const groups = await client.query(`SELECT g.id, g.name, wm.user_id,
      COALESCE(direct.role, em.role, CASE WHEN wm.access_scope = 'workspace' THEN wm.role END) AS role
      FROM groups g CROSS JOIN workspace_memberships wm
      LEFT JOIN environment_memberships em ON em.environment_id = g.environment_id AND em.user_id = wm.user_id
      LEFT JOIN LATERAL (SELECT gm.role FROM group_memberships gm JOIN group_closures gc ON gc.ancestor_id = gm.group_id
        WHERE gc.descendant_id = g.id AND gm.user_id = wm.user_id ORDER BY gc.depth LIMIT 1) direct ON true
      WHERE g.environment_id = $2 AND wm.workspace_id = $1`, [workspaceId, environment.id]);
    const byGroup = new Map<string, { name: string; manageable: boolean }>();
    for (const row of groups.rows) {
      const prior = byGroup.get(row.id);
      byGroup.set(row.id, { name: row.name, manageable: !!prior?.manageable || !!row.role && workspaceRoleMeetsMinimum(row.role, matrix.group.manage_users) });
    }
    for (const group of byGroup.values()) if (!group.manageable) throw errorResponse(`Keep an authorised management path for group ${group.name} before removing access.`, 409);
  }
}

export async function removeWorkspaceGrants(client: PoolClient, workspaceId: string, userId: string) {
  await client.query(`DELETE FROM group_memberships WHERE user_id = $1 AND group_id IN (
    SELECT g.id FROM groups g JOIN environments e ON e.id = g.environment_id WHERE e.workspace_id = $2)`, [userId, workspaceId]);
  await client.query(`DELETE FROM environment_memberships WHERE user_id = $1 AND environment_id IN (
    SELECT id FROM environments WHERE workspace_id = $2)`, [userId, workspaceId]);
  await client.query('DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  await client.query(`UPDATE users u SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"needs_environment_setup":false}'::jsonb
    WHERE u.id = $2 AND COALESCE(metadata->>'environment_setup_workspace_id', (
      SELECT a.workspace_id::text FROM audit_log a WHERE a.user_id = u.id AND a.action = 'auth.register.signup_link'
        AND a.details->>'allow_environment_creation' = 'true' ORDER BY a.created_at DESC LIMIT 1)) = $1::uuid::text`, [workspaceId, userId]);
}

export async function reconcileMembershipSessions(client: PoolClient, workspaceId: string, userId: string) {
  // Keep login and unrelated workspaces. Clear selections rather than treating
  // session context as an authorisation grant.
  await client.query(`UPDATE sessions SET workspace_id = NULL, environment_id = NULL, active_group_id = NULL
    WHERE user_id = $1 AND workspace_id = $2 AND NOT EXISTS (
      SELECT 1 FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2)`, [userId, workspaceId]);
  await client.query(`UPDATE sessions s SET environment_id = NULL, active_group_id = NULL
    WHERE s.user_id = $1 AND s.workspace_id = $2 AND s.environment_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = $2 AND wm.user_id = $1 AND wm.access_scope = 'workspace')
      AND NOT EXISTS (SELECT 1 FROM environment_memberships em WHERE em.environment_id = s.environment_id AND em.user_id = $1)
      AND NOT EXISTS (SELECT 1 FROM group_memberships gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = $1 AND g.environment_id = s.environment_id)`, [userId, workspaceId]);
  await client.query(`UPDATE sessions s SET active_group_id = NULL
    WHERE s.user_id = $1 AND s.workspace_id = $2 AND s.active_group_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = $2 AND wm.user_id = $1 AND wm.access_scope = 'workspace')
      AND NOT EXISTS (SELECT 1 FROM environment_memberships em WHERE em.environment_id = s.environment_id AND em.user_id = $1)
      AND NOT EXISTS (SELECT 1 FROM group_memberships gm JOIN group_closures gc ON gc.ancestor_id = gm.group_id WHERE gm.user_id = $1 AND gc.descendant_id = s.active_group_id)`, [userId, workspaceId]);
}

// Removing a low direct grant can reveal a higher inherited one. Compare the
// resulting access at each scope, including descendants of assigned groups.
async function higherScopeRoles(client: PoolClient, workspaceId: string, userId: string, callerRole: string) {
  const { rows } = await client.query<{ scope: string; role: MembershipRole }>(`
    WITH env_roles AS (
      SELECT e.id, COALESCE(em.role, CASE WHEN wm.access_scope = 'workspace' THEN wm.role END) AS role
      FROM environments e JOIN workspace_memberships wm ON wm.workspace_id = e.workspace_id AND wm.user_id = $2
      LEFT JOIN environment_memberships em ON em.environment_id = e.id AND em.user_id = wm.user_id
      WHERE e.workspace_id = $1
    )
    SELECT 'environment/' || id AS scope, role FROM env_roles
    UNION ALL
    SELECT 'group/' || g.id, COALESCE(grant_role.role, e.role) FROM groups g JOIN env_roles e ON e.id = g.environment_id
    LEFT JOIN LATERAL (
      SELECT gm.role FROM group_closures gc JOIN group_memberships gm ON gm.group_id = gc.ancestor_id
      WHERE gc.descendant_id = g.id AND gm.user_id = $2 ORDER BY gc.depth LIMIT 1
    ) grant_role ON true`, [workspaceId, userId]);
  return new Map(rows.filter(r => r.role && !workspaceRoleMeetsMinimum(callerRole, r.role)).map(r => [r.scope, r.role]));
}

export async function changeMemberships(input: {
  workspaceId: string;
  auth: AuthContext;
  callerRole: string;
  changes: MembershipChange[];
  ip: string;
  selfService?: boolean;
  requireCurrentWorkspaceOwner?: boolean;
}) {
  return transaction(async (client) => {
    const { workspaceId, auth, callerRole } = input;
    await lockMembershipWorkspaces(client, [workspaceId]);
    const actorUser = auth.authType === 'session'
      ? (await client.query('SELECT is_superadmin FROM users WHERE id = $1 FOR SHARE', [auth.user.id])).rows[0]
      : null;
    if (auth.authType === 'session' && !actorUser) throw errorResponse('The signed-in account no longer exists', 403);
    const isSuperadmin = actorUser?.is_superadmin === true;
    if (input.requireCurrentWorkspaceOwner) {
      const owner = (await client.query("SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND role = 'owner' AND access_scope = 'workspace'", [workspaceId, auth.user.id])).rows[0];
      if (!owner) throw errorResponse('Your workspace ownership changed. Refresh before transferring.', 409);
    }
    const workspace = await client.query('SELECT settings FROM workspaces WHERE id = $1', [workspaceId]);
    const matrix = mergePermissionMatrixWithDefaults(workspace.rows[0]?.settings?.rbac?.permission_matrix);
    if (auth.authType === 'api_key') {
      const key = (await client.query(`SELECT role, scope_type, workspace_id FROM api_keys WHERE id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE`, [auth.apiKey.id])).rows[0];
      if (!key || key.scope_type !== 'workspace' || key.workspace_id !== workspaceId || key.role !== callerRole || !workspaceRoleMeetsMinimum(key.role, matrix.workspace.manage_users)) throw errorResponse('API-key access changed or is outside this workspace', 403);
    }
    // Revalidate the actor under the same ownership lock as the writes.
    if (auth.authType !== 'api_key' && !isSuperadmin) {
      const actor = await client.query('SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, auth.user.id]);
      let effectiveRole = actor.rows[0]?.role;
      const actingEnvironment = input.changes[0]?.actingEnvironmentId;
      if (actingEnvironment) {
        const grant = (await client.query('SELECT role FROM environment_memberships WHERE environment_id = $1 AND user_id = $2', [actingEnvironment, auth.user.id])).rows[0];
        effectiveRole = grant?.role ?? (actor.rows[0]?.access_scope === 'workspace' ? actor.rows[0]?.role : null);
        const environment = (await client.query('SELECT enterprise_features FROM environments WHERE id = $1 AND workspace_id = $2', [actingEnvironment, workspaceId])).rows[0];
        const scopedMatrix = mergePermissionMatrixWithDefaults(environment?.enterprise_features?.rbac?.permission_matrix ?? workspace.rows[0]?.settings?.rbac?.permission_matrix);
        if (!environment || !effectiveRole || !workspaceRoleMeetsMinimum(effectiveRole, scopedMatrix.environment.manage_users)) throw errorResponse('Environment management access changed', 403);
      }
      if (!actor.rows[0] || effectiveRole !== callerRole || (!input.changes.every(c => c.actingEnvironmentId) && actor.rows[0].access_scope !== 'workspace' && !input.selfService) || (!actingEnvironment && !input.selfService && !workspaceRoleMeetsMinimum(effectiveRole, matrix.workspace.manage_users))) {
        throw errorResponse('Access changed. Refresh and try again.', 403);
      }
    }
    // A bulk operation is one final state. Never arbitrarily choose an owner
    // to retain based on iteration order.
    for (const change of input.changes) {
      const target = await client.query('SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, change.userId]);
      if (!target.rows[0]) throw errorResponse('User is not a member of this workspace', 404);
      if (change.userId === auth.user.id && !input.selfService) throw errorResponse('Use the explicit leave or self-demotion action', 400);
      if (callerRole !== 'owner' && !isSuperadmin && ((target.rows[0].role === 'owner' && target.rows[0].access_scope === 'workspace') || change.role === 'owner' || change.assignmentRole === 'owner')) throw errorResponse('Only owners can modify owner grants', 403);
      if (!isSuperadmin && [change.role, change.assignmentRole].some(role => role && !workspaceRoleMeetsMinimum(callerRole, role))) throw errorResponse('Cannot grant a role higher than your own', 403);
      const finalRole = change.role ?? target.rows[0].role;
      const expandsWorkspace = change.accessScope === 'workspace' && target.rows[0].access_scope !== 'workspace';
      if (expandsWorkspace && !isSuperadmin && !workspaceRoleMeetsMinimum(callerRole, finalRole)) {
        throw errorResponse('Cannot expand a higher role to the whole workspace', 403);
      }
      if (change.actingEnvironmentId && target.rows[0].access_scope === 'workspace') throw errorResponse('Workspace-inherited access requires a workspace-level change', 403);
      const checkInheritance = !isSuperadmin && callerRole !== 'owner' && change.operation === 'access';
      const priorHigher = checkInheritance ? await higherScopeRoles(client, workspaceId, change.userId, callerRole) : null;
      if (change.operation === 'remove') {
        const offers = await client.query(`SELECT i.id FROM user_invites i JOIN users u ON lower(u.email) = lower(i.email)
          WHERE u.id = $1 AND i.workspace_id = $2 AND i.status = 'pending' AND i.expires_at > clock_timestamp() FOR UPDATE OF i`, [change.userId, workspaceId]);
        if (offers.rows.length && !change.cancelPendingInvites) throw errorResponse('Pending invitations could restore access. Explicitly confirm cancellation before removing this member.', 409);
        if (change.cancelPendingInvites) await client.query(`UPDATE user_invites SET status = 'cancelled' WHERE workspace_id = $1 AND lower(email) = (SELECT lower(email) FROM users WHERE id = $2) AND status = 'pending'`, [workspaceId, change.userId]);
        await removeWorkspaceGrants(client, workspaceId, change.userId);
      } else {
        if (change.role && !change.actingEnvironmentId) await client.query('UPDATE workspace_memberships SET role = $1 WHERE workspace_id = $2 AND user_id = $3', [change.role, workspaceId, change.userId]);
        if (change.operation === 'role' && change.accessScope) await client.query('UPDATE workspace_memberships SET access_scope = $1 WHERE workspace_id = $2 AND user_id = $3', [change.accessScope, workspaceId, change.userId]);
        if (change.operation === 'access') {
          const envIds = [...new Set(change.environmentIds ?? [])];
          const groupIds = [...new Set(change.groupIds ?? [])];
          const priorEnvironments = await client.query('SELECT environment_id, role FROM environment_memberships WHERE user_id = $1', [change.userId]);
          const priorGroups = await client.query('SELECT group_id, role FROM group_memberships WHERE user_id = $1', [change.userId]);
          // Existing direct roles can survive an edit unchanged. A new grant must
          // satisfy the actor's ceiling even when its role comes from a default.
          const addsGrant = envIds.some(id => !priorEnvironments.rows.some(row => row.environment_id === id))
            || groupIds.some(id => !priorGroups.rows.some(row => row.group_id === id));
          if (addsGrant && !isSuperadmin && !workspaceRoleMeetsMinimum(callerRole, change.assignmentRole ?? finalRole)) {
            throw errorResponse('Cannot create a scope grant higher than your own role', 403);
          }
          const removedEnvironments = priorEnvironments.rows.filter(r => !envIds.includes(r.environment_id) && (!change.actingEnvironmentId || r.environment_id === change.actingEnvironmentId)).map(r => r.environment_id);
          const affectedGroups = await client.query(`SELECT g.id FROM groups g JOIN environments e ON e.id = g.environment_id WHERE e.workspace_id = $1 AND ($2::uuid IS NULL OR g.environment_id = $2)`, [workspaceId, change.actingEnvironmentId ?? null]);
          const removedGroups = priorGroups.rows.filter(r => !groupIds.includes(r.group_id) && affectedGroups.rows.some(g => g.id === r.group_id)).map(r => r.group_id);
          const offers = await client.query(`SELECT i.* FROM user_invites i JOIN users u ON lower(u.email) = lower(i.email)
            WHERE u.id = $1 AND i.workspace_id = $2 AND i.status = 'pending' AND i.expires_at > clock_timestamp()
              AND (i.environment_ids ?| $3::text[] OR i.group_ids ?| $4::text[] OR (i.environment_ids IS NULL AND i.environment_id = ANY($5::uuid[])) OR (i.group_ids IS NULL AND i.group_id = ANY($6::uuid[]))) FOR UPDATE OF i`, [change.userId, workspaceId, removedEnvironments, removedGroups, removedEnvironments, removedGroups]);
          if (offers.rows.length && !change.cancelPendingInvites) throw errorResponse('Pending invitations could restore removed scope access. Explicitly confirm cancellation before saving.', 409);
          if (change.actingEnvironmentId) {
            const allowedGroups = new Set(affectedGroups.rows.map(g => g.id));
            for (const offer of offers.rows) {
              const offeredEnvironments: string[] = (typeof offer.environment_ids === 'string' ? JSON.parse(offer.environment_ids) : offer.environment_ids) ?? (offer.environment_id ? [offer.environment_id] : []);
              const offeredGroups: string[] = (typeof offer.group_ids === 'string' ? JSON.parse(offer.group_ids) : offer.group_ids) ?? (offer.group_id ? [offer.group_id] : []);
              if (offeredEnvironments.some(id => id !== change.actingEnvironmentId) || offeredGroups.some(id => !allowedGroups.has(id))) throw errorResponse('An affected invitation spans other scopes. A workspace manager must resolve that offer before this removal.', 409);
            }
          }
          if (offers.rows.length) await client.query("UPDATE user_invites SET status = 'cancelled' WHERE id = ANY($1::uuid[])", [offers.rows.map(o => o.id)]);
          const envs = await client.query('SELECT id FROM environments WHERE workspace_id = $1 AND id = ANY($2::uuid[]) FOR KEY SHARE', [workspaceId, envIds]);
          const groups = await client.query(`SELECT g.id FROM groups g JOIN environments e ON e.id = g.environment_id WHERE e.workspace_id = $1 AND g.id = ANY($2::uuid[]) FOR KEY SHARE OF g, e`, [workspaceId, groupIds]);
          if (envs.rows.length !== envIds.length || groups.rows.length !== groupIds.length) throw errorResponse('Assignment scope changed or belongs to another workspace', 409);
          if (change.actingEnvironmentId) {
            if (envIds.some(id => id !== change.actingEnvironmentId)) throw errorResponse('Assignment is outside the acting environment', 403);
            const scopedGroups = await client.query('SELECT id FROM groups WHERE id = ANY($1::uuid[]) AND environment_id = $2', [groupIds, change.actingEnvironmentId]);
            if (scopedGroups.rows.length !== groupIds.length) throw errorResponse('Assignment is outside the acting environment', 403);
          }
          if (!change.actingEnvironmentId) await client.query('UPDATE workspace_memberships SET access_scope = $1 WHERE workspace_id = $2 AND user_id = $3', [change.accessScope, workspaceId, change.userId]);
          await client.query(`DELETE FROM environment_memberships WHERE user_id = $1 AND environment_id IN (SELECT id FROM environments WHERE workspace_id = $2 AND ($3::uuid IS NULL OR id = $3))`, [change.userId, workspaceId, change.actingEnvironmentId ?? null]);
          await client.query(`DELETE FROM group_memberships WHERE user_id = $1 AND group_id IN (SELECT g.id FROM groups g JOIN environments e ON e.id = g.environment_id WHERE e.workspace_id = $2 AND ($3::uuid IS NULL OR e.id = $3))`, [change.userId, workspaceId, change.actingEnvironmentId ?? null]);
          for (const id of envIds) await client.query('INSERT INTO environment_memberships (environment_id, user_id, role) VALUES ($1, $2, $3)', [id, change.userId, change.assignmentRole ?? priorEnvironments.rows.find(r => r.environment_id === id)?.role ?? change.role ?? target.rows[0].role]);
          for (const id of groupIds) await client.query('INSERT INTO group_memberships (group_id, user_id, role) VALUES ($1, $2, $3)', [id, change.userId, change.assignmentRole ?? priorGroups.rows.find(r => r.group_id === id)?.role ?? change.role ?? target.rows[0].role]);
        }
      }
      if (priorHigher) {
        for (const [scope, role] of await higherScopeRoles(client, workspaceId, change.userId, callerRole)) {
          const prior = priorHigher.get(scope);
          if (!prior || !workspaceRoleMeetsMinimum(prior, role)) throw errorResponse('This change would reveal a higher inherited role', 403);
        }
      }
      await reconcileMembershipSessions(client, workspaceId, change.userId);
      await logAudit({ workspace_id: workspaceId, user_id: auth.user.id, actor_type: auth.authType === 'api_key' ? 'api_key' : 'user', api_key_id: auth.authType === 'api_key' ? auth.apiKey.id : null, action: `workspace.user_${change.operation === 'remove' ? 'removed' : change.operation === 'role' ? 'role_changed' : 'access_updated'}`, resource_type: 'workspace_membership', resource_id: change.userId,
        details: { operation: change.operation, old_role: target.rows[0].role, new_role: change.role ?? null, access_scope: change.accessScope ?? null, environment_ids: change.environmentIds ?? [], group_ids: change.groupIds ?? [], cancelled_pending_invites: change.cancelPendingInvites === true, preserved_independent_keys: true }, ip_address: input.ip }, client);
    }
    await requireSurvivingWorkspaceOwner(client, workspaceId);
    await requireScopeManagementPaths(client, workspaceId);
  }).catch(error => {
    if (error?.constraint === 'workspace_surviving_owner') throw errorResponse('A surviving workspace needs a workspace-wide owner. Establish another owner first.', 409);
    throw error;
  });
}
