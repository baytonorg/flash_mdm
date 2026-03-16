import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  const auth = await requireAuth(request);
  const url = new URL(request.url);
  // Paths: /api/policies/:id/versions  or  /api/policies/:id/versions/:version
  const segments = url.pathname.replace('/api/policies/', '').split('/').filter(Boolean);
  // segments = [policyId, 'versions'] or [policyId, 'versions', versionNumber]
  const policyId = segments[0];
  const versionsAction = segments[1]; // 'versions'
  const versionNumber = segments[2]; // optional version number

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  if (versionsAction !== 'versions' || !policyId) {
    return errorResponse('Not found', 404);
  }

  // Verify policy exists
  const policy = await queryOne<{ id: string; environment_id: string }>(
    'SELECT id, environment_id FROM policies WHERE id = $1',
    [policyId]
  );
  if (!policy) return errorResponse('Policy not found', 404);
  await requireEnvironmentResourcePermission(auth, policy.environment_id, 'policy', 'read');

  // GET /api/policies/:id/versions/:version — single version config
  if (versionNumber) {
    const version = await queryOne<{
      policy_id: string;
      version: number;
      config: Record<string, unknown>;
      changed_by: string;
      change_summary: string | null;
      created_at: string;
    }>(
      `SELECT pv.policy_id, pv.version, pv.config, pv.changed_by, pv.change_summary, pv.created_at,
              u.email as changed_by_email
       FROM policy_versions pv
       LEFT JOIN users u ON u.id = pv.changed_by
       WHERE pv.policy_id = $1 AND pv.version = $2`,
      [policyId, parseInt(versionNumber, 10)]
    );

    if (!version) return errorResponse('Version not found', 404);
    return jsonResponse({ version_config: version });
  }

  // GET /api/policies/:id/versions — list all versions
  const versions = await query(
    `SELECT pv.version, pv.change_summary, pv.created_at,
            u.email as changed_by_email
     FROM policy_versions pv
     LEFT JOIN users u ON u.id = pv.changed_by
     WHERE pv.policy_id = $1
     ORDER BY pv.version DESC`,
    [policyId]
  );

  return jsonResponse({ versions });
};
