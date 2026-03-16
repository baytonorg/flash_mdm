import { query, queryOne, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { amapiCall } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';

const ENROLLMENT_TOKEN_RETENTION_GRACE_HOURS = 24;

interface AmapiEnrollmentToken {
  name: string;
  value?: string;
  qrCode?: string;
  expirationTimestamp?: string;
  policyName?: string;
  oneTimeOnly?: boolean;
  allowPersonalUsage?: string;
  additionalData?: string;
  [key: string]: unknown;
}

interface AmapiTokenListResponse {
  enrollmentTokens?: AmapiEnrollmentToken[];
  nextPageToken?: string;
}

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const body = await parseJsonBody<{ environment_id: string }>(request);

    if (!body.environment_id) {
      return errorResponse('environment_id is required');
    }

    await requireEnvironmentPermission(auth, body.environment_id, 'write');

    const env = await queryOne<{
      id: string; workspace_id: string; enterprise_name: string | null;
    }>(
      'SELECT id, workspace_id, enterprise_name FROM environments WHERE id = $1',
      [body.environment_id]
    );
    if (!env) return errorResponse('Environment not found', 404);
    if (!env.enterprise_name) return errorResponse('Environment is not bound to an enterprise', 400);

    const workspace = await queryOne<{ gcp_project_id: string }>(
      'SELECT gcp_project_id FROM workspaces WHERE id = $1',
      [env.workspace_id]
    );
    if (!workspace?.gcp_project_id) return errorResponse('Workspace has no GCP project configured');

    // 1. Fetch all tokens from AMAPI (paginated)
    const amapiTokens: AmapiEnrollmentToken[] = [];
    let pageToken: string | undefined;

    do {
      const path = pageToken
        ? `${env.enterprise_name}/enrollmentTokens?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
        : `${env.enterprise_name}/enrollmentTokens?pageSize=100`;

      const response = await amapiCall<AmapiTokenListResponse>(
        path,
        env.workspace_id,
        {
          projectId: workspace.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'general',
        }
      );

      if (response.enrollmentTokens) {
        amapiTokens.push(...response.enrollmentTokens);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    // 2. Get local tokens for this environment
    const localTokens = await query<{ id: string; amapi_name: string | null }>(
      'SELECT id, amapi_name FROM enrollment_tokens WHERE environment_id = $1',
      [body.environment_id]
    );

    const localAmapiNames = new Set(
      localTokens.filter((t) => t.amapi_name).map((t) => t.amapi_name!)
    );
    const amapiNames = new Set(amapiTokens.map((t) => t.name));

    let imported = 0;
    let invalidated = 0;
    await transaction(async (client) => {
      // 3. Import tokens that exist in AMAPI but not locally
      for (const token of amapiTokens) {
        if (!localAmapiNames.has(token.name)) {
          await client.query(
            `INSERT INTO enrollment_tokens
               (id, environment_id, name, amapi_name, amapi_value, qr_data,
                one_time_use, allow_personal_usage, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              crypto.randomUUID(),
              body.environment_id,
              `Synced: ${token.name.split('/').pop() ?? 'token'}`,
              token.name,
              token.value ?? null,
              token.qrCode ?? null,
              token.oneTimeOnly ?? false,
              token.allowPersonalUsage ?? 'PERSONAL_USAGE_ALLOWED',
              token.expirationTimestamp ?? null,
            ]
          );
          imported++;
        }
      }

      // 4. Retire local tokens that no longer exist in AMAPI (used/expired/deleted)
      // Keep metadata for a grace period so delayed enrollment events can still match
      // on amapi_name and apply token-derived group/policy assignment.
      for (const local of localTokens) {
        if (local.amapi_name && !amapiNames.has(local.amapi_name)) {
          await client.query(
            `UPDATE enrollment_tokens
             SET amapi_value = NULL,
                 qr_data = NULL,
                 expires_at = COALESCE(LEAST(expires_at, now()), now()),
                 updated_at = now()
             WHERE id = $1`,
            [local.id]
          );
          invalidated++;
        }
      }
    });

    await logAudit({
      workspace_id: env.workspace_id,
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'enrollment.tokens_synced',
      resource_type: 'enrollment_token',
      resource_id: body.environment_id,
      details: {
        imported,
        invalidated,
        total_amapi: amapiTokens.length,
        total_local: localTokens.length,
        retention_grace_hours: ENROLLMENT_TOKEN_RETENTION_GRACE_HOURS,
      },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      imported,
      invalidated,
      total_amapi: amapiTokens.length,
      total_local: localTokens.length,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Enrollment sync error:', msg);
    return errorResponse('An internal error occurred', 500);
  }
};
