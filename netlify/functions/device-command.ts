import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { getDeviceCommandPermissionAction } from './_lib/device-command-permissions.js';
import {
  DEVICE_COMMAND_TYPES,
  isDeviceCommandType,
  isPatchStateCommandType,
} from './_lib/device-commands.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { buildAmapiCommandPayload, AmapiCommandValidationError } from './_lib/amapi-command.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, isValidUuid } from './_lib/helpers.js';

interface CommandBody {
  device_id: string;
  command: string;
  command_type?: string;
  params?: Record<string, unknown>;
}

function summarizeAmapiResultForAudit(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (typeof obj.name === 'string') summary.name = obj.name;
  if (typeof obj.done === 'boolean') summary.done = obj.done;
  if (typeof obj.state === 'string') summary.state = obj.state;
  if (obj.error && typeof obj.error === 'object') {
    const err = obj.error as Record<string, unknown>;
    const errSummary: Record<string, unknown> = {};
    if (typeof err.code === 'number') errSummary.code = err.code;
    if (typeof err.message === 'string') errSummary.message = err.message;
    if (typeof err.status === 'string') errSummary.status = err.status;
    if (Object.keys(errSummary).length > 0) summary.error = errSummary;
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const body = await parseJsonBody<CommandBody>(request);

    const command = (body.command ?? body.command_type ?? '').toString().trim().toUpperCase();

    if (!body.device_id || !command) {
      return errorResponse('device_id and command are required');
    }

    if (!isDeviceCommandType(command)) {
      return errorResponse(`Invalid command. Valid commands: ${DEVICE_COMMAND_TYPES.join(', ')}`);
    }

    if (!isValidUuid(body.device_id)) {
      return errorResponse('device_id must be a valid UUID');
    }

    const device = await queryOne<{
      id: string; amapi_name: string; environment_id: string; state: string;
    }>(
      'SELECT id, amapi_name, environment_id, state FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [body.device_id]
    );

    if (!device) return errorResponse('Device not found', 404);
    await requireEnvironmentResourcePermission(
      auth,
      device.environment_id,
      'device',
      getDeviceCommandPermissionAction(command)
    );

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

    // PATCH-based state commands (not :issueCommand)
    if (isPatchStateCommandType(command)) {
      const targetState = command === 'DISABLE' ? 'DISABLED' : 'ACTIVE';
      try {
        const result = await amapiCall(
          `${device.amapi_name}?updateMask=state`,
          env.workspace_id,
          {
            method: 'PATCH',
            body: { state: targetState },
            projectId: workspace.gcp_project_id,
            enterpriseName: env.enterprise_name,
            resourceType: 'devices',
            resourceId: device.amapi_name.split('/').pop(),
          }
        );

        await execute(
          'UPDATE devices SET state = $1, updated_at = now() WHERE id = $2',
          [targetState, device.id]
        );

        await logAudit({
          workspace_id: env.workspace_id,
          environment_id: device.environment_id,
          user_id: auth.user.id,
          device_id: device.id,
          action: `device.command.${command.toLowerCase()}`,
          resource_type: 'device',
          resource_id: device.id,
          details: {
            command,
            target_state: targetState,
            amapi_result: summarizeAmapiResultForAudit(result),
          },
          ip_address: getClientIp(request),
        });

        return jsonResponse({ result, message: `Device ${command.toLowerCase()}d successfully` });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Failed to ${command.toLowerCase()} device:`, message);
        const status = getAmapiErrorHttpStatus(err) ?? 502;
        return errorResponse(`Failed to ${command.toLowerCase()} device. Please try again.`, Number.isFinite(status) ? status : 502);
      }
    }

    let commandBody: Record<string, unknown>;
    try {
      commandBody = buildAmapiCommandPayload(command, body.params);
    } catch (err) {
      if (err instanceof AmapiCommandValidationError) {
        return errorResponse(err.message);
      }
      throw err;
    }

    try {
      const result = await amapiCall(
        `${device.amapi_name}:issueCommand`,
        env.workspace_id,
        {
          method: 'POST',
          body: commandBody,
          projectId: workspace.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'devices',
          resourceId: device.amapi_name.split('/').pop(),
        }
      );

      await logAudit({
        workspace_id: env.workspace_id,
        environment_id: device.environment_id,
        user_id: auth.user.id,
        device_id: device.id,
        action: `device.command.${command.toLowerCase()}`,
        resource_type: 'device',
        resource_id: device.id,
        details: {
          command,
          params: body.params,
          amapi_result: summarizeAmapiResultForAudit(result),
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ result, message: `Command ${command} issued successfully` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Failed to issue command ${command}:`, message);
      const status = getAmapiErrorHttpStatus(err) ?? 502;
      const amapiDetail = /^AMAPI error \(\d+\):\s*(.+)$/i.exec(message)?.[1];
      const clientMessage = amapiDetail
        ? `AMAPI rejected the ${command} command: ${amapiDetail}. Review function logs for details.`
        : 'Failed to issue command. Review function logs for details.';
      return errorResponse(clientMessage, Number.isFinite(status) ? status : 502);
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Device command internal error:', err instanceof Error ? err.message : 'Unknown error');
    return errorResponse('An internal error occurred', 500);
  }
};
