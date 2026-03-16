import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

interface AmapiApp {
  name: string;
  title: string;
  iconUrl?: string;
}

function looksLikePackageName(query: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(query);
}

export default async (request: Request, context: Context) => {
  const auth = await requireAuth(request);

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const params = getSearchParams(request);
  const environmentId = params.get('environment_id');
  const queryStr = params.get('query');

  if (!environmentId) return errorResponse('environment_id is required');
  if (!queryStr) return errorResponse('query is required');

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
    // AMAPI does not provide a server-side applications search/list endpoint.
    // Support exact package lookups via applications.get; otherwise instruct the UI to use a web token.
    if (!looksLikePackageName(queryStr.trim())) {
      return jsonResponse({
        apps: [],
        search_mode: 'web_token_required',
        message: 'AMAPI does not support direct application search. Use the managed Play iframe web token flow.',
      });
    }

    try {
      const app = await amapiCall<AmapiApp>(
        `${env.enterprise_name}/applications/${encodeURIComponent(queryStr.trim())}?languageCode=en`,
        env.workspace_id,
        {
          method: 'GET',
          projectId: ws.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'applications',
          resourceId: queryStr.trim(),
        }
      );

      return jsonResponse({
        apps: [{
          package_name: app.name?.split('/').pop() ?? queryStr.trim(),
          title: app.title ?? queryStr.trim(),
          icon_url: app.iconUrl ?? '',
        }],
        search_mode: 'exact_package_lookup',
      });
    } catch (err) {
      if (getAmapiErrorHttpStatus(err) === 404) {
        return jsonResponse({ apps: [], search_mode: 'exact_package_lookup' });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof Response) return err;
    const status = getAmapiErrorHttpStatus(err) ?? 502;
    return errorResponse(
      `Failed to search apps: ${err instanceof Error ? err.message : 'Unknown error'}`,
      status
    );
  }
};
