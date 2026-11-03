import type { PoolClient } from 'pg';
import { lockMembershipWorkspaces } from './membership-lifecycle.js';
import { errorResponse } from './helpers.js';
import { mergePermissionMatrixWithDefaults } from './rbac-matrix.js';
import { workspaceRoleMeetsMinimum } from './rbac.js';

function ids(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? [...new Set(parsed.filter((v): v is string => typeof v === 'string'))] : [];
}

export async function applyInviteOffer(client: PoolClient, tokenHash: string, userId: string, email: string) {
  const hint = await client.query('SELECT workspace_id FROM user_invites WHERE token_hash = $1', [tokenHash]);
  if (hint.rows[0]?.workspace_id) await lockMembershipWorkspaces(client, [hint.rows[0].workspace_id]);
  const result = await client.query('SELECT * FROM user_invites WHERE token_hash = $1 FOR UPDATE', [tokenHash]);
  const invite = result.rows[0];
  if (!invite) throw errorResponse('Invalid invite link', 404);
  if (invite.email.toLowerCase() !== email.toLowerCase()) throw errorResponse('Invite email does not match the signed-in account', 403);
  if (invite.status === 'accepted') return { id: invite.id, alreadyAccepted: true };
  if (invite.status !== 'pending' || new Date(invite.expires_at).getTime() <= Date.now()) throw errorResponse('This invite is no longer available', 409);
  const user = await client.query('SELECT id FROM users WHERE id = $1 AND lower(email) = lower($2) FOR KEY SHARE', [userId, email]);
  if (!user.rows.length) throw errorResponse('The signed-in account no longer exists', 409);
  const metadata = typeof invite.permissions === 'string' ? JSON.parse(invite.permissions) : invite.permissions;
  if (!invite.workspace_id) {
    const issuer = await client.query('SELECT is_superadmin FROM users WHERE id = $1 FOR SHARE', [invite.invited_by]);
    if (metadata?.invite_type !== 'platform_access' || !issuer.rows[0]?.is_superadmin) throw errorResponse('The invite issuer no longer has authority to grant this access', 409);
  } else {
    const workspaceId = invite.workspace_id;
    const envIds = ids(invite.environment_ids ?? (invite.environment_id ? [invite.environment_id] : []));
    const groupIds = ids(invite.group_ids ?? (invite.group_id ? [invite.group_id] : []));
    const envs = await client.query('SELECT id FROM environments WHERE workspace_id = $1 AND id = ANY($2::uuid[]) FOR KEY SHARE', [workspaceId, envIds]);
    const groups = await client.query(`SELECT g.id FROM groups g JOIN environments e ON e.id = g.environment_id WHERE e.workspace_id = $1 AND g.id = ANY($2::uuid[]) FOR KEY SHARE OF g, e`, [workspaceId, groupIds]);
    if (envs.rows.length !== envIds.length || groups.rows.length !== groupIds.length) throw errorResponse('An invited scope no longer exists in this workspace', 409);
    const issuer = await client.query(`SELECT u.is_superadmin, wm.role, wm.access_scope FROM users u
      LEFT JOIN workspace_memberships wm ON wm.user_id = u.id AND wm.workspace_id = $2 WHERE u.id = $1`, [invite.invited_by, workspaceId]);
    const key = metadata?.issuer_api_key_id ? (await client.query(`SELECT * FROM api_keys WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE`, [metadata.issuer_api_key_id, workspaceId])).rows[0] : null;
    if (metadata?.issuer_api_key_id && !key) throw errorResponse('The invite issuer key is no longer authorised', 409);
    const workspace = await client.query('SELECT settings FROM workspaces WHERE id = $1', [workspaceId]);
    const matrix = mergePermissionMatrixWithDefaults(workspace.rows[0]?.settings?.rbac?.permission_matrix);
    const scoped = envIds.length > 0 || groupIds.length > 0;
    async function effectiveRole(actorId: string, kind: 'environment' | 'group', id: string): Promise<string | null> {
      if (kind === 'group') {
        const direct = await client.query(`SELECT gm.role FROM group_memberships gm JOIN group_closures gc ON gc.ancestor_id = gm.group_id WHERE gc.descendant_id = $1 AND gm.user_id = $2 ORDER BY gc.depth LIMIT 1`, [id, actorId]);
        if (direct.rows[0]) return direct.rows[0].role;
        const parent = await client.query('SELECT environment_id FROM groups WHERE id = $1', [id]);
        return effectiveRole(actorId, 'environment', parent.rows[0]?.environment_id);
      }
      const direct = await client.query('SELECT role FROM environment_memberships WHERE environment_id = $1 AND user_id = $2', [id, actorId]);
      if (direct.rows[0]) return direct.rows[0].role;
      const member = await client.query('SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, actorId]);
      return member.rows[0]?.access_scope === 'workspace' ? member.rows[0].role : null;
    }
    async function authorise(kind?: 'environment' | 'group', id?: string) {
      if (!key && issuer.rows[0]?.is_superadmin) return;
      let role: string | null = null;
      if (key) {
        if (!kind) role = key.scope_type === 'workspace' ? key.role : null;
        else if (key.scope_type === 'workspace') role = key.role;
        else {
          const env = kind === 'environment' ? id : (await client.query('SELECT environment_id FROM groups WHERE id = $1', [id])).rows[0]?.environment_id;
          if (env === key.environment_id) role = key.role;
        }
      } else if (kind && invite.invited_by && issuer.rows[0]?.role) role = await effectiveRole(invite.invited_by, kind, id!);
      else if (issuer.rows[0]?.access_scope === 'workspace') role = issuer.rows[0].role;
      let effectiveMatrix = matrix;
      if (kind) {
        const environmentId = kind === 'environment' ? id : (await client.query('SELECT environment_id FROM groups WHERE id = $1', [id])).rows[0]?.environment_id;
        const features = (await client.query('SELECT enterprise_features FROM environments WHERE id = $1', [environmentId])).rows[0]?.enterprise_features;
        if (features?.rbac?.permission_matrix) effectiveMatrix = mergePermissionMatrixWithDefaults(features.rbac.permission_matrix);
      }
      const minimum = kind ? effectiveMatrix[kind]?.manage_users ?? 'admin' : matrix.invite?.write ?? 'admin';
      if (!role || !workspaceRoleMeetsMinimum(role, minimum) || !workspaceRoleMeetsMinimum(role, invite.role)) throw errorResponse('The invite issuer no longer has authority to grant this access', 409);
    }
    if (!scoped) await authorise();
    for (const id of envIds) await authorise('environment', id);
    for (const id of groupIds) await authorise('group', id);
    const member = (await client.query('SELECT role, access_scope FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId])).rows[0];
    if (!member) await client.query(`INSERT INTO workspace_memberships (workspace_id, user_id, role, access_scope) VALUES ($1, $2, $3, $4)`, [workspaceId, userId, invite.role, scoped ? 'scoped' : 'workspace']);
    else if (!scoped && (member.role !== invite.role || member.access_scope !== 'workspace')) throw errorResponse('Existing workspace access differs from this offer. Ask a manager to review the explicit change.', 409);
    for (const [kind, targets] of [['environment', envIds], ['group', groupIds]] as const) {
      for (const id of targets) {
        const direct = (await client.query(`SELECT role FROM ${kind}_memberships WHERE ${kind}_id = $1 AND user_id = $2`, [id, userId])).rows[0];
        if (direct && direct.role !== invite.role) throw errorResponse('An existing direct grant differs from this offer. Ask a manager to review the explicit change.', 409);
        if (direct) continue;
        const inherited = await effectiveRole(userId, kind, id);
        if (inherited && workspaceRoleMeetsMinimum(inherited, invite.role)) continue;
        await client.query(`INSERT INTO ${kind}_memberships (${kind}_id, user_id, role) VALUES ($1, $2, $3)`, [id, userId, invite.role]);
      }
    }
  }
  await client.query("UPDATE user_invites SET status = 'accepted', accepted_at = now() WHERE id = $1", [invite.id]);
  return { id: invite.id, alreadyAccepted: false };
}
