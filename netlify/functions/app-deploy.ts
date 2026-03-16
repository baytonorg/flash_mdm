import type { Context } from '@netlify/functions';
import { queryOne, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { syncAffectedPoliciesToAmapi, selectPoliciesForDeploymentScope } from './_lib/deployment-sync.js';
import { AMAPI_APPLICATION_INSTALL_TYPES, isAmapiApplicationInstallType } from './_lib/amapi-application-policy.js';

type DeployBody = {
  environment_id: string;
  package_name: string;
  display_name: string;
  install_type: string;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
  managed_config?: Record<string, unknown>;
  auto_update_mode?: string;
  icon_url?: string;
};

type PolicyRow = {
  id: string;
  config: Record<string, unknown> | string | null;
  amapi_name: string | null;
};

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const segments = url.pathname.replace('/api/apps/', '').split('/').filter(Boolean);
  const action = segments[0];

  if (action !== 'deploy') {
    return errorResponse('Not found', 404);
  }

  const body = await parseJsonBody<DeployBody>(request);

  if (!body.environment_id || !body.package_name || !body.display_name || !body.install_type || !body.scope_type || !body.scope_id) {
    return errorResponse('environment_id, package_name, display_name, install_type, scope_type, and scope_id are required');
  }

  if (!isAmapiApplicationInstallType(body.install_type)) {
    return errorResponse(`install_type must be one of: ${AMAPI_APPLICATION_INSTALL_TYPES.join(', ')}`);
  }

  const validScopeTypes: Array<DeployBody['scope_type']> = ['environment', 'group', 'device'];
  if (!validScopeTypes.includes(body.scope_type)) {
    return errorResponse(`scope_type must be one of: ${validScopeTypes.join(', ')}`);
  }

  // Verify environment exists
  const env = await queryOne<{ id: string; workspace_id: string; enterprise_name: string | null }>(
    'SELECT id, workspace_id, enterprise_name FROM environments WHERE id = $1',
    [body.environment_id]
  );
  if (!env) return errorResponse('Environment not found', 404);
  await requireEnvironmentPermission(auth, body.environment_id, 'write');

  if (body.scope_type === 'environment') {
    if (body.scope_id !== body.environment_id) {
      return errorResponse('For environment scope, scope_id must equal environment_id', 400);
    }
  } else if (body.scope_type === 'group') {
    const group = await queryOne<{ id: string }>(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      [body.scope_id, body.environment_id]
    );
    if (!group) return errorResponse('Group not found in environment', 404);
  } else if (body.scope_type === 'device') {
    const device = await queryOne<{ id: string }>(
      'SELECT id FROM devices WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL',
      [body.scope_id, body.environment_id]
    );
    if (!device) return errorResponse('Device not found in environment', 404);
  }

  // ── Step 1: Upsert app + scope config + legacy deployment ──────────────────
  let appId = '';
  let scopeConfigId = '';
  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    // Upsert the app catalog entry
    const appResult = await client.query<{ id: string }>(
      `INSERT INTO apps (environment_id, package_name, display_name, default_install_type, default_auto_update_mode, default_managed_config, icon_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (environment_id, package_name)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         icon_url = COALESCE(EXCLUDED.icon_url, apps.icon_url),
         updated_at = now()
       RETURNING id`,
      [
        body.environment_id,
        body.package_name,
        body.display_name,
        body.install_type,
        body.auto_update_mode ?? 'AUTO_UPDATE_DEFAULT',
        JSON.stringify(body.managed_config ?? {}),
        body.icon_url ?? null,
      ]
    );
    appId = appResult.rows[0].id;

    // Upsert scope-specific config
    const scopeResult = await client.query<{ id: string }>(
      `INSERT INTO app_scope_configs (app_id, environment_id, scope_type, scope_id, install_type, auto_update_mode, managed_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (app_id, scope_type, scope_id)
       DO UPDATE SET
         install_type     = EXCLUDED.install_type,
         auto_update_mode = EXCLUDED.auto_update_mode,
         managed_config   = EXCLUDED.managed_config,
         updated_at       = now()
       RETURNING id`,
      [
        appId,
        body.environment_id,
        body.scope_type,
        body.scope_id,
        body.install_type,
        body.auto_update_mode ?? 'AUTO_UPDATE_DEFAULT',
        JSON.stringify(body.managed_config ?? {}),
      ]
    );
    scopeConfigId = scopeResult.rows[0].id;

    // Also upsert legacy app_deployments for backward compatibility
    await client.query(
      `INSERT INTO app_deployments (id, environment_id, package_name, display_name, install_type, scope_type, scope_id, managed_config, auto_update_mode)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (environment_id, package_name, scope_type, scope_id)
       DO UPDATE SET
         display_name     = EXCLUDED.display_name,
         install_type     = EXCLUDED.install_type,
         managed_config   = EXCLUDED.managed_config,
         auto_update_mode = EXCLUDED.auto_update_mode,
         updated_at       = now()`,
      [
        body.environment_id,
        body.package_name,
        body.display_name,
        body.install_type,
        body.scope_type,
        body.scope_id,
        JSON.stringify(body.managed_config ?? {}),
        body.auto_update_mode ?? 'AUTO_UPDATE_DEFAULT',
      ]
    );

    // Find base policies affected by this scope
    const policies = await selectPoliciesForDeploymentScope(client, body.environment_id, body.scope_type, body.scope_id);
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }
  });

  // ── Step 2: AMAPI sync via derivative infrastructure ────────────────────
  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds,
    body.environment_id,
    body.scope_type,
    body.scope_id,
  );

  await logAudit({
    environment_id: body.environment_id,
    user_id: auth.user.id,
    action: 'app.deployed',
    resource_type: 'app',
    resource_id: appId,
    details: {
      package_name: body.package_name,
      display_name: body.display_name,
      install_type: body.install_type,
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      scope_config_id: scopeConfigId,
      amapi_synced_policies: syncResult.synced,
      amapi_sync_failed_policies: syncResult.failures.map((f) => f.policy_id),
      amapi_sync_skipped_reason: syncResult.skipped_reason,
    },
    ip_address: getClientIp(request),
  });

  const response: Record<string, unknown> = {
    app: {
      id: appId,
      environment_id: body.environment_id,
      package_name: body.package_name,
      display_name: body.display_name,
    },
    scope_config: {
      id: scopeConfigId,
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      install_type: body.install_type,
      auto_update_mode: body.auto_update_mode ?? 'AUTO_UPDATE_DEFAULT',
    },
  };

  if (affectedPolicyIds.length > 0 || body.scope_type !== 'environment') {
    response.amapi_sync = syncResult;
  }

  if (syncResult.skipped_reason || syncResult.failed > 0) {
    response.message = 'App deployment saved locally, but one or more AMAPI policy updates failed';
  }

    return jsonResponse(response, 201);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('app-deploy error:', err);
    return errorResponse('Internal server error', 500);
  }
};
