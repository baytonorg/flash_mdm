import type { Context } from '@netlify/functions';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentAccessScopeForPermission } from './_lib/rbac.js';
import { query, queryOne } from './_lib/db.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { storeBlob } from './_lib/blobs.js';
import { logAudit } from './_lib/audit.js';
import { v4 as uuidv4 } from 'uuid';

interface ExportBody {
  environment_id: string;
  type: 'devices' | 'policies' | 'audit' | 'apps';
  format: 'csv' | 'json';
  date_from?: string;
  date_to?: string;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const body = await parseJsonBody<ExportBody>(request);
    const ip = getClientIp(request);

    if (!body.environment_id || !body.type || !body.format) {
      return errorResponse('environment_id, type, and format are required');
    }

    if (!['devices', 'policies', 'audit', 'apps'].includes(body.type)) {
      return errorResponse('Invalid export type. Must be: devices, policies, audit, or apps');
    }

    if (!['csv', 'json'].includes(body.format)) {
      return errorResponse('Invalid format. Must be: csv or json');
    }

    // Get environment
    const env = await queryOne<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id FROM environments WHERE id = $1`,
      [body.environment_id]
    );
    if (!env) {
      return errorResponse('Environment not found', 404);
    }

    // Verify access — require admin role with scoped access enforcement
    const scope = await requireEnvironmentAccessScopeForPermission(auth, body.environment_id, 'write');

    // Generate export data, passing accessible group IDs for scoped users
    const data = await generateExportData(body, env.workspace_id, scope.accessible_group_ids);

    // Format
    let content: string;
    if (body.format === 'json') {
      content = JSON.stringify(data, null, 2);
    } else {
      content = convertToCsv(data);
    }

    // Store in blobs
    const exportId = uuidv4();
    const blobKey = `exports/${env.workspace_id}/${exportId}.${body.format}`;

    await storeBlob('exports', blobKey, content, {
      type: body.type,
      format: body.format,
      environment_id: body.environment_id,
      created_by: auth.user.id,
      created_at: new Date().toISOString(),
    });

    await logAudit({
      workspace_id: env.workspace_id,
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'report.exported',
      resource_type: 'report',
      resource_id: exportId,
      details: { type: body.type, format: body.format, record_count: data.length },
      ip_address: ip,
    });

    // Return download URL (served from a download endpoint)
    const origin = new URL(request.url).origin;
    const exportUrl = `${origin}/api/reports/download?id=${exportId}&workspace_id=${env.workspace_id}&format=${body.format}`;

    return jsonResponse({
      export_id: exportId,
      export_url: exportUrl,
      record_count: data.length,
      format: body.format,
      type: body.type,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Report export error:', err);
    return errorResponse('Internal server error', 500);
  }
}

async function generateExportData(
  body: ExportBody,
  workspaceId: string,
  accessibleGroupIds: string[] | null
): Promise<Record<string, unknown>[]> {
  // Build a group filter clause for scoped users
  const groupFilter = accessibleGroupIds
    ? ` AND d.group_id = ANY($3)`
    : '';
  const groupFilterParams = accessibleGroupIds
    ? [body.environment_id, workspaceId, accessibleGroupIds]
    : [body.environment_id, workspaceId];

  switch (body.type) {
    case 'devices':
      return query(
        `SELECT d.id,
                d.amapi_name,
                d.serial_number,
                d.imei,
                d.manufacturer,
                d.model,
                d.os_version,
                d.security_patch_level,
                d.state,
                d.ownership,
                d.management_mode,
                d.policy_compliant,
                d.applied_policy_version,
                d.enrollment_time,
                d.last_status_report_at,
                d.last_policy_sync_at,
                d.snapshot,
                d.created_at,
                d.updated_at
         FROM devices d
         JOIN environments e ON e.id = d.environment_id
         WHERE d.environment_id = $1 AND e.workspace_id = $2 AND d.deleted_at IS NULL${groupFilter}
         ORDER BY d.created_at DESC`,
        groupFilterParams
      );

    case 'policies':
      return query(
        `SELECT p.id,
                p.name,
                p.description,
                p.deployment_scenario,
                p.config,
                p.amapi_name,
                p.version,
                p.status,
                p.created_at,
                p.updated_at
         FROM policies p
         JOIN environments e ON e.id = p.environment_id
         WHERE p.environment_id = $1 AND e.workspace_id = $2
         ORDER BY p.name`,
        [body.environment_id, workspaceId]
      );

    case 'audit': {
      const params: unknown[] = [body.environment_id, workspaceId];
      let dateFilter = '';
      if (body.date_from) {
        params.push(body.date_from);
        dateFilter += ` AND a.created_at >= $${params.length}`;
      }
      if (body.date_to) {
        params.push(body.date_to);
        dateFilter += ` AND a.created_at <= $${params.length}`;
      }

      return query(
        `SELECT a.id, a.action, a.resource_type, a.resource_id, a.details,
                a.ip_address, a.created_at, u.email as user_email
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         JOIN environments e ON e.id = a.environment_id
         WHERE a.environment_id = $1 AND e.workspace_id = $2 ${dateFilter}
         ORDER BY a.created_at DESC
         LIMIT 10000`,
        params
      );
    }

    case 'apps':
      return query(
        `SELECT a.id,
                a.package_name,
                a.display_name,
                a.install_type,
                a.scope_type,
                a.scope_id,
                a.auto_update_mode,
                a.managed_config,
                a.created_at,
                a.updated_at
         FROM app_deployments a
         JOIN environments e ON e.id = a.environment_id
         WHERE a.environment_id = $1 AND e.workspace_id = $2
         ORDER BY COALESCE(a.display_name, a.package_name), a.package_name`,
        [body.environment_id, workspaceId]
      );

    default:
      return [];
  }
}

function convertToCsv(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const raw = typeof val === 'object' ? JSON.stringify(val) : String(val);
      const str = sanitizeCsvCell(raw);
      // Escape CSV: quote if contains comma, newline, or quote
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

function sanitizeCsvCell(value: string): string {
  if (value.length === 0) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
