import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

interface AmapiAppDetail {
  name: string;
  title: string;
  permissions?: { permissionId: string; name: string; description: string }[];
  managedProperties?: ManagedProperty[];
  appTracks?: { trackId: string; trackAlias: string }[];
  iconUrl?: string;
  description?: string;
  minAndroidSdkVersion?: number;
  updateTime?: string;
  availableCountries?: string[];
}

interface ManagedProperty {
  key: string;
  type: string;
  title: string;
  description?: string;
  defaultValue?: unknown;
  entries?: { name: string; value: string }[];
  nestedProperties?: ManagedProperty[];
}

export default async (request: Request, context: Context) => {
  const auth = await requireAuth(request);

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const packageName = url.pathname.split('/').filter(Boolean).pop();
  const params = getSearchParams(request);
  const environmentId = params.get('environment_id');

  if (!packageName) return errorResponse('package_name is required');
  if (!environmentId) return errorResponse('environment_id is required');

  // Fetch environment + workspace details
  const env = await queryOne<{
    enterprise_name: string;
    workspace_id: string;
  }>(
    'SELECT enterprise_name, workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env?.enterprise_name) return errorResponse('Environment not configured with enterprise', 400);
  await requireEnvironmentPermission(auth, environmentId, 'read');

  const ws = await queryOne<{ gcp_project_id: string }>(
    'SELECT gcp_project_id FROM workspaces WHERE id = $1',
    [env.workspace_id]
  );
  if (!ws?.gcp_project_id) return errorResponse('Workspace not configured with GCP project', 400);

  try {
    const app = await amapiCall<AmapiAppDetail>(
      `${env.enterprise_name}/applications/${packageName}?languageCode=en`,
      env.workspace_id,
      {
        method: 'GET',
        projectId: ws.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'applications',
        resourceId: packageName,
      }
    );

    return jsonResponse({
      app: {
        package_name: packageName,
        title: app.title ?? packageName,
        description: app.description ?? '',
        icon_url: app.iconUrl ?? '',
        permissions: app.permissions ?? [],
        managed_properties: app.managedProperties ?? [],
        app_tracks: app.appTracks ?? [],
        min_android_sdk: app.minAndroidSdkVersion,
        update_time: app.updateTime,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const status = getAmapiErrorHttpStatus(err) ?? 502;
    return errorResponse(
      `Failed to fetch app details: ${err instanceof Error ? err.message : 'Unknown error'}`,
      status
    );
  }
};
