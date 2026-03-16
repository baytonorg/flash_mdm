import type { Context } from '@netlify/functions';
import { requireAuth } from './_lib/auth.js';
import { queryOne, execute } from './_lib/db.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, parseJsonBody } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { getWorkspaceLicensingSettings } from './_lib/licensing.js';

interface AssignBody {
  device_id: string;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const isUnassign = url.pathname.endsWith('/unassign');

    const body = await parseJsonBody<AssignBody>(request);
    if (!body.device_id) {
      return errorResponse('device_id is required');
    }

    // Get device and its workspace
    const device = await queryOne<{ id: string; environment_id: string; license_id: string | null }>(
      `SELECT d.id, d.environment_id, d.license_id
       FROM devices d
       WHERE d.id = $1
         AND d.deleted_at IS NULL`,
      [body.device_id]
    );
    if (!device) {
      return errorResponse('Device not found', 404);
    }

    // Get workspace for device
    const env = await queryOne<{ workspace_id: string }>(
      `SELECT workspace_id FROM environments WHERE id = $1`,
      [device.environment_id]
    );
    if (!env) {
      return errorResponse('Environment not found', 404);
    }

    const licensing = await getWorkspaceLicensingSettings(env.workspace_id);
    if (!licensing.effective_licensing_enabled) {
      return errorResponse('Licensing is disabled for this workspace', 409);
    }

    await requireEnvironmentPermission(auth, device.environment_id, 'write');

    if (isUnassign) {
      // Unassign license from device
      await execute(
        `UPDATE devices SET license_id = NULL WHERE id = $1`,
        [body.device_id]
      );

      await logAudit({
        workspace_id: env.workspace_id,
        user_id: auth.user.id,
        device_id: body.device_id,
        action: 'license.unassigned',
        resource_type: 'device',
        resource_id: body.device_id,
      });

      return jsonResponse({ message: 'Licence unassigned from device' });
    }

    // Assign: check workspace has available license slots
    const license = await queryOne<{ id: string; plan_id: string }>(
      `SELECT l.id, l.plan_id
       FROM licenses l
       WHERE l.workspace_id = $1 AND l.status = 'active'
       ORDER BY l.created_at DESC
       LIMIT 1`,
      [env.workspace_id]
    );

    if (!license) {
      return errorResponse('No active licence found for this workspace');
    }

    const plan = await queryOne<{ max_devices: number }>(
      `SELECT max_devices FROM license_plans WHERE id = $1`,
      [license.plan_id]
    );

    if (plan && plan.max_devices !== -1) {
      const usedRow = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM devices d
         JOIN environments e ON e.id = d.environment_id
         WHERE e.workspace_id = $1 AND d.license_id IS NOT NULL`,
        [env.workspace_id]
      );
      const usedCount = parseInt(usedRow?.count ?? '0', 10);

      if (usedCount >= plan.max_devices) {
        return errorResponse('Licence device limit reached. Please upgrade your plan.');
      }
    }

    // Assign license to device
    await execute(
      `UPDATE devices SET license_id = $1 WHERE id = $2`,
      [license.id, body.device_id]
    );

    await logAudit({
      workspace_id: env.workspace_id,
      user_id: auth.user.id,
      device_id: body.device_id,
      action: 'license.assigned',
      resource_type: 'device',
      resource_id: body.device_id,
    });

    return jsonResponse({ message: 'Licence assigned to device' });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('License assign error:', err);
    return errorResponse('Internal server error', 500);
  }
}
