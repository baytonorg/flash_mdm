import type { Context } from '@netlify/functions';
import { validateSession, requireSuperadmin, setSessionCookie, clearSessionCookie } from './_lib/auth.js';
import { queryOne, execute, transaction } from './_lib/db.js';
import { generateToken, hashToken } from './_lib/crypto.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { getStripe } from './_lib/stripe.js';
import migrateHandler from './migrate.js';

interface ActionBody {
  action: string;
  target_id?: string;
  params?: Record<string, unknown> & {
    plan_id?: string;
    impersonation_mode?: 'full' | 'read_only';
    support_reason?: string;
    support_ticket_ref?: string;
    customer_notice_acknowledged?: boolean;
  };
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const body = await parseJsonBody<ActionBody>(request);
    const ip = getClientIp(request);

    if (!body.action) {
      return errorResponse('action is required');
    }

    // Stopping impersonation must work while acting as a customer user (not superadmin).
    if (body.action === 'stop_impersonation') {
      const auth = await validateSession(request);
      if (!auth) return errorResponse('Unauthorized', 401);
      return handleStopImpersonation(auth.sessionId, auth.user.id, ip);
    }

    if (!body.target_id && body.action !== 'run_migrations') {
      return errorResponse('target_id is required');
    }

    const auth = await requireSuperadmin(request);

    switch (body.action) {
      case 'disable_workspace':
        return handleDisableWorkspace(body.target_id, auth.user.id, ip);

      case 'enable_workspace':
        return handleEnableWorkspace(body.target_id, auth.user.id, ip);

      case 'force_plan':
        return handleForcePlan(body.target_id, body.params?.plan_id as string, auth.user.id, ip);
      case 'cancel_workspace_subscription':
        return handleCancelWorkspaceSubscription(body.target_id, auth.user.id, ip);

      case 'impersonate':
        return handleImpersonate(body.target_id, auth.user.id, auth.sessionId, ip, body.params);

      case 'grant_superadmin':
        return handleGrantSuperadmin(body.target_id, auth.user.id, ip);

      case 'revoke_superadmin':
        return handleRevokeSuperadmin(body.target_id, auth.user.id, ip);

      case 'delete_user':
        return handleDeleteUser(body.target_id, auth.user.id, ip);

      case 'run_migrations':
        return handleRunMigrations(request, auth.user.id, ip);

      case 'purge_data':
        return handlePurgeData(body.target_id, auth.user.id, ip, body.params);

      default:
        return errorResponse(`Unknown action: ${body.action}`);
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Superadmin action error:', err);
    return errorResponse('Internal server error', 500);
  }
}

async function handleGrantSuperadmin(targetUserId: string, actorUserId: string, ip: string): Promise<Response> {
  const user = await queryOne<{ id: string; email: string; is_superadmin: boolean }>(
    'SELECT id, email, is_superadmin FROM users WHERE id = $1',
    [targetUserId]
  );
  if (!user) return errorResponse('User not found', 404);

  if (user.is_superadmin) {
    return jsonResponse({ message: `${user.email} is already a superadmin` });
  }

  await execute(
    'UPDATE users SET is_superadmin = true, updated_at = now() WHERE id = $1',
    [targetUserId]
  );

  await logAudit({
    user_id: actorUserId,
    action: 'superadmin.user.promoted',
    resource_type: 'user',
    resource_id: targetUserId,
    details: { email: user.email, is_superadmin: true },
    ip_address: ip,
  });

  return jsonResponse({ message: `${user.email} granted superadmin access` });
}

async function handleRevokeSuperadmin(targetUserId: string, actorUserId: string, ip: string): Promise<Response> {
  if (targetUserId === actorUserId) {
    return errorResponse('Cannot revoke your own superadmin access', 400);
  }

  const user = await queryOne<{ id: string; email: string; is_superadmin: boolean }>(
    'SELECT id, email, is_superadmin FROM users WHERE id = $1',
    [targetUserId]
  );
  if (!user) return errorResponse('User not found', 404);

  if (!user.is_superadmin) {
    return jsonResponse({ message: `${user.email} is not a superadmin` });
  }

  await execute(
    'UPDATE users SET is_superadmin = false, updated_at = now() WHERE id = $1',
    [targetUserId]
  );

  await logAudit({
    user_id: actorUserId,
    action: 'superadmin.user.demoted',
    resource_type: 'user',
    resource_id: targetUserId,
    details: { email: user.email, is_superadmin: false },
    ip_address: ip,
  });

  return jsonResponse({ message: `${user.email} superadmin access revoked` });
}

async function handleDeleteUser(targetUserId: string, actorUserId: string, ip: string): Promise<Response> {
  if (targetUserId === actorUserId) {
    return errorResponse('Cannot delete your own user account', 400);
  }

  const user = await queryOne<{ id: string; email: string; is_superadmin: boolean }>(
    'SELECT id, email, is_superadmin FROM users WHERE id = $1',
    [targetUserId]
  );
  if (!user) return errorResponse('User not found', 404);

  const memberships = await queryOne<{ membership_count: number }>(
    `SELECT COUNT(*)::int AS membership_count
     FROM workspace_memberships
     WHERE user_id = $1`,
    [targetUserId]
  );
  if ((memberships?.membership_count ?? 0) > 0) {
    return errorResponse('Remove user from all workspaces before permanent deletion', 409);
  }

  await transaction(async (client) => {
    await client.query('UPDATE audit_log SET user_id = NULL WHERE user_id = $1', [targetUserId]);
    await client.query('UPDATE user_invites SET invited_by = NULL WHERE invited_by = $1', [targetUserId]);
    await client.query('UPDATE policy_versions SET changed_by = NULL WHERE changed_by = $1', [targetUserId]);
    await client.query('DELETE FROM users WHERE id = $1', [targetUserId]);
  });

  await logAudit({
    user_id: actorUserId,
    action: 'superadmin.user.deleted',
    resource_type: 'user',
    resource_id: targetUserId,
    details: { email: user.email, was_superadmin: user.is_superadmin },
    ip_address: ip,
  });

  return jsonResponse({ message: `${user.email} permanently deleted` });
}

async function handleRunMigrations(request: Request, userId: string, ip: string): Promise<Response> {
  const migrationSecret = process.env.MIGRATION_SECRET;
  if (!migrationSecret) {
    return errorResponse('MIGRATION_SECRET environment variable is not configured', 500);
  }

  const internalUrl = new URL(request.url);
  internalUrl.pathname = '/.netlify/functions/migrate';
  internalUrl.search = '';

  const migrateResponse = await migrateHandler(
    new Request(internalUrl.toString(), {
      method: 'GET',
      headers: {
        'x-migration-secret': migrationSecret,
      },
    }),
    {} as Context
  );

  let payload: unknown = null;
  try {
    payload = await migrateResponse.json();
  } catch {
    try {
      payload = await migrateResponse.text();
    } catch {
      payload = null;
    }
  }

  if (!migrateResponse.ok) {
    await logAudit({
      user_id: userId,
      action: 'superadmin.migrations.run_failed',
      details: { status: migrateResponse.status, payload },
      ip_address: ip,
    });
    return jsonResponse(
      {
        error: 'Migration run failed',
        migrate_status: migrateResponse.status,
        migrate: payload,
      },
      migrateResponse.status
    );
  }

  await logAudit({
    user_id: userId,
    action: 'superadmin.migrations.run',
    details: payload && typeof payload === 'object' ? payload as Record<string, unknown> : { payload },
    ip_address: ip,
  });

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return jsonResponse({
      message: 'Migrations completed',
      ...(payload as Record<string, unknown>),
    });
  }

  return jsonResponse({ message: 'Migrations completed', migrate: payload });
}

async function handleDisableWorkspace(workspaceId: string, userId: string, ip: string): Promise<Response> {
  const ws = await queryOne(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws) return errorResponse('Workspace not found', 404);

  await execute(`UPDATE workspaces SET disabled = true WHERE id = $1`, [workspaceId]);

  await logAudit({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'superadmin.workspace.disabled',
    resource_type: 'workspace',
    resource_id: workspaceId,
    ip_address: ip,
  });

  return jsonResponse({ message: 'Workspace disabled' });
}

async function handleEnableWorkspace(workspaceId: string, userId: string, ip: string): Promise<Response> {
  const ws = await queryOne(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws) return errorResponse('Workspace not found', 404);

  await execute(`UPDATE workspaces SET disabled = false WHERE id = $1`, [workspaceId]);

  await logAudit({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'superadmin.workspace.enabled',
    resource_type: 'workspace',
    resource_id: workspaceId,
    ip_address: ip,
  });

  return jsonResponse({ message: 'Workspace enabled' });
}

async function handleForcePlan(workspaceId: string, planId: string | undefined, userId: string, ip: string): Promise<Response> {
  if (!planId) return errorResponse('params.plan_id is required for force_plan action');

  const ws = await queryOne(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws) return errorResponse('Workspace not found', 404);

  const plan = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM license_plans WHERE id = $1`,
    [planId]
  );
  if (!plan) return errorResponse('Plan not found', 404);

  // Upsert license
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM licenses WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (existing) {
    await execute(
      `UPDATE licenses SET plan_id = $1, status = 'active', updated_at = now() WHERE workspace_id = $2`,
      [planId, workspaceId]
    );
  } else {
    await execute(
      `INSERT INTO licenses (workspace_id, plan_id, status) VALUES ($1, $2, 'active')`,
      [workspaceId, planId]
    );
  }

  await logAudit({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'superadmin.plan.forced',
    resource_type: 'license',
    resource_id: workspaceId,
    details: { plan_id: planId, plan_name: plan.name },
    ip_address: ip,
  });

  return jsonResponse({ message: `Plan forced to ${plan.name}` });
}

function isStripeMissingResourceError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeCode = 'code' in err ? (err as { code?: unknown }).code : undefined;
  if (maybeCode === 'resource_missing') return true;
  const maybeMessage = 'message' in err ? (err as { message?: unknown }).message : undefined;
  return typeof maybeMessage === 'string' && maybeMessage.toLowerCase().includes('no such subscription');
}

async function handleCancelWorkspaceSubscription(workspaceId: string, userId: string, ip: string): Promise<Response> {
  const ws = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  if (!ws) return errorResponse('Workspace not found', 404);

  const license = await queryOne<{ id: string; stripe_subscription_id: string | null }>(
    `SELECT id, stripe_subscription_id
     FROM licenses
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId]
  );
  if (!license) {
    return errorResponse('No workspace license subscription found', 404);
  }

  const subscriptionId = license.stripe_subscription_id;
  if (!subscriptionId) {
    await execute(
      `UPDATE licenses
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1`,
      [license.id]
    );
    await logAudit({
      workspace_id: workspaceId,
      user_id: userId,
      action: 'superadmin.billing.subscription.cancelled',
      resource_type: 'license',
      resource_id: license.id,
      details: {
        workspace_name: ws.name,
        stripe_cancelled: false,
        stripe_subscription_id: null,
      },
      ip_address: ip,
    });
    return jsonResponse({ message: 'Workspace license marked as cancelled' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return errorResponse('Stripe is not configured. Set STRIPE_SECRET_KEY before cancelling subscriptions.', 503);
  }

  let stripeCancelled = false;
  try {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(subscriptionId);
    stripeCancelled = true;
  } catch (err) {
    if (!isStripeMissingResourceError(err)) throw err;
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE licenses
       SET status = 'cancelled', updated_at = now()
       WHERE workspace_id = $1 AND stripe_subscription_id = $2`,
      [workspaceId, subscriptionId]
    );

    await client.query(
      `UPDATE license_grants
       SET status = 'cancelled',
           ends_at = CASE
             WHEN ends_at IS NULL THEN now()
             ELSE LEAST(ends_at, now())
           END,
           updated_at = now()
       WHERE workspace_id = $1
         AND status = 'active'
         AND source = 'stripe'
         AND (
           external_ref = $2
           OR metadata ->> 'subscription_id' = $2
         )`,
      [workspaceId, subscriptionId]
    );
  });

  await logAudit({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'superadmin.billing.subscription.cancelled',
    resource_type: 'license',
    resource_id: license.id,
    details: {
      workspace_name: ws.name,
      stripe_cancelled: stripeCancelled,
      stripe_subscription_id: subscriptionId,
    },
    ip_address: ip,
  });

  return jsonResponse({
    message: stripeCancelled
      ? 'Workspace Stripe subscription cancelled'
      : 'Workspace Stripe subscription closed locally (already missing in Stripe)',
  });
}

async function handleImpersonate(
  targetUserId: string,
  superadminId: string,
  superadminSessionId: string,
  ip: string,
  params?: ActionBody['params'],
): Promise<Response> {
  const supportReason = typeof params?.support_reason === 'string' ? params.support_reason.trim() : '';
  const supportTicketRef = typeof params?.support_ticket_ref === 'string' ? params.support_ticket_ref.trim() : '';
  const impersonationMode = params?.impersonation_mode === 'read_only' ? 'read_only' : 'full';
  const customerNoticeAcknowledged = params?.customer_notice_acknowledged === true;

  if (!supportReason) {
    return errorResponse('params.support_reason is required for impersonation');
  }
  if (!customerNoticeAcknowledged) {
    return errorResponse('params.customer_notice_acknowledged must be true before impersonation');
  }

  // Find the target user
  const targetUser = await queryOne<{ id: string; email: string; is_superadmin: boolean }>(
    `SELECT id, email, is_superadmin FROM users WHERE id = $1`,
    [targetUserId]
  );
  if (!targetUser) return errorResponse('User not found', 404);
  if (targetUser.is_superadmin) {
    return errorResponse('Cannot impersonate a superadmin account', 403);
  }

  // Get their primary workspace membership
  const membership = await queryOne<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
    [targetUserId]
  );

  // Create an impersonation session — store hash in DB, send plaintext token in cookie
  const sessionToken = generateToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await execute(
    `INSERT INTO sessions (
       token_hash, user_id, workspace_id, expires_at, impersonated_by, impersonator_session_id,
       impersonation_mode, support_reason, support_ticket_ref, customer_notice_acknowledged_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [
      sessionTokenHash,
      targetUserId,
      membership?.workspace_id ?? null,
      expiresAt,
      superadminId,
      superadminSessionId,
      impersonationMode,
      supportReason,
      supportTicketRef || null,
    ]
  );

  await logAudit({
    user_id: superadminId,
    action: 'superadmin.impersonate',
    resource_type: 'user',
    resource_id: targetUserId,
    details: {
      target_email: targetUser.email,
      impersonation_mode: impersonationMode,
      support_reason: supportReason,
      support_ticket_ref: supportTicketRef || null,
      customer_notice_acknowledged: true,
    },
    ip_address: ip,
  });

  const secure = process.env.NODE_ENV !== 'development';
  const cookie = `flash_session=${sessionToken}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=3600`;

  return jsonResponse(
    { message: `Impersonating ${targetUser.email}` },
    200,
    { 'Set-Cookie': cookie }
  );
}

async function handleStopImpersonation(
  currentSessionId: string,
  currentUserId: string,
  ip: string,
): Promise<Response> {
  const current = await queryOne<{
    id: string;
    user_id: string;
    impersonated_by: string | null;
    impersonator_session_id: string | null;
  }>(
    `SELECT id, user_id, impersonated_by, impersonator_session_id
     FROM sessions
     WHERE id = $1 AND expires_at > now()`,
    [currentSessionId]
  );

  if (!current) return errorResponse('Current session not found', 404);
  if (!current.impersonated_by || !current.impersonator_session_id) {
    return errorResponse('Current session is not an impersonation session', 409);
  }

  const parentSession = await queryOne<{
    id: string;
    user_id: string;
    is_superadmin: boolean;
  }>(
    `SELECT s.id, s.user_id, u.is_superadmin
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [current.impersonator_session_id]
  );

  if (!parentSession || !parentSession.is_superadmin || parentSession.user_id !== current.impersonated_by) {
    // Do not mint privileged sessions if the original superadmin session expired.
    await execute('DELETE FROM sessions WHERE id = $1', [currentSessionId]);
    return jsonResponse(
      { error: 'Original superadmin session expired. Please sign in again.' },
      401,
      { 'Set-Cookie': clearSessionCookie() }
    );
  }

  await execute('DELETE FROM sessions WHERE id = $1', [currentSessionId]);

  await logAudit({
    user_id: current.impersonated_by,
    action: 'superadmin.impersonate.stopped',
    resource_type: 'user',
    resource_id: currentUserId,
    details: {
      fallback_superadmin_session_recreated: false,
    },
    ip_address: ip,
  });

  // For fallback sessions, use the new token. For existing parent sessions,
  // create a new session since we can't recover the original plaintext token.
  let restoreToken: string;
  if ('token' in parentSession && parentSession.token) {
    restoreToken = parentSession.token as string;
  } else {
    // Parent session exists but we don't have the plaintext token.
    // Create a fresh session for the superadmin.
    const freshToken = generateToken();
    const freshSessionTokenHash = hashToken(freshToken);
    const freshExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await execute(
      `INSERT INTO sessions (token_hash, user_id, expires_at, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [freshSessionTokenHash, parentSession.user_id, freshExpiresAt, ip]
    );
    restoreToken = freshToken;
  }

  return jsonResponse(
    { message: 'Returned to superadmin session' },
    200,
    { 'Set-Cookie': setSessionCookie(restoreToken) }
  );
}

async function handlePurgeData(
  workspaceId: string,
  userId: string,
  ip: string,
  params?: ActionBody['params']
): Promise<Response> {
  const supportReason = typeof params?.support_reason === 'string' ? params.support_reason.trim() : '';
  const customerNoticeAcknowledged = params?.customer_notice_acknowledged === true;
  if (!supportReason) {
    return errorResponse('params.support_reason is required for purge_data');
  }
  if (!customerNoticeAcknowledged) {
    return errorResponse('params.customer_notice_acknowledged must be true before purge_data');
  }

  const ws = await queryOne(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws) return errorResponse('Workspace not found', 404);

  await logAudit({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'superadmin.workspace.purge_started',
    resource_type: 'workspace',
    resource_id: workspaceId,
    details: {
      support_reason: supportReason,
      customer_notice_acknowledged: true,
    },
    ip_address: ip,
  });

  await transaction(async (client) => {
    // Delete in order respecting foreign keys
    // Environments cascade deletes devices, policies, etc.
    await client.query(`DELETE FROM environments WHERE workspace_id = $1`, [workspaceId]);
    await client.query(`DELETE FROM licenses WHERE workspace_id = $1`, [workspaceId]);
  });
  // Keep the workspace and members but all operational data is purged

  await logAudit({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'superadmin.workspace.purged',
    resource_type: 'workspace',
    resource_id: workspaceId,
    details: {
      support_reason: supportReason,
      customer_notice_acknowledged: true,
    },
    ip_address: ip,
  });

  return jsonResponse({ message: 'Workspace data purged' });
}
