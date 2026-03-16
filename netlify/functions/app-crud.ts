import type { Context } from '@netlify/functions';
import { query, queryOne, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp } from './_lib/helpers.js';
import { syncAffectedPoliciesToAmapi, selectPoliciesForDeploymentScope } from './_lib/deployment-sync.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import {
  AMAPI_APPLICATION_INSTALL_TYPES,
  isAmapiApplicationInstallType,
  validateAmapiApplicationPolicyFragment,
} from './_lib/amapi-application-policy.js';
import { mergeHydratedAppMetadata, needsAppMetadataHydration } from './_lib/app-metadata-cache.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type AppRow = {
  id: string;
  environment_id: string;
  package_name: string;
  display_name: string;
  default_install_type: string;
  default_auto_update_mode: string;
  default_managed_config: Record<string, unknown> | string | null;
  icon_url: string | null;
  created_at: string;
  updated_at: string;
};

type ScopeConfigRow = {
  id: string;
  app_id: string;
  environment_id: string;
  scope_type: string;
  scope_id: string;
  install_type: string | null;
  auto_update_mode: string | null;
  managed_config: Record<string, unknown> | string | null;
  app_policy: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
};

type PolicyRow = {
  id: string;
  config: Record<string, unknown> | string | null;
  amapi_name: string | null;
};

// Legacy type for backward compatibility
type LegacyDeploymentRow = {
  id: string;
  environment_id: string;
  package_name: string;
  display_name: string;
  install_type: string;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
  managed_config: Record<string, unknown> | string | null;
  auto_update_mode: string;
  created_at: string;
  updated_at: string;
};

type AmapiAppDetailLite = {
  title?: string;
  iconUrl?: string;
};

type AmapiAppMetadataContext = {
  workspace_id: string;
  enterprise_name: string;
  gcp_project_id: string;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return (value as Record<string, unknown>) ?? {};
}

function validateInstallTypeField(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isAmapiApplicationInstallType(value)) {
    return `${fieldName} must be one of: ${AMAPI_APPLICATION_INSTALL_TYPES.join(', ')}`;
  }
  return null;
}

function validateAppPolicyField(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'app_policy must be a JSON object';
  }
  const errors = validateAmapiApplicationPolicyFragment(value);
  return errors.length ? errors.join('; ') : null;
}

async function getAmapiAppMetadataContext(environmentId: string): Promise<AmapiAppMetadataContext | null> {
  return queryOne<AmapiAppMetadataContext>(
    `SELECT e.workspace_id, e.enterprise_name, w.gcp_project_id
     FROM environments e
     JOIN workspaces w ON w.id = e.workspace_id
     WHERE e.id = $1`,
    [environmentId]
  );
}

async function fetchAmapiAppMetadata(
  ctx: AmapiAppMetadataContext,
  packageName: string,
): Promise<{ title: string | null; icon_url: string | null } | null> {
  try {
    const app = await amapiCall<AmapiAppDetailLite>(
      `${ctx.enterprise_name}/applications/${packageName}?languageCode=en`,
      ctx.workspace_id,
      {
        method: 'GET',
        projectId: ctx.gcp_project_id,
        enterpriseName: ctx.enterprise_name,
        resourceType: 'applications',
        resourceId: packageName,
      }
    );
    return {
      title: app?.title?.trim() || null,
      icon_url: app?.iconUrl?.trim() || null,
    };
  } catch (err) {
    const status = getAmapiErrorHttpStatus(err);
    if (status === 404) return null;
    console.warn('app metadata hydrate failed:', packageName, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function hydrateAppMetadataCache(
  app: AppRow,
  ctx: AmapiAppMetadataContext | null,
): Promise<AppRow> {
  if (!ctx || !ctx.enterprise_name || !ctx.gcp_project_id || !needsAppMetadataHydration(app)) {
    return app;
  }

  const meta = await fetchAmapiAppMetadata(ctx, app.package_name);
  if (!meta) return app;
  const merged = mergeHydratedAppMetadata(app, meta);
  const nextDisplayName = merged.display_name;
  const nextIconUrl = merged.icon_url;

  if (nextDisplayName === app.display_name && nextIconUrl === app.icon_url) {
    return app;
  }

  const updated = await queryOne<AppRow>(
    `UPDATE apps
     SET display_name = $1,
         icon_url = $2,
         updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [nextDisplayName, nextIconUrl, app.id]
  );
  return updated ?? { ...app, display_name: nextDisplayName, icon_url: nextIconUrl };
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async (request: Request, _context: Context) => {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/apps\//, '');
    const segments = path.split('/').filter(Boolean);

  // Routes:
  // GET/PUT/DELETE /api/apps/deployments/:id  → legacy CRUD (backward compat)
  // GET    /api/apps/catalog?environment_id=  → list imported apps
  // POST   /api/apps/import                   → import an app (create catalog entry)
  // GET    /api/apps/:id                      → get app with scope configs
  // PUT    /api/apps/:id                      → update app defaults
  // DELETE /api/apps/:id                      → delete app entirely
  // POST   /api/apps/:id/configs              → add scope config
  // PUT    /api/apps/:id/configs/:configId    → update scope config
  // DELETE /api/apps/:id/configs/:configId    → delete scope config

  // Legacy route: /api/apps/deployments/:id
  if (segments[0] === 'deployments' && segments[1]) {
    if (request.method === 'GET') return await handleLegacyGet(request, segments[1]);
    if (request.method === 'PUT') return await handleLegacyUpdate(request, segments[1]);
    if (request.method === 'DELETE') return await handleLegacyDelete(request, segments[1]);
    return errorResponse('Method not allowed', 405);
  }

  // New routes
  if (segments[0] === 'catalog' && request.method === 'GET') {
    return await handleCatalog(request);
  }

  if (segments[0] === 'import' && request.method === 'POST') {
    return await handleImport(request);
  }

  if (segments[0] && segments[1] === 'configs') {
    const appId = segments[0];
    const configId = segments[2];
    if (request.method === 'POST' && !configId) return await handleAddScopeConfig(request, appId);
    if (request.method === 'PUT' && configId) return await handleUpdateScopeConfig(request, appId, configId);
    if (request.method === 'DELETE' && configId) return await handleDeleteScopeConfig(request, appId, configId);
    return errorResponse('Method not allowed', 405);
  }

  if (segments[0] && !segments[1]) {
    const idOrPackage = segments[0];
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrPackage);

    if (isUuid) {
      // New model: app CRUD by UUID
      if (request.method === 'GET') return await handleGetApp(request, idOrPackage);
      if (request.method === 'PUT') return await handleUpdateApp(request, idOrPackage);
      if (request.method === 'DELETE') return await handleDeleteApp(request, idOrPackage);
      return errorResponse('Method not allowed', 405);
    }

    // Package name: proxy to app-details function
    // (Re-fetch the URL to pass to app-details handler)
    if (request.method === 'GET') {
      // Forward to app-details via dynamic import
      const appDetails = await import('./app-details.js');
      return await appDetails.default(request, {} as any);
    }
    return errorResponse('Method not allowed', 405);
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('app-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};

// ── New API: Catalog ──────────────────────────────────────────────────────────

async function handleCatalog(request: Request) {
  const auth = await requireAuth(request);
  const params = getSearchParams(request);
  const environmentId = params.get('environment_id');
  if (!environmentId) return errorResponse('environment_id is required');

  await requireEnvironmentPermission(auth, environmentId, 'read');

  const apps = await query<AppRow & { scope_configs_count: number }>(
    `SELECT a.*,
            (SELECT COUNT(*)::int FROM app_scope_configs asc2 WHERE asc2.app_id = a.id) AS scope_configs_count
     FROM apps a
     WHERE a.environment_id = $1
     ORDER BY a.display_name ASC, a.created_at DESC`,
    [environmentId]
  );

  const metadataCtx = apps.some((a) => needsAppMetadataHydration(a))
    ? await getAmapiAppMetadataContext(environmentId)
    : null;
  const hydratedApps = await Promise.all(
    apps.map(async (a) => {
      const hydrated = await hydrateAppMetadataCache(a, metadataCtx);
      return {
        ...hydrated,
        scope_configs_count: a.scope_configs_count,
      };
    })
  );

  return jsonResponse({
    apps: hydratedApps.map((a) => ({
      id: a.id,
      environment_id: a.environment_id,
      package_name: a.package_name,
      display_name: a.display_name,
      default_install_type: a.default_install_type,
      default_auto_update_mode: a.default_auto_update_mode,
      default_managed_config: parseJson(a.default_managed_config),
      icon_url: a.icon_url,
      scope_configs_count: a.scope_configs_count,
      created_at: a.created_at,
      updated_at: a.updated_at,
    })),
  });
}

// ── New API: Import ───────────────────────────────────────────────────────────

async function handleImport(request: Request) {
  const auth = await requireAuth(request);
  const body = await parseJsonBody<{
    environment_id: string;
    package_name: string;
    display_name: string;
    default_install_type?: string;
    default_auto_update_mode?: string;
    default_managed_config?: Record<string, unknown>;
    icon_url?: string;
  }>(request);

  if (!body.environment_id || !body.package_name || !body.display_name) {
    return errorResponse('environment_id, package_name, and display_name are required');
  }

  const defaultInstallTypeError = validateInstallTypeField(body.default_install_type, 'default_install_type');
  if (defaultInstallTypeError) return errorResponse(defaultInstallTypeError);

  await requireEnvironmentPermission(auth, body.environment_id, 'write');

  const app = await queryOne<AppRow>(
    `INSERT INTO apps (environment_id, package_name, display_name, default_install_type, default_auto_update_mode, default_managed_config, icon_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (environment_id, package_name) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       icon_url = COALESCE(EXCLUDED.icon_url, apps.icon_url),
       updated_at = now()
     RETURNING *`,
    [
      body.environment_id,
      body.package_name,
      body.display_name,
      body.default_install_type ?? 'AVAILABLE',
      body.default_auto_update_mode ?? 'AUTO_UPDATE_DEFAULT',
      JSON.stringify(body.default_managed_config ?? {}),
      body.icon_url ?? null,
    ]
  );

  await logAudit({
    environment_id: body.environment_id,
    user_id: auth.user.id,
    action: 'app.imported',
    resource_type: 'app',
    resource_id: app!.id,
    details: { package_name: body.package_name, display_name: body.display_name },
    ip_address: getClientIp(request),
  });

  return jsonResponse({ app: { ...app, default_managed_config: parseJson(app?.default_managed_config) } }, 201);
}

// ── New API: Get App with configs ─────────────────────────────────────────────

async function handleGetApp(request: Request, appId: string) {
  const auth = await requireAuth(request);

  let app = await queryOne<AppRow>('SELECT * FROM apps WHERE id = $1', [appId]);
  if (!app) return errorResponse('App not found', 404);

  await requireEnvironmentPermission(auth, app.environment_id, 'read');
  app = await hydrateAppMetadataCache(
    app,
    needsAppMetadataHydration(app) ? await getAmapiAppMetadataContext(app.environment_id) : null
  );

  const scopeConfigs = await query<ScopeConfigRow & { scope_name: string | null }>(
    `SELECT asc1.*,
            CASE
              WHEN asc1.scope_type = 'environment' THEN (SELECT name FROM environments WHERE id = asc1.scope_id)
              WHEN asc1.scope_type = 'group' THEN (SELECT name FROM groups WHERE id = asc1.scope_id)
              WHEN asc1.scope_type = 'device' THEN COALESCE(
                (SELECT serial_number FROM devices WHERE id = asc1.scope_id),
                asc1.scope_id::text
              )
            END AS scope_name
     FROM app_scope_configs asc1
     WHERE asc1.app_id = $1
     ORDER BY asc1.scope_type, asc1.created_at ASC`,
    [appId]
  );

  return jsonResponse({
    app: {
      ...app,
      default_managed_config: parseJson(app.default_managed_config),
    },
    scope_configs: scopeConfigs.map((sc) => ({
      ...sc,
      managed_config: sc.managed_config ? parseJson(sc.managed_config) : null,
      app_policy: sc.app_policy ? parseJson(sc.app_policy) : null,
    })),
  });
}

// ── New API: Update App defaults ──────────────────────────────────────────────

async function handleUpdateApp(request: Request, appId: string) {
  const auth = await requireAuth(request);

  const app = await queryOne<AppRow>('SELECT * FROM apps WHERE id = $1', [appId]);
  if (!app) return errorResponse('App not found', 404);

  await requireEnvironmentPermission(auth, app.environment_id, 'write');

  const body = await parseJsonBody<{
    display_name?: string;
    default_install_type?: string;
    default_auto_update_mode?: string;
    default_managed_config?: Record<string, unknown>;
    icon_url?: string;
  }>(request);

  const defaultInstallTypeError = validateInstallTypeField(body.default_install_type, 'default_install_type');
  if (defaultInstallTypeError) return errorResponse(defaultInstallTypeError);

  const updated = await queryOne<AppRow>(
    `UPDATE apps SET
       display_name = COALESCE($1, display_name),
       default_install_type = COALESCE($2, default_install_type),
       default_auto_update_mode = COALESCE($3, default_auto_update_mode),
       default_managed_config = COALESCE($4, default_managed_config),
       icon_url = COALESCE($5, icon_url),
       updated_at = now()
     WHERE id = $6
     RETURNING *`,
    [
      body.display_name ?? null,
      body.default_install_type ?? null,
      body.default_auto_update_mode ?? null,
      body.default_managed_config ? JSON.stringify(body.default_managed_config) : null,
      body.icon_url ?? null,
      appId,
    ]
  );

  const affectedPolicies = await query<PolicyRow>(
    'SELECT id, config, amapi_name FROM policies WHERE environment_id = $1',
    [app.environment_id]
  );
  const affectedPolicyIds = affectedPolicies.map((row) => row.id);
  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds,
    app.environment_id,
    'environment',
    app.environment_id
  );

  return jsonResponse({
    app: { ...updated, default_managed_config: parseJson(updated?.default_managed_config) },
    amapi_sync: syncResult,
  });
}

// ── New API: Delete App ───────────────────────────────────────────────────────

async function handleDeleteApp(request: Request, appId: string) {
  const auth = await requireAuth(request);

  const app = await queryOne<AppRow>('SELECT * FROM apps WHERE id = $1', [appId]);
  if (!app) return errorResponse('App not found', 404);

  await requireEnvironmentPermission(auth, app.environment_id, 'write');

  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    // Find all affected policies before deletion
    const policies = await selectPoliciesForDeploymentScope(
      client, app.environment_id, 'environment', app.environment_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }

    // Delete app (cascades to app_scope_configs)
    await client.query('DELETE FROM apps WHERE id = $1', [appId]);

    // Also delete legacy deployments
    await client.query(
      'DELETE FROM app_deployments WHERE environment_id = $1 AND package_name = $2',
      [app.environment_id, app.package_name]
    );
  });

  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds, app.environment_id, 'environment', app.environment_id
  );

  await logAudit({
    user_id: auth.user.id,
    environment_id: app.environment_id,
    action: 'app.deleted',
    resource_type: 'app',
    resource_id: appId,
    details: { package_name: app.package_name, display_name: app.display_name },
    ip_address: getClientIp(request),
  });

  return jsonResponse({
    message: 'App deleted',
    app: { id: app.id, package_name: app.package_name },
    amapi_sync: syncResult,
  });
}

// ── New API: Add scope config ─────────────────────────────────────────────────

async function handleAddScopeConfig(request: Request, appId: string) {
  const auth = await requireAuth(request);

  const app = await queryOne<AppRow>('SELECT * FROM apps WHERE id = $1', [appId]);
  if (!app) return errorResponse('App not found', 404);

  await requireEnvironmentPermission(auth, app.environment_id, 'write');

  const body = await parseJsonBody<{
    scope_type: 'environment' | 'group' | 'device';
    scope_id: string;
    install_type?: string;
    auto_update_mode?: string;
    managed_config?: Record<string, unknown>;
    app_policy?: Record<string, unknown>;
  }>(request);

  if (!body.scope_type || !body.scope_id) {
    return errorResponse('scope_type and scope_id are required');
  }

  const installTypeError = validateInstallTypeField(body.install_type, 'install_type');
  if (installTypeError) return errorResponse(installTypeError);
  const appPolicyError = validateAppPolicyField(body.app_policy);
  if (appPolicyError) return errorResponse(appPolicyError);

  const affectedPolicyIds: string[] = [];

  let scopeConfig: ScopeConfigRow | undefined;
  await transaction(async (client) => {
    const result = await client.query<ScopeConfigRow>(
      `INSERT INTO app_scope_configs (app_id, environment_id, scope_type, scope_id, install_type, auto_update_mode, managed_config, app_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (app_id, scope_type, scope_id) DO UPDATE SET
         install_type = EXCLUDED.install_type,
         auto_update_mode = EXCLUDED.auto_update_mode,
         managed_config = EXCLUDED.managed_config,
         app_policy = EXCLUDED.app_policy,
         updated_at = now()
       RETURNING *`,
      [
        appId,
        app.environment_id,
        body.scope_type,
        body.scope_id,
        body.install_type ?? null,
        body.auto_update_mode ?? null,
        body.managed_config ? JSON.stringify(body.managed_config) : null,
        body.app_policy ? JSON.stringify(body.app_policy) : null,
      ]
    );
    scopeConfig = result.rows[0];

    // Also sync legacy table
    await client.query(
      `INSERT INTO app_deployments (id, environment_id, package_name, display_name, install_type, scope_type, scope_id, managed_config, auto_update_mode)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (environment_id, package_name, scope_type, scope_id)
       DO UPDATE SET
         install_type = EXCLUDED.install_type,
         managed_config = EXCLUDED.managed_config,
         auto_update_mode = EXCLUDED.auto_update_mode,
         updated_at = now()`,
      [
        app.environment_id,
        app.package_name,
        app.display_name,
        body.install_type ?? app.default_install_type,
        body.scope_type,
        body.scope_id,
        JSON.stringify(body.managed_config ?? {}),
        body.auto_update_mode ?? app.default_auto_update_mode,
      ]
    );

    const policies = await selectPoliciesForDeploymentScope(
      client, app.environment_id, body.scope_type, body.scope_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }
  });

  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds, app.environment_id, body.scope_type, body.scope_id
  );

  return jsonResponse({
    scope_config: {
      ...scopeConfig,
      managed_config: scopeConfig?.managed_config ? parseJson(scopeConfig.managed_config) : null,
      app_policy: scopeConfig?.app_policy ? parseJson(scopeConfig.app_policy) : null,
    },
    amapi_sync: syncResult,
  }, 201);
}

// ── New API: Update scope config ──────────────────────────────────────────────

async function handleUpdateScopeConfig(request: Request, appId: string, configId: string) {
  const auth = await requireAuth(request);

  const app = await queryOne<AppRow>('SELECT * FROM apps WHERE id = $1', [appId]);
  if (!app) return errorResponse('App not found', 404);

  const existing = await queryOne<ScopeConfigRow>(
    'SELECT * FROM app_scope_configs WHERE id = $1 AND app_id = $2',
    [configId, appId]
  );
  if (!existing) return errorResponse('Scope config not found', 404);

  await requireEnvironmentPermission(auth, app.environment_id, 'write');

  const body = await parseJsonBody<{
    install_type?: string;
    auto_update_mode?: string;
    managed_config?: Record<string, unknown>;
    app_policy?: Record<string, unknown>;
  }>(request);

  const installTypeError = validateInstallTypeField(body.install_type, 'install_type');
  if (installTypeError) return errorResponse(installTypeError);
  const appPolicyError = validateAppPolicyField(body.app_policy);
  if (appPolicyError) return errorResponse(appPolicyError);

  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    await client.query(
      `UPDATE app_scope_configs SET
         install_type = COALESCE($1, install_type),
         auto_update_mode = COALESCE($2, auto_update_mode),
         managed_config = COALESCE($3, managed_config),
         app_policy = COALESCE($4, app_policy),
         updated_at = now()
       WHERE id = $5`,
      [
        body.install_type ?? null,
        body.auto_update_mode ?? null,
        body.managed_config ? JSON.stringify(body.managed_config) : null,
        body.app_policy ? JSON.stringify(body.app_policy) : null,
        configId,
      ]
    );

    // Sync legacy table
    await client.query(
      `UPDATE app_deployments SET
         install_type = COALESCE($1, install_type),
         auto_update_mode = COALESCE($2, auto_update_mode),
         managed_config = COALESCE($3, managed_config),
         updated_at = now()
       WHERE environment_id = $4 AND package_name = $5 AND scope_type = $6 AND scope_id = $7`,
      [
        body.install_type ?? null,
        body.auto_update_mode ?? null,
        body.managed_config ? JSON.stringify(body.managed_config) : null,
        app.environment_id,
        app.package_name,
        existing.scope_type,
        existing.scope_id,
      ]
    );

    const policies = await selectPoliciesForDeploymentScope(
      client, app.environment_id, existing.scope_type, existing.scope_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }
  });

  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds, app.environment_id, existing.scope_type, existing.scope_id
  );

  const refreshed = await queryOne<ScopeConfigRow>(
    'SELECT * FROM app_scope_configs WHERE id = $1',
    [configId]
  );

  return jsonResponse({
    scope_config: {
      ...refreshed,
      managed_config: refreshed?.managed_config ? parseJson(refreshed.managed_config) : null,
      app_policy: refreshed?.app_policy ? parseJson(refreshed.app_policy) : null,
    },
    amapi_sync: syncResult,
  });
}

// ── New API: Delete scope config ──────────────────────────────────────────────

async function handleDeleteScopeConfig(request: Request, appId: string, configId: string) {
  const auth = await requireAuth(request);

  const app = await queryOne<AppRow>('SELECT * FROM apps WHERE id = $1', [appId]);
  if (!app) return errorResponse('App not found', 404);

  const existing = await queryOne<ScopeConfigRow>(
    'SELECT * FROM app_scope_configs WHERE id = $1 AND app_id = $2',
    [configId, appId]
  );
  if (!existing) return errorResponse('Scope config not found', 404);

  await requireEnvironmentPermission(auth, app.environment_id, 'write');

  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    const policies = await selectPoliciesForDeploymentScope(
      client, app.environment_id, existing.scope_type, existing.scope_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }

    await client.query('DELETE FROM app_scope_configs WHERE id = $1', [configId]);

    // Sync legacy table
    await client.query(
      'DELETE FROM app_deployments WHERE environment_id = $1 AND package_name = $2 AND scope_type = $3 AND scope_id = $4',
      [app.environment_id, app.package_name, existing.scope_type, existing.scope_id]
    );
  });

  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds, app.environment_id, existing.scope_type, existing.scope_id
  );

  await logAudit({
    user_id: auth.user.id,
    environment_id: app.environment_id,
    action: 'app.scope_config_deleted',
    resource_type: 'app_scope_config',
    resource_id: configId,
    details: {
      app_id: appId,
      package_name: app.package_name,
      scope_type: existing.scope_type,
      scope_id: existing.scope_id,
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({
    message: 'Scope config deleted',
    amapi_sync: syncResult,
  });
}

// ── Legacy CRUD (backward compatibility) ──────────────────────────────────────

async function handleLegacyGet(request: Request, deploymentId: string) {
  const auth = await requireAuth(request);

  const deployment = await queryOne<LegacyDeploymentRow>(
    'SELECT * FROM app_deployments WHERE id = $1',
    [deploymentId]
  );
  if (!deployment) return errorResponse('App deployment not found', 404);

  await requireEnvironmentPermission(auth, deployment.environment_id, 'read');

  return jsonResponse({
    deployment: {
      ...deployment,
      managed_config: parseJson(deployment.managed_config),
    },
  });
}

async function handleLegacyUpdate(request: Request, deploymentId: string) {
  const auth = await requireAuth(request);

  const existing = await queryOne<LegacyDeploymentRow>(
    'SELECT * FROM app_deployments WHERE id = $1',
    [deploymentId]
  );
  if (!existing) return errorResponse('App deployment not found', 404);

  await requireEnvironmentPermission(auth, existing.environment_id, 'write');

  const body = await parseJsonBody<{
    install_type?: string;
    auto_update_mode?: string;
    managed_config?: Record<string, unknown>;
  }>(request);

  const installTypeError = validateInstallTypeField(body.install_type, 'install_type');
  if (installTypeError) return errorResponse(installTypeError);

  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    await client.query(
      `UPDATE app_deployments SET
         install_type     = COALESCE($1, install_type),
         auto_update_mode = COALESCE($2, auto_update_mode),
         managed_config   = COALESCE($3, managed_config),
         updated_at       = now()
       WHERE id = $4`,
      [
        body.install_type ?? null,
        body.auto_update_mode ?? null,
        body.managed_config ? JSON.stringify(body.managed_config) : null,
        deploymentId,
      ]
    );

    // Also update new tables
    await client.query(
      `UPDATE app_scope_configs SET
         install_type = COALESCE($1, install_type),
         auto_update_mode = COALESCE($2, auto_update_mode),
         managed_config = COALESCE($3, managed_config),
         updated_at = now()
       WHERE environment_id = $4
         AND scope_type = $5 AND scope_id = $6
         AND app_id IN (SELECT id FROM apps WHERE environment_id = $4 AND package_name = $7)`,
      [
        body.install_type ?? null,
        body.auto_update_mode ?? null,
        body.managed_config ? JSON.stringify(body.managed_config) : null,
        existing.environment_id,
        existing.scope_type,
        existing.scope_id,
        existing.package_name,
      ]
    );

    const policies = await selectPoliciesForDeploymentScope(
      client, existing.environment_id, existing.scope_type, existing.scope_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }
  });

  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds, existing.environment_id, existing.scope_type, existing.scope_id
  );

  const refreshed = await queryOne<LegacyDeploymentRow>(
    'SELECT * FROM app_deployments WHERE id = $1',
    [deploymentId]
  );

  await logAudit({
    user_id: auth.user.id,
    environment_id: existing.environment_id,
    action: 'app.deployment_updated',
    resource_type: 'app_deployment',
    resource_id: deploymentId,
    details: {
      package_name: existing.package_name,
      install_type: body.install_type,
      scope_type: existing.scope_type,
      scope_id: existing.scope_id,
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({
    deployment: { ...refreshed, managed_config: parseJson(refreshed?.managed_config) },
    amapi_sync: syncResult,
  });
}

async function handleLegacyDelete(request: Request, deploymentId: string) {
  const auth = await requireAuth(request);

  const deployment = await queryOne<LegacyDeploymentRow>(
    'SELECT * FROM app_deployments WHERE id = $1',
    [deploymentId]
  );
  if (!deployment) return errorResponse('App deployment not found', 404);

  await requireEnvironmentPermission(auth, deployment.environment_id, 'write');

  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    const policies = await selectPoliciesForDeploymentScope(
      client, deployment.environment_id, deployment.scope_type, deployment.scope_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }

    await client.query('DELETE FROM app_deployments WHERE id = $1', [deploymentId]);

    // Also delete from new tables
    await client.query(
      `DELETE FROM app_scope_configs
       WHERE environment_id = $1 AND scope_type = $2 AND scope_id = $3
         AND app_id IN (SELECT id FROM apps WHERE environment_id = $1 AND package_name = $4)`,
      [deployment.environment_id, deployment.scope_type, deployment.scope_id, deployment.package_name]
    );
  });

  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds, deployment.environment_id, deployment.scope_type, deployment.scope_id
  );

  await logAudit({
    user_id: auth.user.id,
    environment_id: deployment.environment_id,
    action: 'app.deployment_deleted',
    resource_type: 'app_deployment',
    resource_id: deploymentId,
    details: {
      package_name: deployment.package_name,
      display_name: deployment.display_name,
      scope_type: deployment.scope_type,
      scope_id: deployment.scope_id,
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({
    message: 'App deployment deleted',
    deployment: {
      id: deployment.id,
      package_name: deployment.package_name,
      display_name: deployment.display_name,
      scope_type: deployment.scope_type,
      scope_id: deployment.scope_id,
    },
    amapi_sync: syncResult,
  });
}
