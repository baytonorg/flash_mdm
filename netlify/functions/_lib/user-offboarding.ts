import type { PoolClient } from 'pg';
import { transaction } from './db.js';
import { lockMembershipWorkspaces, removeWorkspaceGrants, requireSurvivingWorkspaceOwner, requireScopeManagementPaths } from './membership-lifecycle.js';
import { logAudit } from './audit.js';
import { errorResponse } from './helpers.js';

const USER_WORKSPACE_SCOPES = `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1
  UNION SELECT e.workspace_id FROM environment_memberships em JOIN environments e ON e.id = em.environment_id WHERE em.user_id = $1
  UNION SELECT e.workspace_id FROM group_memberships gm JOIN groups g ON g.id = gm.group_id JOIN environments e ON e.id = g.environment_id WHERE gm.user_id = $1`;

export async function userDeletionPreflight(client: Pick<PoolClient, 'query'>, userId: string, actorUserId?: string) {
  const user = (await client.query(`SELECT id, email, is_superadmin, password_hash IS NOT NULL AS has_password,
    (totp_secret_enc IS NOT NULL OR totp_pending_enc IS NOT NULL OR totp_backup_codes_enc IS NOT NULL) AS has_mfa_credentials
    FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user) throw errorResponse('User not found', 404);
  const memberships = (await client.query(`SELECT w.id AS workspace_id, w.name, COALESCE(wm.role, 'direct grants only') AS role, COALESCE(wm.access_scope, 'scoped') AS access_scope,
    (wm.role = 'owner' AND wm.access_scope = 'workspace' AND NOT EXISTS (
      SELECT 1 FROM workspace_memberships other WHERE other.workspace_id = w.id AND other.user_id <> $1
      AND other.role = 'owner' AND other.access_scope = 'workspace')) AS sole_owner,
    (SELECT count(*)::int FROM environments e WHERE e.workspace_id = w.id) AS environments_retained,
    (SELECT count(*)::int FROM environments e WHERE e.workspace_id = w.id AND e.enterprise_name IS NOT NULL) AS external_bindings_retained,
    (SELECT count(*)::int FROM licenses l WHERE l.workspace_id = w.id) AS licences_retained,
    (SELECT count(*)::int FROM licenses l WHERE l.workspace_id = w.id AND l.stripe_subscription_id IS NOT NULL) AS subscription_records_retained,
    w.stripe_customer_id IS NOT NULL AS has_billing_customer
    FROM (${USER_WORKSPACE_SCOPES}) scopes JOIN workspaces w ON w.id = scopes.workspace_id
    LEFT JOIN workspace_memberships wm ON wm.workspace_id = w.id AND wm.user_id = $1 ORDER BY w.id`, [userId])).rows;
  const counts = (await client.query(`SELECT
    (SELECT count(*)::int FROM sessions WHERE user_id = $1 OR impersonated_by = $1) AS sessions,
    (SELECT count(*)::int FROM sessions WHERE (user_id = $1 AND impersonated_by IS NOT NULL) OR impersonated_by = $1) AS support_sessions,
    (SELECT count(*)::int FROM api_keys WHERE created_by_user_id = $1) AS independent_keys_retained,
    (SELECT count(*)::int FROM environment_memberships WHERE user_id = $1) AS environment_grants,
    (SELECT count(*)::int FROM group_memberships WHERE user_id = $1) AS group_grants,
    (SELECT count(*)::int FROM user_invites WHERE lower(email) = lower($2) AND status = 'pending') AS pending_invites,
    (SELECT count(*)::int FROM magic_links WHERE lower(email) = lower($2) AND used_at IS NULL AND expires_at > now()) AS signin_links,
    (SELECT count(*)::int FROM audit_log WHERE user_id = $1) AS audit_entries_retained,
    (SELECT count(*)::int FROM flashagent_chat_messages WHERE user_id = $1) AS personal_chat_messages_deleted
    `, [userId, user.email])).rows[0];
  // Match each reviewed source column and delete action, not just the table.
  const knownDependencies = new Set([
    'api_keys.created_by_user_id:n', 'api_keys.revoked_by_user_id:n',
    'app_feedback_subscriptions.user_id:c', 'audit_log.user_id:a', 'billing_invoices.created_by:n',
    'environment_memberships.user_id:c', 'flashagent_chat_messages.user_id:c', 'flashagent_jobs.user_id:c',
    'group_memberships.user_id:c', 'license_grants.created_by:n', 'platform_settings.updated_by:n',
    'policy_versions.changed_by:a', 'sessions.user_id:c', 'sessions.impersonated_by:n',
    'signup_links.created_by:n', 'user_invites.invited_by:a', 'workspace_billing_settings.created_by:n',
    'workspace_billing_settings.updated_by:n', 'workspace_memberships.user_id:c',
  ]);
  const dependencies = await client.query(`SELECT n.nspname AS schema, cl.relname AS relation, c.confdeltype,
      source.attname AS source_column, target.attname AS target_column
    FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    LEFT JOIN pg_attribute source ON source.attrelid = c.conrelid AND c.conkey = ARRAY[source.attnum]
    LEFT JOIN pg_attribute target ON target.attrelid = c.confrelid AND c.confkey = ARRAY[target.attnum]
    WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass`);
  const blockers = memberships.filter(m => m.sole_owner).map(m => `Establish another workspace-wide owner in ${m.name} first`);
  if (actorUserId === userId) blockers.push('You cannot permanently delete your own signed-in account');
  for (const dependency of dependencies.rows) {
    if (dependency.schema !== 'public' || dependency.target_column !== 'id' || !knownDependencies.has(`${dependency.relation}.${dependency.source_column}:${dependency.confdeltype}`)) blockers.push(`User dependency ${dependency.schema}.${dependency.relation} has not been reviewed for offboarding. Review its credential, retention and deletion effects first.`);
    if (dependency.relation === 'api_keys' && dependency.confdeltype === 'c') blockers.push('API-key creator provenance must be decoupled before account deletion. Independent keys will not be deleted.');
  }
  return { user, memberships, counts, blockers,
    effects: {
      deletes: ['Global user account and password/MFA state', 'All workspace, environment and group memberships', 'Login and support sessions involving this account', 'Pending invitations and sign-in links addressed to this account', 'Personal Flashi messages, legacy personal jobs where present, and feedback subscriptions'],
      retains: ['Shared workspaces and their operational data', 'Other users and their access', 'Workspace/environment API keys with creator provenance detached', 'Audit history, accepted invitation records and other retained historical records, which may contain identifying details', 'Billing/subscriptions and external Google resources'],
      rollback: 'Transactional until commit. Completed deletion is irreversible through this UI. Backup restore is a separate operator procedure; backup availability has not been verified by this preflight.',
    } };
}

export async function deleteUserAccount(input: { userId: string; actorUserId: string; ip: string; confirmationEmail?: unknown; endSessionsAndCredentials?: boolean; cancelPendingInvites?: boolean }) {
  if (input.userId === input.actorUserId) throw errorResponse('Cannot delete your own user account', 400);
  return transaction(async client => {
    // Read the scope set, lock it deterministically, then lock the identity.
    // FK locks prevent a concurrent writer from resurrecting a deleted identity.
    const scope = await client.query(`${USER_WORKSPACE_SCOPES} ORDER BY workspace_id`, [input.userId]);
    await lockMembershipWorkspaces(client, scope.rows.map(r => r.workspace_id));
    const actor = (await client.query('SELECT is_superadmin FROM users WHERE id = $1 FOR SHARE', [input.actorUserId])).rows[0];
    if (!actor?.is_superadmin) throw errorResponse('Current superadmin authority is required for permanent account deletion', 403);
    const user = (await client.query('SELECT id, email FROM users WHERE id = $1 FOR UPDATE', [input.userId])).rows[0];
    if (!user) throw errorResponse('User not found', 404);
    const currentScopes = await client.query(`${USER_WORKSPACE_SCOPES} ORDER BY workspace_id`, [input.userId]);
    if (JSON.stringify(currentScopes.rows) !== JSON.stringify(scope.rows)) throw errorResponse('Memberships changed. Refresh the preflight and try again.', 409);
    const preflight = await userDeletionPreflight(client, input.userId);
    if (preflight.blockers.length) throw errorResponse(preflight.blockers.join('; '), 409);
    if (input.confirmationEmail !== user.email || !input.endSessionsAndCredentials) throw errorResponse('Confirm the email and explicitly acknowledge deletion of sign-in credentials and all related sessions', 400);
    if (preflight.counts.pending_invites && !input.cancelPendingInvites) throw errorResponse('Explicitly confirm cancellation of pending invitations', 409);
    // Assert the provenance-only FK is installed before deleting any identity.
    const dependency = await client.query(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'api_keys'::regclass AND conname = 'api_keys_created_by_user_id_fkey'`);
    if (dependency.rows[0]?.confdeltype !== 'n') throw errorResponse('Account deletion needs the API-key provenance migration. Keys will not be deleted.', 409);
    for (const membership of preflight.memberships) {
      await removeWorkspaceGrants(client, membership.workspace_id, input.userId);
      await requireSurvivingWorkspaceOwner(client, membership.workspace_id);
      await requireScopeManagementPaths(client, membership.workspace_id);
    }
    await client.query('DELETE FROM sessions WHERE user_id = $1 OR impersonated_by = $1', [input.userId]);
    await client.query('DELETE FROM magic_links WHERE lower(email) = lower($1)', [user.email]);
    await client.query("DELETE FROM user_invites WHERE lower(email) = lower($1) AND status = 'pending'", [user.email]);
    await client.query("UPDATE audit_log SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('deleted_user_id', user_id), user_id = NULL WHERE user_id = $1", [input.userId]);
    await client.query('UPDATE user_invites SET invited_by = NULL WHERE invited_by = $1', [input.userId]);
    await client.query('UPDATE policy_versions SET changed_by = NULL WHERE changed_by = $1', [input.userId]);
    await client.query('DELETE FROM users WHERE id = $1', [input.userId]);
    await logAudit({ user_id: input.actorUserId, actor_type: 'user', action: 'superadmin.user.deleted', resource_type: 'user', resource_id: input.userId,
      details: { memberships_removed: preflight.memberships.length, independent_keys_retained: preflight.counts.independent_keys_retained, sign_in_credentials_deleted: true, sessions_ended: true, audit_history_retained: true }, ip_address: input.ip }, client);
    return { message: 'User account deleted. Shared workspace data, independent API keys and retained audit history were preserved.' };
  });
}
