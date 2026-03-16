import type { Context } from '@netlify/functions';
import { requireAuth } from './_lib/auth.js';
import { requireWorkspacePermission } from './_lib/rbac.js';
import { queryOne } from './_lib/db.js';
import { getBlob } from './_lib/blobs.js';
import { logAudit } from './_lib/audit.js';
import { errorResponse, getClientIp, getSearchParams, isValidUuid } from './_lib/helpers.js';

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const params = getSearchParams(request);

    const exportId = params.get('id');
    const workspaceId = params.get('workspace_id');
    const format = params.get('format');

    if (!exportId || !workspaceId || !format) {
      return errorResponse('id, workspace_id, and format are required');
    }

    if (!isValidUuid(exportId) || !isValidUuid(workspaceId)) {
      return errorResponse('Invalid id or workspace_id', 400);
    }

    if (!['csv', 'json'].includes(format)) {
      return errorResponse('Invalid format. Must be csv or json');
    }

    await requireWorkspacePermission(auth, workspaceId, 'write');

    const blobKey = `exports/${workspaceId}/${exportId}.${format}`;
    const content = await getBlob('exports', blobKey);
    if (content == null) {
      return errorResponse('Export not found', 404);
    }

    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
    const filename = `report-${exportId}.${format}`;

    await logAudit({
      workspace_id: workspaceId,
      user_id: auth.user.id,
      action: 'report.downloaded',
      resource_type: 'report_export',
      details: { export_id: exportId, format },
      ip_address: getClientIp(request),
    });

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Report download error:', err);
    return errorResponse('Internal server error', 500);
  }
}
