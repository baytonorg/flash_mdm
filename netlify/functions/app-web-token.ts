import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';

interface WebTokenResponse {
  name: string;
  value: string;
  enabledFeatures?: string[];
  permissions?: string[];
}

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);

    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/apps/', '').split('/').filter(Boolean);
    const action = segments[0];

    if (action !== 'web-token') {
      return errorResponse('Not found', 404);
    }

    const body = await parseJsonBody<{
      environment_id: string;
    }>(request);

    if (!body.environment_id) {
      return errorResponse('environment_id is required');
    }
    await requireEnvironmentPermission(auth, body.environment_id, 'write');

    // Fetch environment + workspace details
    const env = await queryOne<{
      enterprise_name: string;
      workspace_id: string;
    }>(
      'SELECT enterprise_name, workspace_id FROM environments WHERE id = $1',
      [body.environment_id]
    );
    if (!env?.enterprise_name) return errorResponse('Environment not configured with enterprise', 400);

    const ws = await queryOne<{ gcp_project_id: string }>(
      'SELECT gcp_project_id FROM workspaces WHERE id = $1',
      [env.workspace_id]
    );
    if (!ws?.gcp_project_id) return errorResponse('Workspace not configured with GCP project', 400);

    try {
      const webToken = await amapiCall<WebTokenResponse>(
        `${env.enterprise_name}/webTokens`,
        env.workspace_id,
        {
          method: 'POST',
          body: {
            parentFrameUrl: process.env.URL ?? 'https://localhost:8888',
            enabledFeatures: [
              'PLAY_SEARCH',
              'PRIVATE_APPS',
              'WEB_APPS',
              'STORE_BUILDER',
              'MANAGED_CONFIGURATIONS',
            ],
          },
          projectId: ws.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'webTokens',
        }
      );

      await logAudit({
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'app.web_token_created',
        resource_type: 'web_token',
        details: { enterprise: env.enterprise_name },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        token: webToken.value,
        iframeUrl: `https://play.google.com/work/embedded/search?token=${webToken.value}&mode=SELECT`,
      });
    } catch (err) {
      if (err instanceof Response) return err;
      const status = getAmapiErrorHttpStatus(err) ?? 502;
      return errorResponse(
        `Failed to create web token: ${err instanceof Error ? err.message : 'Unknown error'}`,
        status
      );
    }
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (/compute time quota/i.test(message)) {
      return errorResponse(
        'Unable to create web token right now: infrastructure database quota exceeded. Please retry shortly or upgrade capacity.',
        503
      );
    }
    console.error('app-web-token unhandled error:', err);
    return errorResponse('Unable to create web token right now due to an internal error', 500);
  }
};
