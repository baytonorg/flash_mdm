import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth, validateSession } from './_lib/auth.js';
import {
  getEnvironmentRoleForAuth,
  getGroupRoleForAuth,
  getWorkspaceAccessScopeForAuth,
  requireWorkspaceResourcePermission,
} from './_lib/rbac.js';
import { generateToken, hashToken } from './_lib/crypto.js';
import { logAudit } from './_lib/audit.js';
import { sendEmail, inviteEmail } from './_lib/resend.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp } from './_lib/helpers.js';

const INVITE_EXPIRY_DAYS = 7;
export type InviteType = 'workspace_access' | 'platform_access';
const ROLE_LEVEL: Record<string, number> = {
  owner: 100,
  admin: 75,
  member: 50,
  viewer: 25,
};

export default async (request: Request, context: Context) => {
  try {
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/', '').split('/').filter(Boolean);

    // POST /api/workspaces/invite — create and send invite
    if (request.method === 'POST' && segments[0] === 'workspaces' && segments[1] === 'invite') {
      const auth = await requireAuth(request);
      const body = await parseJsonBody<{
        workspace_id?: string;
        email: string;
        role?: string;
        invite_type?: InviteType;
        environment_ids?: string[];
        group_ids?: string[];
      }>(request);
      if (!body.email) return errorResponse('email is required');

      const inviteType: InviteType = body.invite_type === 'platform_access' ? 'platform_access' : 'workspace_access';
      const normalizedRole = (body.role ?? (inviteType === 'platform_access' ? 'owner' : '')).trim();
      if (inviteType === 'workspace_access' && !body.workspace_id) {
        return errorResponse('workspace_id is required for workspace invites');
      }
      if (inviteType === 'platform_access' && body.workspace_id) {
        return errorResponse('Platform invites must not target an existing workspace. Use a workspace team invite instead.', 400);
      }
      if (!normalizedRole) {
        return errorResponse('role is required');
      }

      const validRoles = ['owner', 'admin', 'member', 'viewer'];
      if (!validRoles.includes(normalizedRole)) {
        return errorResponse(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
      }

      const environmentIds = uniqueStrings(body.environment_ids);
      const groupIds = uniqueStrings(body.group_ids);
      const inviteScope = environmentIds.length > 0 || groupIds.length > 0 ? 'scoped' : 'workspace';
      const workspaceId = body.workspace_id ?? null;

      if (inviteType === 'platform_access' && !auth.user.is_superadmin) {
        return errorResponse('Only superadmins can send platform invites', 403);
      }

      if (inviteType === 'platform_access' && inviteScope === 'scoped') {
        return errorResponse('Platform invites must be workspace-wide', 400);
      }

      const callerRole = inviteType === 'platform_access'
        ? 'owner'
        : await authorizeScopedInvite({
            auth,
            workspaceId: body.workspace_id as string,
            targetRole: normalizedRole,
            environmentIds,
            groupIds,
          });

      // Check if user is already a member
      if (workspaceId) {
        const existingMember = await queryOne(
          `SELECT wm.user_id FROM workspace_memberships wm
           JOIN users u ON u.id = wm.user_id
           WHERE wm.workspace_id = $1 AND u.email = $2`,
          [workspaceId, body.email.toLowerCase()]
        );
        if (existingMember) {
          return errorResponse('User is already a member of this workspace');
        }
      }

      // Check for existing pending invite
      const existingInvite = workspaceId
        ? await queryOne<{ id: string }>(
            `SELECT id FROM user_invites
             WHERE workspace_id = $1 AND email = $2 AND status = 'pending' AND expires_at > now()`,
            [workspaceId, body.email.toLowerCase()]
          )
        : await queryOne<{ id: string }>(
            `SELECT id FROM user_invites
             WHERE workspace_id IS NULL AND email = $1 AND status = 'pending' AND expires_at > now()`,
            [body.email.toLowerCase()]
          );

      // Generate invite token
      const token = generateToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const inviteId = existingInvite?.id ?? crypto.randomUUID();
      const inviteInput = {
        inviteId,
        workspaceId,
        email: body.email.toLowerCase(),
        role: normalizedRole,
        tokenHash,
        invitedBy: auth.user.id,
        expiresAtIso: expiresAt.toISOString(),
        inviteType,
        environmentIds,
        groupIds,
      };
      if (existingInvite) {
        await refreshInviteWithSchemaCompat(inviteInput);
      } else {
        await insertInviteWithSchemaCompat(inviteInput);
      }

      // Get workspace name and inviter name for email
      const workspace = workspaceId
        ? await queryOne<{ name: string }>(
            'SELECT name FROM workspaces WHERE id = $1',
            [workspaceId]
          )
        : null;

      const inviterName = [auth.user.first_name, auth.user.last_name].filter(Boolean).join(' ') || auth.user.email;
      const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'https://flash-mdm.netlify.app';
      const inviteUrl = `${baseUrl}/invite/${token}`;

      // Send invite email
      const emailContent = inviteEmail(
        inviteUrl,
        workspace?.name ?? (inviteType === 'platform_access' ? 'Flash MDM platform' : 'a workspace'),
        inviterName
      );
      await sendEmail({
        to: body.email.toLowerCase(),
        subject: emailContent.subject,
        html: emailContent.html,
      });

      await logAudit({
        workspace_id: workspaceId ?? undefined,
        user_id: auth.user.id,
        action: existingInvite ? 'workspace.invite_resent' : 'workspace.invite_sent',
        resource_type: 'invite',
        resource_id: inviteId,
        details: {
          email: body.email,
          role: normalizedRole,
          invite_type: inviteType,
          access_scope: inviteScope,
          environment_ids: environmentIds,
          group_ids: groupIds,
          inviter_role: callerRole,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse(
        { message: existingInvite ? 'Invite re-sent' : 'Invite sent', invite_id: inviteId },
        existingInvite ? 200 : 201
      );
    }

  // GET /api/invites/:token — validate invite and return details
    if (request.method === 'GET' && segments[0] === 'invites' && segments[1]) {
      const token = segments[1];
      const tokenHash = hashToken(token);

    const invite = await queryOne<{
      id: string;
      email: string;
      role: string;
      permissions: unknown;
      status: string;
      expires_at: string;
      workspace_id: string | null;
      workspace_name: string | null;
      inviter_name: string;
    }>(
      `SELECT i.id, i.email, i.role, i.permissions, i.status, i.expires_at, i.workspace_id,
              w.name as workspace_name,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) as inviter_name
       FROM user_invites i
       LEFT JOIN workspaces w ON w.id = i.workspace_id
       JOIN users u ON u.id = i.invited_by
       WHERE i.token_hash = $1`,
      [tokenHash]
    );

    if (!invite) return errorResponse('Invalid invite link', 404);

    if (invite.status !== 'pending') {
      return errorResponse(`This invite has already been ${invite.status}`);
    }

    if (new Date(invite.expires_at) < new Date()) {
      return errorResponse('This invite has expired');
    }

      return jsonResponse({
        invite: {
          email: invite.email,
          role: invite.role,
          invite_type: getInviteTypeFromPermissions(invite.permissions),
          workspace_name: invite.workspace_name,
          inviter_name: invite.inviter_name,
          expires_at: invite.expires_at,
        },
      });
    }

  // POST /api/invites/:token/accept — accept invite
    if (request.method === 'POST' && segments[0] === 'invites' && segments[1] && segments[2] === 'accept') {
      const auth = await requireAuth(request);
      const token = segments[1];
      const tokenHash = hashToken(token);

      const invite = await getInviteForAccept(tokenHash);

    if (!invite) return errorResponse('Invalid invite link', 404);
    if (invite.status !== 'pending') return errorResponse(`This invite has already been ${invite.status}`);
    if (new Date(invite.expires_at) < new Date()) return errorResponse('This invite has expired');
    if (auth.user.email.toLowerCase() !== invite.email.toLowerCase()) {
      return errorResponse('Invite email does not match the signed-in account', 403);
    }

    const inviteType = getInviteTypeFromPermissions(invite.permissions);
    await transaction(async (client) => {
      const userId = auth.user.id;

      const envIds: string[] = parseJsonStringArray(invite.environment_ids);
      const groupIds: string[] = parseJsonStringArray(invite.group_ids);

      if (invite.workspace_id) {
        const accessScope = envIds.length > 0 || groupIds.length > 0 ? 'scoped' : 'workspace';
        await upsertWorkspaceMembershipFromInvite(client, {
          workspaceId: invite.workspace_id,
          userId,
          role: invite.role,
          accessScope,
        });

        // Add environment memberships
        for (const envId of envIds) {
          await client.query(
            `INSERT INTO environment_memberships (environment_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (environment_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [envId, userId, invite.role]
          );
        }

        // Add group memberships
        for (const gId of groupIds) {
          await client.query(
            `INSERT INTO group_memberships (group_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [gId, userId, invite.role]
          );
        }
      } else if (inviteType !== 'platform_access') {
        throw errorResponse('Invite is missing workspace target', 500);
      }

      // Mark invite as accepted
      await client.query(
        `UPDATE user_invites SET status = 'accepted', accepted_at = now() WHERE id = $1`,
        [invite.id]
      );
    });

    await logAudit({
      workspace_id: invite.workspace_id ?? undefined,
      action: 'workspace.invite_accepted',
      resource_type: 'invite',
      resource_id: invite.id,
      details: { email: invite.email, role: invite.role, invite_type: inviteType },
      ip_address: getClientIp(request),
    });

      return jsonResponse({ message: 'Invite accepted' });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('workspace-invite handler error:', err);
    return errorResponse('Internal server error', 500);
  }
};

export function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)));
}

function roleLevel(role: string): number {
  return ROLE_LEVEL[role] ?? 0;
}

function canGrantRole(inviterRole: string | null, targetRole: string): boolean {
  return !!inviterRole && roleLevel(inviterRole) >= roleLevel(targetRole);
}

async function authorizeScopedInvite(input: {
  auth: Awaited<ReturnType<typeof requireAuth>>;
  workspaceId: string;
  targetRole: string;
  environmentIds: string[];
  groupIds: string[];
}): Promise<string> {
  const { auth, workspaceId, targetRole, environmentIds, groupIds } = input;
  const isScoped = environmentIds.length > 0 || groupIds.length > 0;

  if (!isScoped) {
    const callerRole = await requireWorkspaceResourcePermission(auth, workspaceId, 'invite', 'write');
    if (targetRole === 'owner' && callerRole !== 'owner' && !auth.user.is_superadmin) {
      throw errorResponse('Only owners can invite another owner', 403);
    }
    if (!auth.user.is_superadmin) {
      const callerScope = await getWorkspaceAccessScopeForAuth(auth, workspaceId);
      if (callerScope === 'scoped') {
        throw errorResponse('Scoped users cannot send workspace-wide invites. Choose environment or group assignments.', 403);
      }
    }
    return callerRole;
  }

  if (environmentIds.length > 0) {
    const envRows = await query<{ id: string }>(
      `SELECT id FROM environments
       WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, environmentIds]
    );
    if (envRows.length !== environmentIds.length) {
      throw errorResponse('One or more environment_ids are invalid for this workspace', 400);
    }
  }

  if (groupIds.length > 0) {
    const groupRows = await query<{ id: string }>(
      `SELECT g.id
       FROM groups g
       JOIN environments e ON e.id = g.environment_id
       WHERE e.workspace_id = $1 AND g.id = ANY($2::uuid[])`,
      [workspaceId, groupIds]
    );
    if (groupRows.length !== groupIds.length) {
      throw errorResponse('One or more group_ids are invalid for this workspace', 400);
    }
  }

  if (auth.user.is_superadmin) return 'owner';

  let strongestInviterRole: string | null = null;

  for (const envId of environmentIds) {
    const envRole = await getEnvironmentRoleForAuth(auth, envId);
    if (!envRole || roleLevel(envRole) < roleLevel('admin')) {
      throw errorResponse('Forbidden: insufficient environment role to invite users into one or more environments', 403);
    }
    if (!canGrantRole(envRole, targetRole)) {
      throw errorResponse('Forbidden: cannot grant a role higher than your access in one or more environments', 403);
    }
    if (!strongestInviterRole || roleLevel(envRole) > roleLevel(strongestInviterRole)) {
      strongestInviterRole = envRole;
    }
  }

  for (const groupId of groupIds) {
    const groupRole = await getGroupRoleForAuth(auth, groupId);
    if (!groupRole || roleLevel(groupRole) < roleLevel('admin')) {
      throw errorResponse('Forbidden: insufficient group role to invite users into one or more groups', 403);
    }
    if (!canGrantRole(groupRole, targetRole)) {
      throw errorResponse('Forbidden: cannot grant a role higher than your access in one or more groups', 403);
    }
    if (!strongestInviterRole || roleLevel(groupRole) > roleLevel(strongestInviterRole)) {
      strongestInviterRole = groupRole;
    }
  }

  if (!strongestInviterRole) {
    throw errorResponse('At least one environment_id or group_id is required for a scoped invite', 400);
  }

  return strongestInviterRole;
}

export async function upsertWorkspaceMembershipFromInvite(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: { workspaceId: string; userId: string; role: string; accessScope: 'workspace' | 'scoped' }
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, access_scope)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, access_scope = EXCLUDED.access_scope`,
      [input.workspaceId, input.userId, input.role, input.accessScope]
    );
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missingAccessScopeColumn =
      message.includes('column "access_scope" of relation "workspace_memberships" does not exist')
      || message.includes('column "access_scope" does not exist');
    if (!missingAccessScopeColumn) throw err;
    if (input.accessScope === 'scoped') {
      throw new Response(JSON.stringify({
        error: 'Database migration required: workspace_memberships.access_scope is missing. Run migrations first.'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [input.workspaceId, input.userId, input.role]
    );
  }
}

async function insertInviteWithSchemaCompat(input: {
  inviteId: string;
  workspaceId: string | null;
  email: string;
  role: string;
  tokenHash: string;
  invitedBy: string;
  expiresAtIso: string;
  inviteType: InviteType;
  environmentIds: string[];
  groupIds: string[];
}): Promise<void> {
  const envIdsJson = JSON.stringify(input.environmentIds);
  const groupIdsJson = JSON.stringify(input.groupIds);
  const inviteMetadataJson = JSON.stringify({ invite_type: input.inviteType });

  try {
    await execute(
      `INSERT INTO user_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at, environment_ids, group_ids, permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.inviteId,
        input.workspaceId,
        input.email,
        input.role,
        input.tokenHash,
        input.invitedBy,
        input.expiresAtIso,
        envIdsJson,
        groupIdsJson,
        inviteMetadataJson,
      ]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missingScopedColumns =
      message.includes('column "environment_ids" of relation "user_invites" does not exist')
      || message.includes('column "group_ids" of relation "user_invites" does not exist');
    if (!missingScopedColumns) throw err;

    // Legacy schema only supports single environment/group columns. Preserve behavior for
    // current callers (which send workspace-level invites from the superadmin modal).
    await execute(
      `INSERT INTO user_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at, environment_id, group_id, permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.inviteId,
        input.workspaceId,
        input.email,
        input.role,
        input.tokenHash,
        input.invitedBy,
        input.expiresAtIso,
        input.environmentIds[0] ?? null,
        input.groupIds[0] ?? null,
        inviteMetadataJson,
      ]
    );
  }
}

async function refreshInviteWithSchemaCompat(input: {
  inviteId: string;
  workspaceId: string | null;
  email: string;
  role: string;
  tokenHash: string;
  invitedBy: string;
  expiresAtIso: string;
  inviteType: InviteType;
  environmentIds: string[];
  groupIds: string[];
}): Promise<void> {
  const envIdsJson = JSON.stringify(input.environmentIds);
  const groupIdsJson = JSON.stringify(input.groupIds);
  const inviteMetadataJson = JSON.stringify({ invite_type: input.inviteType });

  try {
    await execute(
      `UPDATE user_invites
       SET role = $2,
           token_hash = $3,
           invited_by = $4,
           expires_at = $5,
           status = 'pending',
           accepted_at = NULL,
           environment_ids = $6,
           group_ids = $7,
           permissions = $8
       WHERE id = $1`,
      [
        input.inviteId,
        input.role,
        input.tokenHash,
        input.invitedBy,
        input.expiresAtIso,
        envIdsJson,
        groupIdsJson,
        inviteMetadataJson,
      ]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missingScopedColumns =
      message.includes('column "environment_ids" of relation "user_invites" does not exist')
      || message.includes('column "group_ids" of relation "user_invites" does not exist');
    if (!missingScopedColumns) throw err;

    await execute(
      `UPDATE user_invites
       SET role = $2,
           token_hash = $3,
           invited_by = $4,
           expires_at = $5,
           status = 'pending',
           accepted_at = NULL,
           environment_id = $6,
           group_id = $7,
           permissions = $8
       WHERE id = $1`,
      [
        input.inviteId,
        input.role,
        input.tokenHash,
        input.invitedBy,
        input.expiresAtIso,
        input.environmentIds[0] ?? null,
        input.groupIds[0] ?? null,
        inviteMetadataJson,
      ]
    );
  }
}

export async function getInviteForAccept(tokenHash: string): Promise<{
  id: string;
  email: string;
  role: string;
  permissions: unknown;
  status: string;
  expires_at: string;
  workspace_id: string | null;
  environment_ids: string;
  group_ids: string;
}> {
  try {
    const invite = await queryOne<{
      id: string;
      email: string;
      role: string;
      permissions: unknown;
      status: string;
      expires_at: string;
      workspace_id: string | null;
      environment_ids: string;
      group_ids: string;
    }>(
      `SELECT id, email, role, permissions, status, expires_at, workspace_id, environment_ids, group_ids
       FROM user_invites
       WHERE token_hash = $1`,
      [tokenHash]
    );
    return invite as any;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missingScopedColumns =
      message.includes('column "environment_ids" does not exist')
      || message.includes('column "group_ids" does not exist');
    if (!missingScopedColumns) throw err;

    const legacyInvite = await queryOne<{
      id: string;
      email: string;
      role: string;
      permissions: unknown;
      status: string;
      expires_at: string;
      workspace_id: string | null;
      environment_id: string | null;
      group_id: string | null;
    }>(
      `SELECT id, email, role, permissions, status, expires_at, workspace_id, environment_id, group_id
       FROM user_invites
       WHERE token_hash = $1`,
      [tokenHash]
    );
    if (!legacyInvite) return null as any;
    return {
      ...legacyInvite,
      environment_ids: JSON.stringify(legacyInvite.environment_id ? [legacyInvite.environment_id] : []),
      group_ids: JSON.stringify(legacyInvite.group_id ? [legacyInvite.group_id] : []),
    };
  }
}

export function getInviteTypeFromPermissions(value: unknown): InviteType {
  const parsed = parsePermissionsMetadata(value);
  return parsed?.invite_type === 'platform_access' ? 'platform_access' : 'workspace_access';
}

function parsePermissionsMetadata(value: unknown): { invite_type?: string } | null {
  if (!value) return null;
  if (typeof value === 'object') return value as { invite_type?: string };
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as { invite_type?: string }) : null;
  } catch {
    return null;
  }
}
