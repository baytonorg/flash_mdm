import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission, requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { amapiCall } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp } from './_lib/helpers.js';

// --- Interfaces ---

interface SigninConfig {
  id: string;
  environment_id: string;
  enabled: boolean;
  allowed_domains: string[];
  default_group_id: string | null;
  allow_personal_usage: string;
  token_tag: string | null;
  amapi_signin_enrollment_token: string | null;
  amapi_qr_code: string | null;
  created_at: string;
  updated_at: string;
}

interface AmapiSigninDetail {
  signinUrl?: string;
  signinEnrollmentToken?: string;
  qrCode?: string;
  allowPersonalUsage?: string;
  defaultStatus?: string;
  tokenTag?: string;
}

// --- Helper: Sync signinDetails to AMAPI enterprise ---

export async function syncSigninDetailsToAmapi(environmentId: string): Promise<void> {
  const env = await queryOne<{
    enterprise_name: string | null;
    workspace_id: string;
  }>(
    'SELECT enterprise_name, workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env?.enterprise_name) return; // Not bound — nothing to sync

  const workspace = await queryOne<{ gcp_project_id: string | null }>(
    'SELECT gcp_project_id FROM workspaces WHERE id = $1',
    [env.workspace_id]
  );
  if (!workspace?.gcp_project_id) return;

  const config = await queryOne<SigninConfig>(
    'SELECT * FROM signin_configurations WHERE environment_id = $1',
    [environmentId]
  );

  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://localhost:8888';

  let signinDetails: AmapiSigninDetail[] = [];
  if (config?.enabled) {
    signinDetails = [{
      signinUrl: `${baseUrl}/signin/enroll`,
      allowPersonalUsage: config.allow_personal_usage === 'PERSONAL_USAGE_DISALLOWED'
        ? 'PERSONAL_USAGE_DISALLOWED'
        : 'PERSONAL_USAGE_ALLOWED',
      defaultStatus: 'SIGNIN_DETAIL_IS_DEFAULT',
      ...(config.token_tag ? { tokenTag: config.token_tag } : {}),
    }];
  }

  try {
    const result = await amapiCall<{
      name: string;
      signinDetails?: AmapiSigninDetail[];
    }>(
      `${env.enterprise_name}?updateMask=signinDetails`,
      env.workspace_id,
      {
        method: 'PATCH',
        body: { signinDetails },
        projectId: workspace.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'enterprises',
        resourceId: env.enterprise_name.split('/').pop(),
      }
    );

    // Store the AMAPI-returned token and QR code
    const returnedDetail = result.signinDetails?.[0];
    if (config && returnedDetail) {
      await execute(
        `UPDATE signin_configurations
         SET amapi_signin_enrollment_token = $1, amapi_qr_code = $2, updated_at = now()
         WHERE id = $3`,
        [
          returnedDetail.signinEnrollmentToken ?? null,
          returnedDetail.qrCode ?? null,
          config.id,
        ]
      );
    } else if (config && !returnedDetail) {
      // Cleared — reset stored values
      await execute(
        `UPDATE signin_configurations
         SET amapi_signin_enrollment_token = NULL, amapi_qr_code = NULL, updated_at = now()
         WHERE id = $1`,
        [config.id]
      );
    }
  } catch (err) {
    console.error(
      'syncSigninDetailsToAmapi failed:',
      err instanceof Error ? err.message : err
    );
    throw err;
  }
}

// --- Handler ---

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);

    // GET — read config
    if (request.method === 'GET') {
      const params = getSearchParams(request);
      const environmentId = params.get('environment_id');
      if (!environmentId) return errorResponse('environment_id is required');

      await requireEnvironmentPermission(auth, environmentId, 'read');

      const config = await queryOne<SigninConfig>(
        'SELECT * FROM signin_configurations WHERE environment_id = $1',
        [environmentId]
      );

      return jsonResponse({
        config: config ?? {
          environment_id: environmentId,
          enabled: false,
          allowed_domains: [],
          default_group_id: null,
          allow_personal_usage: 'PERSONAL_USAGE_ALLOWED',
          token_tag: null,
          amapi_signin_enrollment_token: null,
          amapi_qr_code: null,
        },
      });
    }

    // PUT — create or update config
    if (request.method === 'PUT') {
      const body = await parseJsonBody<{
        environment_id: string;
        enabled: boolean;
        allowed_domains: string[];
        default_group_id?: string | null;
        allow_personal_usage?: string;
        token_tag?: string | null;
      }>(request);

      if (!body.environment_id) return errorResponse('environment_id is required');
      await requireEnvironmentResourcePermission(auth, body.environment_id, 'environment', 'manage_settings');

      // Validate environment is bound
      const env = await queryOne<{ enterprise_name: string | null }>(
        'SELECT enterprise_name FROM environments WHERE id = $1',
        [body.environment_id]
      );
      if (!env) return errorResponse('Environment not found', 404);
      if (!env.enterprise_name && body.enabled) {
        return errorResponse('Cannot enable sign-in enrolment: environment is not bound to an enterprise', 400);
      }

      // Validate allowed_domains
      const domains = (body.allowed_domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean);
      if (body.enabled && domains.length === 0) {
        return errorResponse('At least one allowed email domain is required when enabling sign-in enrolment');
      }

      // Validate domain format
      for (const domain of domains) {
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
          return errorResponse(`Invalid domain format: ${domain}`);
        }
      }

      // Validate default_group_id if provided
      if (body.default_group_id) {
        const group = await queryOne<{ id: string }>(
          'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
          [body.default_group_id, body.environment_id]
        );
        if (!group) return errorResponse('Default group not found in this environment', 404);
      }

      const allowPersonalUsage = body.allow_personal_usage === 'PERSONAL_USAGE_DISALLOWED'
        ? 'PERSONAL_USAGE_DISALLOWED'
        : 'PERSONAL_USAGE_ALLOWED';

      // Upsert
      await execute(
        `INSERT INTO signin_configurations
           (id, environment_id, enabled, allowed_domains, default_group_id,
            allow_personal_usage, token_tag)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (environment_id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           allowed_domains = EXCLUDED.allowed_domains,
           default_group_id = EXCLUDED.default_group_id,
           allow_personal_usage = EXCLUDED.allow_personal_usage,
           token_tag = EXCLUDED.token_tag,
           updated_at = now()`,
        [
          body.environment_id,
          body.enabled,
          domains,
          body.default_group_id || null,
          allowPersonalUsage,
          body.token_tag ?? null,
        ]
      );

      // Sync to AMAPI if enterprise is bound
      if (env.enterprise_name) {
        try {
          await syncSigninDetailsToAmapi(body.environment_id);
        } catch (err) {
          console.warn('Failed to sync signinDetails to AMAPI:', err instanceof Error ? err.message : err);
          // Don't fail the request — config is saved locally, AMAPI sync can be retried
        }
      }

      // Re-fetch to return updated config
      const updated = await queryOne<SigninConfig>(
        'SELECT * FROM signin_configurations WHERE environment_id = $1',
        [body.environment_id]
      );

      await logAudit({
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'signin_config.updated',
        resource_type: 'signin_configuration',
        resource_id: updated?.id ?? null,
        details: {
          enabled: body.enabled,
          allowed_domains: domains,
          default_group_id: body.default_group_id ?? null,
          allow_personal_usage: allowPersonalUsage,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ config: updated });
    }

    // DELETE — remove config
    if (request.method === 'DELETE') {
      const params = getSearchParams(request);
      const environmentId = params.get('environment_id');
      if (!environmentId) return errorResponse('environment_id is required');

      await requireEnvironmentResourcePermission(auth, environmentId, 'environment', 'manage_settings');

      // Disable first (removes signinDetails from AMAPI)
      await execute(
        `UPDATE signin_configurations SET enabled = false, updated_at = now()
         WHERE environment_id = $1`,
        [environmentId]
      );

      try {
        await syncSigninDetailsToAmapi(environmentId);
      } catch {
        // Best-effort AMAPI cleanup
      }

      await execute(
        'DELETE FROM signin_configurations WHERE environment_id = $1',
        [environmentId]
      );

      await logAudit({
        environment_id: environmentId,
        user_id: auth.user.id,
        action: 'signin_config.deleted',
        resource_type: 'signin_configuration',
        resource_id: null,
        ip_address: getClientIp(request),
      });

      return jsonResponse({ deleted: true });
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('signin-config handler error:', msg);
    return errorResponse(`Internal error: ${msg}`, 500);
  }
};
