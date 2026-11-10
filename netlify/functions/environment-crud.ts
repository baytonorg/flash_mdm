import { requireEnvironmentLifecyclePermission } from './_lib/scope-authority.js';
import { deleteEnvironmentData } from './_lib/environment-deletion.js';
import { lockMembershipWorkspaces } from './_lib/membership-lifecycle.js';
import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  getWorkspaceAccessScopeForAuth,
  requireEnvironmentPermission,
  requireWorkspaceResourcePermission,
} from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';
import { withSignupLinkReferenceLock } from './_lib/signup-link-reference-lock.js';
import { environmentFeaturesPreservingRbac } from './_lib/environment-features.js';

type PgLikeError = {
  code?: unknown;
  detail?: unknown;
  table?: unknown;
  constraint?: unknown;
};

// The existing environment/time index bounds this lookup to one environment.
// This is retained audit evidence, not a page-view or device-sync timestamp.
const lastUserActionSql = `(SELECT al.created_at FROM audit_log al
  WHERE al.environment_id = e.id
    AND (al.workspace_id = e.workspace_id OR al.workspace_id IS NULL)
    AND al.actor_type = 'user' AND al.user_id IS NOT NULL
    AND al.api_key_id IS NULL AND al.visibility_scope = 'standard'
  ORDER BY al.created_at DESC LIMIT 1) AS last_user_action_at`;

function getPgCode(err: unknown): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return '';
  return String((err as PgLikeError).code ?? '');
}

function isMissingRelationOrColumnError(err: unknown): boolean {
  const code = getPgCode(err);
  return code === '42P01' || code === '42703';
}

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const normalizedPath = url.pathname
      .replace(/^\/api\/environments\/?/, '')
      .replace(/^\/\.netlify\/functions\/environment-crud\/?/, '');
    const segments = normalizedPath.split('/').filter(Boolean);
    const action = segments[0] ?? (request.method === 'GET' ? 'list' : undefined);

  // GET /api/environments/list?workspace_id=...
  if (request.method === 'GET' && action === 'list') {
    const params = getSearchParams(request);
    const workspaceId = params.get('workspace_id');
    if (!workspaceId) return errorResponse('workspace_id is required');
    const accessScope = (auth.authType === 'session' && auth.user.is_superadmin)
      ? 'workspace'
      : await getWorkspaceAccessScopeForAuth(auth, workspaceId);
    if (!accessScope) {
      return errorResponse('Forbidden: no access to workspace', 403);
    }

    if (
      (auth.authType === 'session' && accessScope === 'workspace')
      || (auth.authType === 'api_key' && auth.apiKey?.scope_type === 'workspace')
    ) {
      await requireWorkspaceResourcePermission(auth, workspaceId, 'environment', 'read');
    }

    const environments = auth.authType === 'api_key' && auth.apiKey?.scope_type === 'environment'
      ? await query(
          `SELECT e.id, e.workspace_id, e.name, e.enterprise_name, e.enterprise_display_name,
                  e.pubsub_topic, e.enterprise_features, e.created_at, e.updated_at,
                  ${lastUserActionSql},
                  $3::text AS user_role
           FROM environments e
           WHERE e.workspace_id = $1
             AND e.id = $2
           ORDER BY e.name`,
          [workspaceId, auth.apiKey.environment_id, auth.apiKey.role]
        )
      : accessScope === 'scoped'
      ? await query(
          `SELECT e.id, e.workspace_id, e.name, e.enterprise_name, e.enterprise_display_name,
                  e.pubsub_topic, e.enterprise_features, e.created_at, e.updated_at,
                  ${lastUserActionSql},
                  COALESCE(
                    (
                      SELECT em.role::text
                      FROM environment_memberships em
                      WHERE em.environment_id = e.id
                        AND em.user_id = $2
                      LIMIT 1
                    ),
                    (
                      SELECT gm.role::text
                      FROM group_memberships gm
                      JOIN groups g ON g.id = gm.group_id
                      WHERE g.environment_id = e.id
                        AND gm.user_id = $2
                      ORDER BY CASE gm.role
                        WHEN 'owner' THEN 4
                        WHEN 'admin' THEN 3
                        WHEN 'member' THEN 2
                        WHEN 'viewer' THEN 1
                        ELSE 0
                      END DESC
                      LIMIT 1
                    )
                  ) AS user_role
           FROM environments e
           WHERE e.workspace_id = $1
             AND (
               EXISTS (
                 SELECT 1
                 FROM environment_memberships em
                 WHERE em.environment_id = e.id
                   AND em.user_id = $2
               )
               OR EXISTS (
                 SELECT 1
                 FROM group_memberships gm
                 JOIN groups g ON g.id = gm.group_id
                 WHERE g.environment_id = e.id
                   AND gm.user_id = $2
               )
             )
           ORDER BY e.name`,
          [workspaceId, auth.user.id]
        )
      : await query(
          `SELECT e.id, e.workspace_id, e.name, e.enterprise_name, e.enterprise_display_name,
                  e.pubsub_topic, e.enterprise_features, e.created_at, e.updated_at,
                  ${lastUserActionSql},
                  NULL::text AS user_role
           FROM environments e
           WHERE e.workspace_id = $1
           ORDER BY e.name`,
          [workspaceId]
        );

    return jsonResponse({ environments });
  }

  // GET /api/environments/:id
  if (request.method === 'GET' && action && action !== 'list') {
    const env = await queryOne(
      `SELECT e.id, e.workspace_id, e.name, e.enterprise_name, e.enterprise_display_name,
              e.pubsub_topic, e.enterprise_features, e.created_at, e.updated_at,
              ${lastUserActionSql}
       FROM environments e WHERE e.id = $1`,
      [action]
    );
    if (!env) return errorResponse('Environment not found', 404);
    await requireEnvironmentPermission(auth, action, 'read');
    return jsonResponse({ environment: env });
  }

  // POST /api/environments/create
  if (request.method === 'POST' && action === 'create') {
    const body = await parseJsonBody<{ workspace_id: string; name: string }>(request);
    if (!body.workspace_id || !body.name) return errorResponse('workspace_id and name are required');
    let setupGate: {
      access_scope: string;
      needs_environment_setup: boolean;
      environment_count: string;
    } | null = null;
    if (auth.authType === 'session' && !auth.user.is_superadmin) {
      try {
        setupGate = await queryOne<{
          access_scope: string;
          needs_environment_setup: boolean;
          environment_count: string;
        }>(
          `SELECT
              wm.access_scope,
              (COALESCE(u.metadata->>'needs_environment_setup', 'false') = 'true'
                AND COALESCE(u.metadata->>'environment_setup_workspace_id', (
                  SELECT a.workspace_id::text FROM audit_log a WHERE a.user_id = u.id
                    AND (a.action = 'auth.register.signup_link'
                      OR (a.action = 'auth.register' AND a.details ? 'signup_link_id'))
                    AND a.details->>'allow_environment_creation' = 'true' ORDER BY a.created_at DESC LIMIT 1
                )) = $1::uuid::text
                AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id = u.id AND a.workspace_id = $1
                  AND a.action = 'environment.created' AND a.details->>'onboarding_setup_create' = 'true')) AS needs_environment_setup,
              (
                SELECT COUNT(*)
                FROM environment_memberships em
                JOIN environments e ON e.id = em.environment_id
                WHERE em.user_id = $2
                  AND e.workspace_id = $1
              ) AS environment_count
           FROM workspace_memberships wm
           JOIN users u ON u.id = wm.user_id
           WHERE wm.workspace_id = $1
             AND wm.user_id = $2`,
          [body.workspace_id, auth.user.id]
        );
      } catch (setupErr) {
        if (!isMissingRelationOrColumnError(setupErr)) {
          throw setupErr;
        }
      }
    }

    const hasNoEnvironmentMembership = Number.parseInt(setupGate?.environment_count ?? '0', 10) === 0;
    const onboardingSetupCreate = Boolean(
      setupGate
      && setupGate.access_scope === 'scoped'
      && setupGate.needs_environment_setup
      && hasNoEnvironmentMembership
    );

    try {
      await requireWorkspaceResourcePermission(auth, body.workspace_id, 'environment', 'write');
    } catch (err) {
      const isScopedCustomerSetupAttempt =
        err instanceof Response
        && err.status === 403
        && auth.authType === 'session'
        && !auth.user.is_superadmin;
      if (!isScopedCustomerSetupAttempt) {
        throw err;
      }
      if (!onboardingSetupCreate) {
        throw err;
      }
    }

    const id = crypto.randomUUID();
    const rootGroupId = crypto.randomUUID();
    const environmentRole = onboardingSetupCreate ? 'owner' : 'admin';
    const defaultPolicyId = crypto.randomUUID();

    await transaction(async (client) => {
      await lockMembershipWorkspaces(client, [body.workspace_id]);
      if (onboardingSetupCreate) {
        const entitlement = await client.query(`SELECT u.id FROM users u JOIN workspace_memberships wm ON wm.user_id = u.id
          WHERE u.id = $1 AND wm.workspace_id = $2 AND wm.access_scope = 'scoped'
            AND u.metadata->>'needs_environment_setup' = 'true'
            AND COALESCE(u.metadata->>'environment_setup_workspace_id', (
              SELECT a.workspace_id::text FROM audit_log a WHERE a.user_id = u.id
                AND (a.action = 'auth.register.signup_link'
                  OR (a.action = 'auth.register' AND a.details ? 'signup_link_id'))
                AND a.details->>'allow_environment_creation' = 'true' ORDER BY a.created_at DESC LIMIT 1)) = $2::uuid::text
            AND NOT EXISTS (SELECT 1 FROM environment_memberships em JOIN environments e ON e.id = em.environment_id WHERE em.user_id = u.id AND e.workspace_id = $2)
            AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id = u.id AND a.workspace_id = $2 AND a.action = 'environment.created' AND a.details->>'onboarding_setup_create' = 'true')
          FOR UPDATE OF u`, [auth.user.id, body.workspace_id]);
        if (!entitlement.rows.length) throw errorResponse('First-environment creation entitlement changed or has already been used. Ask a workspace owner to review access.', 409);
        await client.query(`UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"needs_environment_setup":false}'::jsonb WHERE id = $1`, [auth.user.id]);
      }
      await client.query(
        'INSERT INTO environments (id, workspace_id, name) VALUES ($1, $2, $3)',
        [id, body.workspace_id, body.name]
      );

      // Only human creators receive a human membership. Keys retain resource grants.
      if (auth.authType === 'session') await client.query(
        `INSERT INTO environment_memberships (environment_id, user_id, role)
         SELECT $1::uuid, $2::uuid, $3 WHERE EXISTS (
           SELECT 1 FROM workspace_memberships wm JOIN environments e ON e.workspace_id = wm.workspace_id
           WHERE e.id = $1 AND wm.user_id = $2)`,
        [id, auth.user.id, environmentRole]
      );

      // Do not elevate workspace_memberships.role during onboarding setup.
      // Customer setup users remain scoped and receive ownership only on their environment/group grants.

      // Create root group named after the environment.
      await client.query(
        'INSERT INTO groups (id, environment_id, name, description) VALUES ($1, $2, $3, $4)',
        [rootGroupId, id, body.name, 'Root group']
      );
      await client.query(
        'INSERT INTO group_closures (ancestor_id, descendant_id, depth) VALUES ($1, $2, $3)',
        [rootGroupId, rootGroupId, 0]
      );
      if (auth.authType === 'session') await client.query(
        `INSERT INTO group_memberships (group_id, user_id, role, permissions)
         SELECT $1::uuid, $2::uuid, $3, $4::jsonb WHERE EXISTS (
           SELECT 1 FROM workspace_memberships wm JOIN environments e ON e.workspace_id = wm.workspace_id
           JOIN groups g ON g.environment_id = e.id WHERE g.id = $1 AND wm.user_id = $2)
         ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions`,
        [
          rootGroupId,
          auth.user.id,
          environmentRole,
          JSON.stringify({ devices: true, policies: true, apps: true, reports: true, settings: true, users: true }),
        ]
      );

      // Create a default safety-net policy and assign it at the environment level.
      // This ensures devices always have a basic all-defaults policy even if they
      // lose all group membership.
      await client.query(
        `INSERT INTO policies (id, environment_id, name, description, deployment_scenario, config, status)
         VALUES ($1, $2, 'Default', 'Default safety-net policy applied when no group policy is assigned', 'fm', '{}', 'draft')`,
        [defaultPolicyId, id]
      );
      await client.query(
        `INSERT INTO policy_versions (id, policy_id, version, config, changed_by)
         VALUES ($1, $2, 1, '{}', $3)`,
        [crypto.randomUUID(), defaultPolicyId, auth.user.id]
      );
      await client.query(
        `INSERT INTO policy_assignments (id, policy_id, scope_type, scope_id)
         VALUES ($1, $2, 'environment', $3)`,
        [crypto.randomUUID(), defaultPolicyId, id]
      );
    });

    await logAudit({
      workspace_id: body.workspace_id,
      environment_id: id,
      user_id: auth.user.id,
      action: 'environment.created',
      resource_type: 'environment',
      resource_id: id,
      details: { name: body.name, onboarding_setup_create: onboardingSetupCreate },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ environment: { id, workspace_id: body.workspace_id, name: body.name } }, 201);
  }

  // PUT /api/environments/update
  if (request.method === 'PUT' && action === 'update') {
    const body = await parseJsonBody<{
      id: string;
      name?: string;
      pubsub_topic?: string | null;
      enterprise_features?: Record<string, unknown>;
    }>(request);
    if (!body.id) return errorResponse('Environment ID is required');

    const envCheck = await queryOne<{
      workspace_id: string;
      name: string;
      enterprise_name: string | null;
      enterprise_display_name: string | null;
      pubsub_topic: string | null;
    }>(
      'SELECT workspace_id, name, enterprise_name, enterprise_display_name, pubsub_topic FROM environments WHERE id = $1',
      [body.id]
    );
    if (!envCheck) return errorResponse('Environment not found', 404);
    await requireEnvironmentPermission(auth, body.id, 'write');

    const normalizedName = body.name !== undefined ? body.name.trim() : undefined;
    if (body.name !== undefined && !normalizedName) {
      return errorResponse('Environment name cannot be empty');
    }

    const normalizedPubsubTopic = body.pubsub_topic !== undefined
      ? (body.pubsub_topic?.trim() ? body.pubsub_topic.trim() : null)
      : undefined;

    const enterpriseNameChanged = !!envCheck.enterprise_name
      && normalizedName !== undefined
      && normalizedName !== envCheck.name;
    const enterprisePubsubChanged = !!envCheck.enterprise_name
      && normalizedPubsubTopic !== undefined
      && normalizedPubsubTopic !== (envCheck.pubsub_topic ?? null);

    let patchedEnterpriseDisplayName: string | null | undefined;
    let patchedEnterprisePubsubTopic: string | null | undefined;

    // If the environment is already bound, keep AMAPI enterprise settings in sync.
    if (
      envCheck.enterprise_name &&
      (enterpriseNameChanged || enterprisePubsubChanged)
    ) {
      const workspace = await queryOne<{ gcp_project_id: string | null }>(
        'SELECT gcp_project_id FROM workspaces WHERE id = $1',
        [envCheck.workspace_id]
      );
      if (!workspace?.gcp_project_id) {
        return errorResponse('Workspace is missing GCP project ID; cannot patch enterprise settings.', 400);
      }

      const updateMaskParts: string[] = [];
      const patchBody: Record<string, unknown> = {};

      if (enterpriseNameChanged && normalizedName) {
        patchBody.enterpriseDisplayName = normalizedName;
        updateMaskParts.push('enterpriseDisplayName');
      }

      if (enterprisePubsubChanged) {
        patchBody.enabledNotificationTypes = normalizedPubsubTopic
          ? ['ENROLLMENT', 'STATUS_REPORT', 'COMMAND', 'USAGE_LOGS', 'ENTERPRISE_UPGRADE']
          : [];
        updateMaskParts.push('enabledNotificationTypes');

        if (normalizedPubsubTopic) {
          patchBody.pubsubTopic = normalizedPubsubTopic;
          updateMaskParts.push('pubsubTopic');
        }
      }

      try {
        const patchedEnterprise = await amapiCall<{ enterpriseDisplayName?: string; pubsubTopic?: string }>(
          `${envCheck.enterprise_name}?updateMask=${encodeURIComponent(updateMaskParts.join(','))}`,
          envCheck.workspace_id,
          {
            method: 'PATCH',
            body: patchBody,
            projectId: workspace.gcp_project_id,
            enterpriseName: envCheck.enterprise_name,
            resourceType: 'enterprises',
            resourceId: envCheck.enterprise_name.split('/').pop(),
          }
        );
        patchedEnterpriseDisplayName = patchedEnterprise.enterpriseDisplayName ?? null;
        if (Object.prototype.hasOwnProperty.call(patchedEnterprise, 'pubsubTopic')) {
          patchedEnterprisePubsubTopic = patchedEnterprise.pubsubTopic?.trim()
            ? patchedEnterprise.pubsubTopic.trim()
            : null;
        }
      } catch (err) {
        return errorResponse(
          `Failed to update enterprise settings: ${err instanceof Error ? err.message : 'Unknown error'}`,
          getAmapiErrorHttpStatus(err) ?? 502
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (normalizedName !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(normalizedName);
      if (envCheck.enterprise_name) {
        updates.push(`enterprise_display_name = $${idx++}`);
        values.push(patchedEnterpriseDisplayName ?? normalizedName);
      }
    }
    if (body.pubsub_topic !== undefined) {
      const dbPubsubTopic = envCheck.enterprise_name && enterprisePubsubChanged
        ? (
            patchedEnterprisePubsubTopic !== undefined
              ? patchedEnterprisePubsubTopic
              : normalizedPubsubTopic === null
                ? (envCheck.pubsub_topic ?? null)
                : (normalizedPubsubTopic ?? null)
          )
        : (normalizedPubsubTopic ?? null);
      updates.push(`pubsub_topic = $${idx++}`);
      values.push(dbPubsubTopic);
    }
    if (body.enterprise_features) {
      if (typeof body.enterprise_features !== 'object' || Array.isArray(body.enterprise_features)) {
        return errorResponse('enterprise_features must be an object');
      }
      updates.push(`enterprise_features = ${environmentFeaturesPreservingRbac(idx++)}`);
      values.push(JSON.stringify(body.enterprise_features));
    }
    updates.push('updated_at = now()');

    values.push(body.id);
    await execute(`UPDATE environments SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    await logAudit({
      environment_id: body.id,
      user_id: auth.user.id,
      action: 'environment.updated',
      resource_type: 'environment',
      resource_id: body.id,
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Environment updated' });
  }

  // DELETE /api/environments/:id
  if (request.method === 'DELETE' && action) {
    const envToDelete = await queryOne<{ workspace_id: string }>('SELECT workspace_id FROM environments WHERE id = $1', [action]);
    if (!envToDelete) return errorResponse('Environment not found', 404);
    await requireEnvironmentPermission(auth, action, 'delete');

    const confirmAccessCleanup = getSearchParams(request).get('confirm_access_cleanup') === 'true';
    let accessCleanup = { keys_deleted: 0, signup_links_deleted: 0, shared_links_updated: 0 };
    try {
      // Signup links use polymorphic and JSON references rather than foreign
      // keys. Share a lock with their write path so validation/cleanup cannot
      // race a create or assignment update.
      await withSignupLinkReferenceLock(() => transaction(async (client) => {
        await lockMembershipWorkspaces(client, [envToDelete.workspace_id]);
        // Matrix edits lock the environment row independently of its workspace.
        await client.query('SELECT id FROM environments WHERE id = $1 FOR UPDATE', [action]);
        await requireEnvironmentLifecyclePermission(client, auth, action, 'delete');
        accessCleanup = await deleteEnvironmentData(client, action, confirmAccessCleanup);
        await logAudit({
          workspace_id: envToDelete.workspace_id,
          user_id: auth.user.id,
          action: 'environment.deleted',
          resource_type: 'environment',
          resource_id: action,
          ...(auth.authType === 'api_key' && auth.apiKey?.environment_id === action ? { api_key_id: null } : {}),
          details: { access_cleanup_confirmed: confirmAccessCleanup, ...accessCleanup },
          ip_address: getClientIp(request),
        }, client);
      }));
    } catch (err) {
      if (err instanceof Response) return err;
      const pgCode = getPgCode(err);
      if (pgCode === '23503') {
        return errorResponse('Environment deletion is blocked by related records. No local changes were committed. Contact support to review the dependencies.', 409);
      }
      console.error('environment-crud delete failed:', {
        environment_id: action,
        code: pgCode || undefined,
        detail: typeof err === 'object' && err ? (err as PgLikeError).detail : undefined,
        table: typeof err === 'object' && err ? (err as PgLikeError).table : undefined,
        constraint: typeof err === 'object' && err ? (err as PgLikeError).constraint : undefined,
        error: err instanceof Error ? err.message : err,
      });
      throw err;
    }



    return jsonResponse({ message: 'Environment deleted' });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('environment-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
