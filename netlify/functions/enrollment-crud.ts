import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { jsonResponse, errorResponse, getClientIp } from './_lib/helpers.js';

type BulkSelection = {
  ids?: string[];
  all_matching?: boolean;
  excluded_ids?: string[];
};

type EnrollmentBulkBody = {
  environment_id?: string;
  operation?: 'delete';
  selection?: BulkSelection;
};

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);

  // Extract the token ID from the path: /api/enrolment/{id}
  const segments = url.pathname.replace('/api/enrolment/', '').split('/').filter(Boolean);
  const tokenId = segments[0];

  if (!tokenId) {
    return errorResponse('Token ID is required', 400);
  }

  if (request.method === 'POST' && tokenId === 'bulk') {
    const body = await request.json() as EnrollmentBulkBody;
    if (body.operation !== 'delete') return errorResponse('operation must be delete', 400);
    if (!body.environment_id) return errorResponse('environment_id is required', 400);
    if (!body.selection) return errorResponse('selection is required', 400);
    await requireEnvironmentPermission(auth, body.environment_id, 'write');

    const excludedIds = Array.from(new Set((body.selection.excluded_ids ?? []).filter(Boolean)));
    const excludedIdSet = new Set(excludedIds);

    let targetIds: string[] = [];
    if (body.selection.all_matching) {
      const rows = await queryOne<{ ids: string[] }>(
        'SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])::text[] AS ids FROM enrollment_tokens WHERE environment_id = $1',
        [body.environment_id]
      );
      targetIds = (rows?.ids ?? []).filter((id) => !excludedIdSet.has(id));
    } else {
      targetIds = Array.from(new Set((body.selection.ids ?? []).filter(Boolean)));
      if (targetIds.length === 0) return errorResponse('selection.ids must include at least one id', 400);
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of targetIds) {
      try {
        const token = await queryOne<{ environment_id: string }>(
          'SELECT environment_id FROM enrollment_tokens WHERE id = $1',
          [id]
        );
        if (!token) {
          results.push({ id, ok: false, error: 'Enrolment token not found' });
          continue;
        }
        if (token.environment_id !== body.environment_id) {
          results.push({ id, ok: false, error: 'Enrolment token is outside selected environment' });
          continue;
        }
        await deleteEnrollmentToken(auth, request, id, body.environment_id);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;
    return jsonResponse({
      total_targeted: results.length,
      succeeded,
      failed,
      results,
    });
  }

  // GET /api/enrolment/:id — get single token
  if (request.method === 'GET') {
    const token = await queryOne<{
      id: string;
      environment_id: string;
      group_id: string | null;
      policy_id: string | null;
      name: string;
      amapi_name: string | null;
      amapi_value: string | null;
      qr_data: string | null;
      one_time_use: boolean;
      allow_personal_usage: string | null;
      expires_at: string | null;
      created_at: string;
    }>(
      'SELECT * FROM enrollment_tokens WHERE id = $1',
      [tokenId]
    );

    if (!token) return errorResponse('Enrolment token not found', 404);

    await requireEnvironmentPermission(auth, token.environment_id, 'read');

    return jsonResponse({
      token: {
        id: token.id,
        environment_id: token.environment_id,
        name: token.name,
        value: token.amapi_value || '',
        policy_id: token.policy_id,
        group_id: token.group_id,
        one_time_use: token.one_time_use,
        allow_personal_usage: token.allow_personal_usage,
        qr_data: token.qr_data,
        expires_at: token.expires_at,
        created_at: token.created_at,
      },
    });
  }

  // DELETE /api/enrolment/:id — delete token
  if (request.method === 'DELETE') {
    const existing = await queryOne<{ id: string; environment_id: string }>(
      'SELECT id, environment_id FROM enrollment_tokens WHERE id = $1',
      [tokenId]
    );
    if (!existing) return errorResponse('Enrolment token not found', 404);

    await deleteEnrollmentToken(auth, request, tokenId);
    return jsonResponse({ message: 'Enrolment token deleted' });
  }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('enrollment-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};

async function deleteEnrollmentToken(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  request: Request,
  tokenId: string,
  expectedEnvironmentId?: string
): Promise<void> {
  const token = await queryOne<{
    id: string;
    environment_id: string;
    amapi_name: string | null;
  }>(
    'SELECT id, environment_id, amapi_name FROM enrollment_tokens WHERE id = $1',
    [tokenId]
  );

  if (!token) throw new Error('Enrolment token not found');
  if (expectedEnvironmentId && token.environment_id !== expectedEnvironmentId) {
    throw new Error('Enrolment token is outside selected environment');
  }
  await requireEnvironmentPermission(auth, token.environment_id, 'write');

  if (token.amapi_name) {
    try {
      const env = await queryOne<{
        workspace_id: string;
        enterprise_name: string | null;
      }>(
        'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
        [token.environment_id]
      );

      if (env?.enterprise_name) {
        const workspace = await queryOne<{ gcp_project_id: string }>(
          'SELECT gcp_project_id FROM workspaces WHERE id = $1',
          [env.workspace_id]
        );

        if (workspace?.gcp_project_id) {
          await amapiCall(
            token.amapi_name,
            env.workspace_id,
            {
              method: 'DELETE',
              projectId: workspace.gcp_project_id,
              enterpriseName: env.enterprise_name,
              resourceType: 'general',
            }
          );
        }
      }
    } catch {
      // Best effort — AMAPI token may already be expired or deleted
    }
  }

  await execute('DELETE FROM enrollment_tokens WHERE id = $1', [tokenId]);

  await logAudit({
    environment_id: token.environment_id,
    user_id: auth.user.id,
    action: 'enrollment_token.deleted',
    resource_type: 'enrollment_token',
    resource_id: tokenId,
    details: { amapi_name: token.amapi_name },
    ip_address: getClientIp(request),
  });
}
