import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

type AppDeploymentRow = {
  id: string;
  environment_id: string;
  package_name: string;
  display_name: string | null;
  install_type: string;
  managed_config: unknown;
  scope_type: string;
  scope_id: string;
  auto_update_mode: string | null;
  scope_name: string | null;
  created_at: string;
  updated_at: string;
};

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const params = getSearchParams(request);
  const environmentId = params.get('environment_id');
  if (!environmentId) return errorResponse('environment_id is required');
  await requireEnvironmentPermission(auth, environmentId, 'read');

  const env = await queryOne<{ id: string }>(
    'SELECT id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env) return errorResponse('Environment not found', 404);

  const rows = await query<AppDeploymentRow>(
    `SELECT ad.id, ad.environment_id, ad.package_name, ad.display_name, ad.install_type,
            ad.managed_config, ad.scope_type, ad.scope_id, ad.auto_update_mode, ad.created_at, ad.updated_at,
            CASE
              WHEN ad.scope_type = 'environment' THEN env.name
              WHEN ad.scope_type = 'group' THEN g.name
              WHEN ad.scope_type = 'device' THEN COALESCE(
                NULLIF(d.serial_number, ''),
                NULLIF(d.amapi_name, ''),
                NULLIF(CONCAT_WS(' ', NULLIF(d.manufacturer, ''), NULLIF(d.model, '')), ''),
                d.id::text
              )
              ELSE NULL
            END AS scope_name
     FROM app_deployments ad
     JOIN environments env ON env.id = ad.environment_id
     LEFT JOIN groups g ON ad.scope_type = 'group' AND g.id = ad.scope_id
     LEFT JOIN devices d ON ad.scope_type = 'device' AND d.id = ad.scope_id
     WHERE ad.environment_id = $1
     ORDER BY ad.created_at DESC`,
    [environmentId]
  );

    return jsonResponse({
      deployments: rows.map((row) => ({
        ...row,
        managed_config:
          typeof row.managed_config === 'string'
            ? safeParseJson(row.managed_config, {})
            : (row.managed_config ?? {}),
      })),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('app-list error:', err);
    return errorResponse('Internal server error', 500);
  }
};

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
