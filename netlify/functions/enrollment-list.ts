import type { Context } from '@netlify/functions';
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

export default async (request: Request, _context: Context) => {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const auth = await requireAuth(request);
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    const includeExpired = params.get('include_expired') === 'true';

    if (!environmentId) {
      return errorResponse('environment_id is required');
    }

    await requireEnvironmentPermission(auth, environmentId, 'read');

    const tokens = await query<{
    id: string;
    environment_id: string;
    group_id: string | null;
    group_name: string | null;
    policy_id: string | null;
    policy_name: string | null;
    name: string;
    amapi_name: string | null;
    amapi_value: string | null;
    qr_data: string | null;
    one_time_use: boolean;
    allow_personal_usage: string | null;
    expires_at: string | null;
    created_at: string;
  }>(
    `SELECT et.id, et.environment_id, et.group_id, et.name, et.amapi_name,
            et.amapi_value, et.qr_data, et.one_time_use, et.allow_personal_usage,
            et.expires_at, et.created_at,
            g.name as group_name,
            ep.id as policy_id,
            ep.name as policy_name
     FROM enrollment_tokens et
     LEFT JOIN groups g ON g.id = et.group_id
     LEFT JOIN LATERAL (
       SELECT pa.policy_id
       FROM group_closures gc
       JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
       WHERE gc.descendant_id = et.group_id
       ORDER BY gc.depth ASC LIMIT 1
     ) gpa ON et.group_id IS NOT NULL
     LEFT JOIN LATERAL (
       SELECT pa.policy_id
       FROM policy_assignments pa
       WHERE pa.scope_type = 'environment' AND pa.scope_id = et.environment_id
       LIMIT 1
     ) epa ON TRUE
     LEFT JOIN policies ep ON ep.id = COALESCE(gpa.policy_id, epa.policy_id, et.policy_id)
     WHERE et.environment_id = $1
       AND ($2::boolean = true OR et.expires_at IS NULL OR et.expires_at > now())
     ORDER BY et.created_at DESC`,
    [environmentId, includeExpired]
  );

    // Map to the frontend's expected shape
    const mapped = tokens.map((t) => ({
      id: t.id,
      environment_id: t.environment_id,
      name: t.name,
      value: t.amapi_value || '',
      policy_id: t.policy_id,
      policy_name: t.policy_name,
      group_id: t.group_id,
      group_name: t.group_name,
      one_time_use: t.one_time_use,
      allow_personal_usage: t.allow_personal_usage,
      qr_data: t.qr_data,
      expires_at: t.expires_at,
      created_at: t.created_at,
    }));

    return jsonResponse({ tokens: mapped });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('enrollment-list error:', err);
    return errorResponse('Internal server error', 500);
  }
};
