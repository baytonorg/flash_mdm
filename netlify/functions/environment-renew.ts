import type { Context } from '@netlify/functions';
import { requireAuth } from './_lib/auth.js';
import { queryOne, execute } from './_lib/db.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';

interface RenewBody {
  environment_id: string;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const body = await parseJsonBody<RenewBody>(request);
    const ip = getClientIp(request);

    if (!body.environment_id) {
      return errorResponse('environment_id is required');
    }

    // Get environment with workspace info
    const env = await queryOne<{
      id: string;
      name: string;
      workspace_id: string;
      enterprise_name: string | null;
    }>(
      `SELECT e.id, e.name, e.workspace_id, e.enterprise_name
       FROM environments e
       WHERE e.id = $1`,
      [body.environment_id]
    );

    if (!env) {
      return errorResponse('Environment not found', 404);
    }

    await requireEnvironmentResourcePermission(auth, env.id, 'environment', 'manage_settings');

    if (!env.enterprise_name) {
      return errorResponse('Environment has no enterprise binding');
    }

    // Get workspace for GCP project
    const workspace = await queryOne<{ gcp_project_id: string | null }>(
      `SELECT gcp_project_id FROM workspaces WHERE id = $1`,
      [env.workspace_id]
    );

    if (!workspace?.gcp_project_id) {
      return errorResponse('Workspace has no GCP project configured');
    }

    // Renew by creating a fresh top-level signup URL (same AMAPI flow as initial bind step 1)
    const callbackUrl = `${new URL(request.url).origin}/settings/enterprise/callback?environment_id=${body.environment_id}`;
    const result = await amapiCall<{ name: string; url: string }>(
      `signupUrls?projectId=${encodeURIComponent(workspace.gcp_project_id)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      env.workspace_id,
      {
        method: 'POST',
        projectId: workspace.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'enterprise',
      }
    );

    // Persist the new signup URL name for bind step 2 callback completion
    await execute(
      `UPDATE environments SET signup_url_name = $1, updated_at = now() WHERE id = $2`,
      [result.name, body.environment_id]
    );

    await logAudit({
      workspace_id: env.workspace_id,
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'environment.renewed',
      resource_type: 'environment',
      resource_id: body.environment_id,
      ip_address: ip,
    });

    return jsonResponse({
      message: 'Enterprise signup URL renewed',
      signup_url: result.url,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const amapiStatus = getAmapiErrorHttpStatus(err);
    if (amapiStatus) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Environment renew AMAPI error:', msg);
      return errorResponse(`Failed to renew environment: ${msg}`, amapiStatus);
    }
    console.error('Environment renew error:', err);
    return errorResponse('Internal server error', 500);
  }
}
