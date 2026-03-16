import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp, isValidUuid } from './_lib/helpers.js';

interface OperationResult {
  name?: string;
  done?: boolean;
  metadata?: Record<string, unknown>;
  error?: { code: number; message: string };
  response?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OperationListResult {
  operations?: OperationResult[];
  nextPageToken?: string;
  unavailable?: boolean;
  message?: string;
}

const MAX_OPERATION_PAGES = 20;
const OPERATION_PAGE_SIZE = 100;
const MAX_OPERATION_ITEMS = 500;

function getOperationSortTimestamp(op: OperationResult): number {
  const createTimeRaw = op.metadata?.createTime;
  if (typeof createTimeRaw === 'string') {
    const parsed = Date.parse(createTimeRaw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const name = typeof op.name === 'string' ? op.name : '';
  const suffix = name.split('/').pop() ?? '';
  const numeric = Number(suffix);
  return Number.isFinite(numeric) ? numeric : 0;
}

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);
    const params = getSearchParams(request);
    const action = params.get('action') ?? (request.method === 'POST' ? 'cancel' : 'list');

    // --- LIST operations for a device ---
    if (request.method === 'GET' && action === 'list') {
      const deviceId = params.get('device_id');
      if (!deviceId) return errorResponse('device_id is required');
      if (!isValidUuid(deviceId)) return errorResponse('device_id must be a valid UUID');

      const device = await queryOne<{
        id: string; amapi_name: string; environment_id: string;
      }>(
        'SELECT id, amapi_name, environment_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
        [deviceId]
      );
      if (!device) return errorResponse('Device not found', 404);
      await requireEnvironmentResourcePermission(auth, device.environment_id, 'device', 'write');

      const env = await queryOne<{ workspace_id: string; enterprise_name: string }>(
        'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
        [device.environment_id]
      );
      if (!env?.enterprise_name) return errorResponse('Environment has no bound enterprise');

      const workspace = await queryOne<{ gcp_project_id: string }>(
        'SELECT gcp_project_id FROM workspaces WHERE id = $1',
        [env.workspace_id]
      );
      if (!workspace?.gcp_project_id) return errorResponse('Workspace has no GCP project configured');

      try {
        const collected: OperationResult[] = [];
        let pageToken: string | undefined;
        let pagesFetched = 0;

        do {
          const path = pageToken
            ? `${device.amapi_name}/operations?pageSize=${OPERATION_PAGE_SIZE}&pageToken=${encodeURIComponent(pageToken)}`
            : `${device.amapi_name}/operations?pageSize=${OPERATION_PAGE_SIZE}`;
          const result = await amapiCall<OperationListResult>(
            path,
            env.workspace_id,
            {
              projectId: workspace.gcp_project_id,
              enterpriseName: env.enterprise_name,
              resourceType: 'devices',
              resourceId: device.amapi_name.split('/').pop(),
            }
          );
          collected.push(...(result.operations ?? []));
          pageToken = result.nextPageToken || undefined;
          pagesFetched += 1;
        } while (pageToken && pagesFetched < MAX_OPERATION_PAGES && collected.length < MAX_OPERATION_ITEMS);

        const dedupedByName = new Map<string, OperationResult>();
        for (const op of collected) {
          if (!op.name) continue;
          dedupedByName.set(op.name, op);
        }
        const operations = [...dedupedByName.values()]
          .sort((a, b) => getOperationSortTimestamp(b) - getOperationSortTimestamp(a))
          .slice(0, MAX_OPERATION_ITEMS);

        return jsonResponse({ operations, nextPageToken: pageToken });
      } catch (err) {
        const status = getAmapiErrorHttpStatus(err) ?? 502;
        // Operations listing is non-critical for the device detail page; fail soft on upstream/transient errors.
        if (status >= 500) {
          return jsonResponse({
            operations: [],
            nextPageToken: undefined,
            unavailable: true,
            message: 'Operations are temporarily unavailable. Please try again shortly.',
          });
        }
        return errorResponse('Failed to list device operations', Number.isFinite(status) ? status : 502);
      }
    }

    // --- GET a single operation ---
    if (request.method === 'GET' && action === 'get') {
      const operationName = params.get('operation_name');
      if (!operationName) return errorResponse('operation_name is required');
      if (!operationName.startsWith('enterprises/')) {
        return errorResponse('Invalid operation name format');
      }

      // Extract enterprise and device info from operation name to verify access
      const enterprisePart = operationName.split('/').slice(0, 2).join('/');
      const env = await queryOne<{ id: string; workspace_id: string; enterprise_name: string }>(
        'SELECT id, workspace_id, enterprise_name FROM environments WHERE enterprise_name = $1',
        [enterprisePart]
      );
      if (!env) return errorResponse('Enterprise not found', 404);
      await requireEnvironmentResourcePermission(auth, env.id, 'device', 'write');

      const workspace = await queryOne<{ gcp_project_id: string }>(
        'SELECT gcp_project_id FROM workspaces WHERE id = $1',
        [env.workspace_id]
      );
      if (!workspace?.gcp_project_id) return errorResponse('Workspace has no GCP project configured');

      try {
        const result = await amapiCall<OperationResult>(
          operationName,
          env.workspace_id,
          {
            projectId: workspace.gcp_project_id,
            enterpriseName: env.enterprise_name,
            resourceType: 'devices',
          }
        );
        return jsonResponse({ operation: result });
      } catch (err) {
        const status = getAmapiErrorHttpStatus(err) ?? 502;
        return errorResponse('Failed to get operation', Number.isFinite(status) ? status : 502);
      }
    }

    // --- CANCEL an operation ---
    if (request.method === 'POST') {
      const body = await parseJsonBody<{ operation_name: string }>(request);
      if (!body.operation_name) return errorResponse('operation_name is required');
      if (!body.operation_name.startsWith('enterprises/')) {
        return errorResponse('Invalid operation name format');
      }

      const enterprisePart = body.operation_name.split('/').slice(0, 2).join('/');
      const env = await queryOne<{ id: string; workspace_id: string; enterprise_name: string }>(
        'SELECT id, workspace_id, enterprise_name FROM environments WHERE enterprise_name = $1',
        [enterprisePart]
      );
      if (!env) return errorResponse('Enterprise not found', 404);
      await requireEnvironmentResourcePermission(auth, env.id, 'device', 'delete');

      const workspace = await queryOne<{ gcp_project_id: string }>(
        'SELECT gcp_project_id FROM workspaces WHERE id = $1',
        [env.workspace_id]
      );
      if (!workspace?.gcp_project_id) return errorResponse('Workspace has no GCP project configured');

      try {
        await amapiCall(
          `${body.operation_name}:cancel`,
          env.workspace_id,
          {
            method: 'POST',
            projectId: workspace.gcp_project_id,
            enterpriseName: env.enterprise_name,
            resourceType: 'devices',
          }
        );

        await logAudit({
          workspace_id: env.workspace_id,
          environment_id: env.id,
          user_id: auth.user.id,
          action: 'device.operation.cancelled',
          resource_type: 'operation',
          resource_id: body.operation_name,
          details: { operation_name: body.operation_name },
          ip_address: getClientIp(request),
        });

        return jsonResponse({ cancelled: true, operation_name: body.operation_name });
      } catch (err) {
        const status = getAmapiErrorHttpStatus(err) ?? 502;
        return errorResponse('Failed to cancel operation', Number.isFinite(status) ? status : 502);
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Device operations error:', err instanceof Error ? err.message : 'Unknown error');
    return errorResponse('An internal error occurred', 500);
  }
};
