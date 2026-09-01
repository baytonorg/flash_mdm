import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentAccessScopeForResourcePermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams, isValidUuid } from './_lib/helpers.js';
import { getDeviceReportFreshness, getDeviceReportStaleAfterDays } from './_lib/device-health.js';

export default async (request: Request, _context: Context) => {
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
  const manufacturerFilter = params.get('manufacturer')?.trim() ?? '';
  const policyCompliantParam = params.get('policy_compliant');
  if (policyCompliantParam && policyCompliantParam !== 'true' && policyCompliantParam !== 'false') {
    return errorResponse('policy_compliant must be true or false');
  }
  const policyCompliantFilter = policyCompliantParam
    ? policyCompliantParam === 'true'
    : null;
  const reportFreshnessFilter = params.get('report_freshness');
  if (
    reportFreshnessFilter
    && !['fresh', 'stale', 'unknown'].includes(reportFreshnessFilter)
  ) {
    return errorResponse('report_freshness must be fresh, stale, or unknown');
  }
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

  const workspace = await queryOne<{ settings: unknown }>(
    `SELECT w.settings
     FROM environments e
     JOIN workspaces w ON w.id = e.workspace_id
     WHERE e.id = $1`,
    [environmentId]
  );
  const staleAfterDays = getDeviceReportStaleAfterDays(workspace?.settings);

  let scopeWhereClause = 'd.environment_id = $1 AND d.deleted_at IS NULL';
  const scopeParams: unknown[] = [environmentId];
  let scopeParamIdx = 2;

  if (groupId) {
    if (envScope.mode === 'group' && !(envScope.accessible_group_ids ?? []).includes(groupId)) {
      return errorResponse('Forbidden: no access to this group', 403);
    }
    // Include all descendants of the group
    scopeWhereClause += ` AND d.group_id IN (SELECT descendant_id FROM group_closures WHERE ancestor_id = $${scopeParamIdx})`;
    scopeParams.push(groupId);
    scopeParamIdx++;
  } else if (envScope.mode === 'group') {
    const accessibleGroupIds = envScope.accessible_group_ids ?? [];
    if (accessibleGroupIds.length === 0) {
      return jsonResponse({
        devices: [],
        pagination: { page, per_page: perPage, total: 0, total_pages: 0 },
        facets: { manufacturers: [] },
        device_report_stale_after_days: staleAfterDays,
      });
    }
    scopeWhereClause += ` AND d.group_id = ANY($${scopeParamIdx}::uuid[])`;
    scopeParams.push(accessibleGroupIds);
    scopeParamIdx++;
  }

  const manufacturerRows = await query<{ manufacturer: string }>(
    `SELECT manufacturer
     FROM (
       SELECT MIN(BTRIM(d.manufacturer)) AS manufacturer
       FROM devices d
       WHERE ${scopeWhereClause}
         AND NULLIF(BTRIM(d.manufacturer), '') IS NOT NULL
       GROUP BY LOWER(BTRIM(d.manufacturer))
     ) manufacturer_facets
     ORDER BY LOWER(manufacturer), manufacturer`,
    scopeParams
  );
  const manufacturerFacets = manufacturerRows.map(({ manufacturer }) => ({
    value: manufacturer,
    label: manufacturer,
  }));

  let whereClause = scopeWhereClause;
  const queryParams = [...scopeParams];
  let paramIdx = scopeParamIdx;

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

  if (manufacturerFilter) {
    whereClause += ` AND LOWER(BTRIM(d.manufacturer)) = LOWER($${paramIdx})`;
    queryParams.push(manufacturerFilter);
    paramIdx++;
  }

  if (policyCompliantFilter !== null) {
    whereClause += ` AND d.policy_compliant = $${paramIdx}`;
    queryParams.push(policyCompliantFilter);
    paramIdx++;
  }

  if (reportFreshnessFilter === 'unknown') {
    whereClause += ' AND d.last_status_report_at IS NULL';
  } else if (reportFreshnessFilter === 'stale') {
    whereClause += ` AND d.last_status_report_at IS NOT NULL AND d.last_status_report_at < now() - make_interval(days => $${paramIdx})`;
    queryParams.push(staleAfterDays);
    paramIdx++;
  } else if (reportFreshnessFilter === 'fresh') {
    whereClause += ` AND d.last_status_report_at IS NOT NULL AND d.last_status_report_at >= now() - make_interval(days => $${paramIdx})`;
    queryParams.push(staleAfterDays);
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
  const deviceRows = await query<{ last_status_report_at: string | null } & Record<string, unknown>>(
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
  const devices = deviceRows.map((device) => ({
    ...device,
    report_freshness: getDeviceReportFreshness(device.last_status_report_at, staleAfterDays),
  }));

    return jsonResponse({
      devices,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: Math.ceil(total / perPage),
      },
      facets: { manufacturers: manufacturerFacets },
      device_report_stale_after_days: staleAfterDays,
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
