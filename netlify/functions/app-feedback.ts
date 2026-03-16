import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams, isValidUuid } from './_lib/helpers.js';

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\/api\/app-feedback\/?/, '').split('/').filter(Boolean);

    if (request.method === 'GET' && segments.length === 0) {
      const params = getSearchParams(request);
      const environmentId = params.get('environment_id');
      const packageName = params.get('package_name')?.trim() || null;
      const deviceId = params.get('device_id')?.trim() || null;
      const severity = params.get('severity')?.trim() || null;
      const status = params.get('status')?.trim() || null;
      const limit = Math.max(1, Math.min(500, Number(params.get('limit') ?? '100')));

      if (!environmentId) return errorResponse('environment_id is required');
      if (deviceId && !isValidUuid(deviceId)) return errorResponse('Invalid device_id filter', 400);
      await requireEnvironmentPermission(auth, environmentId, 'read');

      const items = await query<{
        id: string;
        environment_id: string;
        device_id: string | null;
        device_amapi_name: string | null;
        package_name: string;
        feedback_key: string;
        severity: string | null;
        message: string | null;
        data_json: Record<string, unknown> | null;
        first_reported_at: string;
        last_reported_at: string;
        last_update_time: string | null;
        status: string;
        device_name: string | null;
      }>(
        `SELECT afi.id, afi.environment_id, afi.device_id, afi.device_amapi_name,
                afi.package_name, afi.feedback_key, afi.severity, afi.message,
                afi.data_json, afi.first_reported_at, afi.last_reported_at,
                afi.last_update_time, afi.status, d.name AS device_name
         FROM app_feedback_items afi
         LEFT JOIN devices d ON d.id = afi.device_id
         WHERE afi.environment_id = $1
           AND ($2::text IS NULL OR afi.package_name = $2)
           AND ($3::uuid IS NULL OR afi.device_id = $3)
           AND ($4::text IS NULL OR afi.severity = $4)
           AND ($5::text IS NULL OR afi.status = $5)
         ORDER BY afi.last_reported_at DESC
         LIMIT $6`,
        [environmentId, packageName, deviceId, severity, status, limit]
      );

      return jsonResponse({ items });
    }

    if (request.method === 'GET' && segments.length === 1) {
      const itemId = segments[0];
      if (!isValidUuid(itemId)) return errorResponse('Invalid feedback item id', 400);

      const item = await queryOne<{
        id: string;
        environment_id: string;
        device_id: string | null;
        package_name: string;
        feedback_key: string;
        severity: string | null;
        message: string | null;
        data_json: Record<string, unknown> | null;
        last_update_time: string | null;
        first_reported_at: string;
        last_reported_at: string;
        status: string;
      }>(
        `SELECT id, environment_id, device_id, package_name, feedback_key, severity,
                message, data_json, last_update_time, first_reported_at, last_reported_at, status
         FROM app_feedback_items
         WHERE id = $1`,
        [itemId]
      );
      if (!item) return errorResponse('App feedback item not found', 404);
      await requireEnvironmentPermission(auth, item.environment_id, 'read');

      return jsonResponse({ item });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('app-feedback error:', err);
    return errorResponse('Internal server error', 500);
  }
};
