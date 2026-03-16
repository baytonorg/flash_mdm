import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const auth = await requireAuth(request);
    const params = getSearchParams(request);

    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');

    await requireEnvironmentResourcePermission(auth, environmentId, 'audit', 'read');
    let canReadPrivileged = false;
    try {
      await requireEnvironmentResourcePermission(auth, environmentId, 'audit', 'read_privileged');
      canReadPrivileged = true;
    } catch (err) {
      if (!(err instanceof Response) || err.status !== 403) throw err;
    }

    const page = parseInt(params.get('page') ?? '1', 10);
    const perPage = Math.min(parseInt(params.get('per_page') ?? '25', 10), 100);
    const offset = (page - 1) * perPage;
    const includePrivilegedParam = params.get('include_privileged');
    const includePrivileged = includePrivilegedParam == null
      ? canReadPrivileged
      : ['1', 'true', 'yes'].includes(includePrivilegedParam.toLowerCase());

  // Build dynamic WHERE clause
    let whereClause = 'a.environment_id = $1';
    const queryParams: unknown[] = [environmentId];
    let paramIdx = 2;

    const visibilityScopeFilter = params.get('visibility_scope');
    if (includePrivileged && !canReadPrivileged) {
      return errorResponse('Forbidden: insufficient permission for privileged audit entries', 403);
    }
    if (visibilityScopeFilter) {
      if (visibilityScopeFilter !== 'standard' && visibilityScopeFilter !== 'privileged') {
        return errorResponse('visibility_scope must be "standard" or "privileged"');
      }
      if (visibilityScopeFilter === 'privileged' && !canReadPrivileged) {
        return errorResponse('Forbidden: insufficient permission for privileged audit entries', 403);
      }
      whereClause += ` AND a.visibility_scope = $${paramIdx}`;
      queryParams.push(visibilityScopeFilter);
      paramIdx++;
    } else if (!includePrivileged) {
      whereClause += ` AND a.visibility_scope = $${paramIdx}`;
      queryParams.push('standard');
      paramIdx++;
    }

    const actorTypeFilter = params.get('actor_type');
    if (actorTypeFilter) {
      if (actorTypeFilter !== 'user' && actorTypeFilter !== 'system' && actorTypeFilter !== 'api_key') {
        return errorResponse('actor_type must be "user", "system", or "api_key"');
      }
      whereClause += ` AND a.actor_type = $${paramIdx}`;
      queryParams.push(actorTypeFilter);
      paramIdx++;
    }

    const actionFilter = params.get('action');
    if (actionFilter) {
      whereClause += ` AND a.action = $${paramIdx}`;
      queryParams.push(actionFilter);
      paramIdx++;
    }

    const resourceTypeFilter = params.get('resource_type');
    if (resourceTypeFilter) {
      whereClause += ` AND a.resource_type = $${paramIdx}`;
      queryParams.push(resourceTypeFilter);
      paramIdx++;
    }

    const userIdFilter = params.get('user_id');
    if (userIdFilter) {
      whereClause += ` AND a.user_id = $${paramIdx}`;
      queryParams.push(userIdFilter);
      paramIdx++;
    }

    const dateFrom = params.get('date_from');
    if (dateFrom) {
      whereClause += ` AND a.created_at >= $${paramIdx}`;
      queryParams.push(dateFrom);
      paramIdx++;
    }

    const dateTo = params.get('date_to');
    if (dateTo) {
      whereClause += ` AND a.created_at <= $${paramIdx}`;
      queryParams.push(dateTo);
      paramIdx++;
    }

  // Count total matching entries
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_log a WHERE ${whereClause}`,
      queryParams
    );
    const total = parseInt(countResult?.count ?? '0', 10);

  // Fetch entries with user info
    const paginatedParams = [...queryParams, perPage, offset];
    const entries = await query(
      `SELECT a.id, a.workspace_id, a.environment_id, a.user_id, a.api_key_id, a.device_id,
            a.actor_type, a.visibility_scope,
            a.action, a.resource_type, a.resource_id, a.details, a.ip_address,
            a.created_at,
            u.email as user_email,
            ak.name as api_key_name,
            COALESCE(
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
              u.email
            ) as user_name,
            COALESCE(
              CASE WHEN a.actor_type = 'api_key' THEN ak.name END,
              CASE WHEN a.actor_type = 'system' THEN 'System' END,
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
              u.email
            ) as actor,
            COALESCE(
              a.resource_type || ':' || a.resource_id::text,
              a.resource_type,
              a.resource_id::text,
              a.device_id::text
            ) as target
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN api_keys ak ON ak.id = a.api_key_id
     WHERE ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      paginatedParams
    );

    return jsonResponse({
      entries,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('audit-log error:', err);
    return errorResponse('Internal server error', 500);
  }
};
