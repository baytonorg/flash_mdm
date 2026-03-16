import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentAccessScopeForResourcePermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams, isValidUuid } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const auth = await requireAuth(request);
    const params = getSearchParams(request);

    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');
    if (!isValidUuid(environmentId)) return errorResponse('environment_id must be a valid UUID');
    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, environmentId, 'device', 'read');

  const page = parseInt(params.get('page') ?? '1', 10);
  const perPage = Math.min(parseInt(params.get('per_page') ?? '50', 10), 200);
  const offset = (page - 1) * perPage;
  const search = params.get('search');
  const stateFilter = params.get('state');
  const ownershipFilter = params.get('ownership');
  const groupId = params.get('group_id');
  if (groupId && !isValidUuid(groupId)) return errorResponse('group_id must be a valid UUID');
  const sortBy = params.get('sort_by') ?? 'last_status_report_at';
  const sortDir = params.get('sort_dir') === 'asc' ? 'ASC' : 'DESC';

  // Allowed sort columns
  const allowedSorts = ['serial_number', 'manufacturer', 'model', 'os_version', 'state', 'ownership', 'last_status_report_at', 'updated_at', 'enrollment_time'];
  const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : 'last_status_report_at';
  const orderByClause =
    safeSortBy === 'last_status_report_at'
      ? `d.last_status_report_at ${sortDir} NULLS LAST, d.updated_at DESC`
      : `d.${safeSortBy} ${sortDir}`;

  let whereClause = 'd.environment_id = $1 AND d.deleted_at IS NULL';
  const queryParams: unknown[] = [environmentId];
  let paramIdx = 2;

  if (search) {
    whereClause += ` AND (d.name ILIKE $${paramIdx} OR d.serial_number ILIKE $${paramIdx} OR d.model ILIKE $${paramIdx} OR d.manufacturer ILIKE $${paramIdx} OR d.imei ILIKE $${paramIdx})`;
    queryParams.push(`%${search}%`);
    paramIdx++;
  }

  if (stateFilter) {
    whereClause += ` AND d.state = $${paramIdx}`;
    queryParams.push(stateFilter);
    paramIdx++;
  }

  if (ownershipFilter) {
    whereClause += ` AND d.ownership = $${paramIdx}`;
    queryParams.push(ownershipFilter);
    paramIdx++;
  }

  if (groupId) {
    if (envScope.mode === 'group' && !(envScope.accessible_group_ids ?? []).includes(groupId)) {
      return errorResponse('Forbidden: no access to this group', 403);
    }
    // Include all descendants of the group
    whereClause += ` AND d.group_id IN (SELECT descendant_id FROM group_closures WHERE ancestor_id = $${paramIdx})`;
    queryParams.push(groupId);
    paramIdx++;
  } else if (envScope.mode === 'group') {
    const accessibleGroupIds = envScope.accessible_group_ids ?? [];
    if (accessibleGroupIds.length === 0) {
      return jsonResponse({
        devices: [],
        pagination: { page, per_page: perPage, total: 0, total_pages: 0 },
      });
    }
    whereClause += ` AND d.group_id = ANY($${paramIdx}::uuid[])`;
    queryParams.push(accessibleGroupIds);
    paramIdx++;
  }

  // Count total
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM devices d WHERE ${whereClause}`,
    queryParams
  );
  const total = parseInt(countResult?.count ?? '0', 10);

  // Fetch devices
  const paginatedParams = [...queryParams, perPage, offset];
  const devices = await query(
    `SELECT d.id, d.amapi_name, d.name, d.serial_number, d.imei, d.manufacturer, d.model,
            d.os_version, d.security_patch_level, d.state, d.ownership, d.management_mode,
            d.policy_compliant, d.enrollment_time, d.last_status_report_at, d.last_policy_sync_at,
            d.group_id, d.policy_id, d.license_id,
            g.name as group_name,
            COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id) as effective_policy_id,
            p.name as policy_name
     FROM devices d
     LEFT JOIN groups g ON g.id = d.group_id
     LEFT JOIN LATERAL (
       SELECT pa.policy_id FROM policy_assignments pa
       WHERE pa.scope_type = 'device' AND pa.scope_id = d.id LIMIT 1
     ) dpa ON TRUE
     LEFT JOIN LATERAL (
       SELECT pa.policy_id FROM group_closures gc
       JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
       WHERE d.group_id IS NOT NULL AND gc.descendant_id = d.group_id
       ORDER BY gc.depth ASC LIMIT 1
     ) gpa ON TRUE
     LEFT JOIN LATERAL (
       SELECT pa.policy_id FROM policy_assignments pa
       WHERE pa.scope_type = 'environment' AND pa.scope_id = d.environment_id LIMIT 1
     ) epa ON TRUE
     LEFT JOIN policies p ON p.id = COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id)
     WHERE ${whereClause}
     ORDER BY ${orderByClause}
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    paginatedParams
  );

    return jsonResponse({
      devices,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    if (isResponseLike(err)) return err;
    throw err;
  }
};

function isResponseLike(value: unknown): value is Response {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Response> & { headers?: { get?: unknown } };
  return typeof candidate.status === 'number'
    && !!candidate.headers
    && typeof candidate.headers.get === 'function';
}
