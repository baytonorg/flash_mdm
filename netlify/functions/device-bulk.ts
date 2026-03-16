import type { Context } from '@netlify/functions';
import { query, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { getDeviceCommandPermissionAction, isDestructiveDeviceCommand } from './_lib/device-command-permissions.js';
import {
  BULK_DEVICE_COMMAND_TYPES,
  isBulkDeviceCommandType,
  normalizeBulkDeviceCommand,
} from './_lib/device-commands.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';

interface BulkActionBody {
  device_ids: string[];
  action?: string;
  command_type?: string;
  params?: Record<string, unknown>;
}

export default async (request: Request, context: Context) => {
  void context;
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const body = await parseJsonBody<BulkActionBody>(request);

    const requestedCommand = (body.command_type ?? body.action ?? '').toString().trim();
    if (!body.device_ids?.length || !requestedCommand) {
      return errorResponse('device_ids and command_type (or action) are required');
    }

    if (body.device_ids.length > 500) {
      return errorResponse('Maximum 500 devices per bulk action');
    }

    const commandType = normalizeBulkDeviceCommand(requestedCommand);

    if (!isBulkDeviceCommandType(commandType)) {
      return errorResponse(`Invalid command_type. Valid: ${BULK_DEVICE_COMMAND_TYPES.join(', ')}`);
    }

    const requiredDevicePermission =
      commandType === 'DELETE' || isDestructiveDeviceCommand(commandType)
        ? 'bulk_destructive'
        : getDeviceCommandPermissionAction(commandType);

    // Verify all devices belong to environments the user can access
    const devicePlaceholders = body.device_ids.map((_, i) => `$${i + 1}`).join(', ');
    const devices = await query<{ id: string; environment_id: string }>(
      `SELECT id, environment_id FROM devices WHERE id IN (${devicePlaceholders}) AND deleted_at IS NULL`,
      body.device_ids
    );

    if (devices.length !== body.device_ids.length) {
      return errorResponse('Unable to process one or more requested devices', 404);
    }

    // Check access to each unique environment
    const uniqueEnvIds = [...new Set(devices.map((d) => d.environment_id))];
    for (const envId of uniqueEnvIds) {
      await requireEnvironmentResourcePermission(auth, envId, 'device', requiredDevicePermission);
    }
    const deviceEnvMap = new Map(devices.map((d) => [d.id, d.environment_id]));

    // Enqueue as individual jobs for background processing (respects rate limits)
    const jobPayloads = body.device_ids.map((deviceId) => ({
      environment_id: deviceEnvMap.get(deviceId) ?? null,
      job_type: commandType === 'DELETE' ? 'device_delete' : 'device_command',
      payload: JSON.stringify({
        device_id: deviceId,
        ...(commandType === 'DELETE'
          ? {}
          : { command_type: commandType, params: body.params ?? {} }),
        initiated_by: auth.user.id,
      }),
    }));

    // Batch insert jobs
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const job of jobPayloads) {
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
      values.push(job.job_type, job.environment_id, job.payload);
      idx += 3;
    }

    await execute(
      `INSERT INTO job_queue (job_type, environment_id, payload) VALUES ${placeholders.join(', ')}`,
      values
    );

    // Best-effort: trigger the queue worker so bulk commands execute immediately
    // instead of waiting for a separate scheduled/manual worker run.
    try {
      const origin = new URL(request.url).origin;
      await fetch(`${origin}/.netlify/functions/sync-process-background`, {
        method: 'POST',
        headers: {
          'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET ?? '',
        },
      });
    } catch (err) {
      console.warn('device-bulk: failed to trigger background worker after enqueue', err);
    }

    await logAudit({
      user_id: auth.user.id,
      action: `device.bulk.${commandType.toLowerCase()}`,
      details: { device_count: body.device_ids.length, command_type: commandType, params: body.params },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      message: `Bulk ${commandType === 'DELETE' ? 'delete' : 'command'} '${commandType}' queued for ${body.device_ids.length} devices`,
      job_count: body.device_ids.length,
      jobs_created: body.device_ids.length,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('device-bulk error:', err);
    return errorResponse('Internal server error', 500);
  }
};
