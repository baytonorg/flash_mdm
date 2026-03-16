import type { Context } from '@netlify/functions';
import { requireAuth } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { requireEnvironmentPermission, requireWorkspaceResourcePermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams, isValidUuid } from './_lib/helpers.js';
import {
  getEnvironmentLicensingSnapshot,
  getWorkspaceEnvironmentLicensingSnapshots,
  getWorkspaceLicensingSettings,
  getWorkspacePlatformEntitledSeats,
} from './_lib/licensing.js';

interface LicensePlan {
  id: string;
  name: string;
  max_devices: number;
  features: Record<string, unknown>;
}

interface License {
  id: string;
  workspace_id: string;
  plan_id: string;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    if (environmentId && !isValidUuid(environmentId)) {
      return errorResponse('environment_id must be a valid UUID');
    }

    let workspaceId = params.get('workspace_id')
      ?? (auth.authType === 'api_key' ? auth.apiKey?.workspace_id ?? null : auth.user.workspace_id);

    if (environmentId) {
      await requireEnvironmentPermission(auth, environmentId, 'read');
      const env = await queryOne<{ workspace_id: string }>(
        'SELECT workspace_id FROM environments WHERE id = $1',
        [environmentId]
      );
      if (!env?.workspace_id) return errorResponse('Environment not found', 404);
      workspaceId = env.workspace_id;
    } else {
      if (!workspaceId) {
        return errorResponse('workspace_id is required');
      }
      if (!isValidUuid(workspaceId)) {
        return errorResponse('workspace_id must be a valid UUID');
      }
      try {
        await requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', 'read');
      } catch (err) {
        if (!(err instanceof Response) || err.status !== 403 || auth.authType !== 'session') throw err;
        const activeEnvironmentId = auth.user.environment_id;
        if (!activeEnvironmentId) throw err;
        const matchingEnvironment = await queryOne<{ id: string }>(
          'SELECT id FROM environments WHERE id = $1 AND workspace_id = $2',
          [activeEnvironmentId, workspaceId]
        );
        if (!matchingEnvironment) throw err;
        await requireEnvironmentPermission(auth, activeEnvironmentId, 'read');
      }
    }

    if (!workspaceId) {
      return errorResponse('workspace_id is required');
    }
    const resolvedWorkspaceId = workspaceId;

    const workspaceLicensingSettings = await getWorkspaceLicensingSettings(resolvedWorkspaceId);

    if (!environmentId && workspaceLicensingSettings.effective_licensing_enabled) {
      await requireWorkspaceResourcePermission(auth, resolvedWorkspaceId, 'billing', 'license_view');
    }

    // Get license with plan
    const license = await queryOne<License & LicensePlan & { plan_name: string }>(
      `SELECT l.*, lp.name as plan_name, lp.max_devices, lp.features
       FROM licenses l
       JOIN license_plans lp ON lp.id = l.plan_id
       WHERE l.workspace_id = $1
       ORDER BY l.created_at DESC
       LIMIT 1`,
      [resolvedWorkspaceId]
    );

    // Count devices in workspace
    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM devices d
       JOIN environments e ON e.id = d.environment_id
       WHERE e.workspace_id = $1
         AND d.deleted_at IS NULL
         AND COALESCE(d.state, 'ACTIVE') IN ('ACTIVE', 'DISABLED', 'PROVISIONING')`,
      [resolvedWorkspaceId]
    );
    const deviceCount = parseInt(countRow?.count ?? '0', 10);

    const stripeEnabled = !!process.env.STRIPE_SECRET_KEY;
    const scopedSnapshot = environmentId && workspaceLicensingSettings.effective_licensing_enabled
      ? await getEnvironmentLicensingSnapshot(environmentId)
      : null;
    const [platformEntitledSeats, environmentSnapshots] = workspaceLicensingSettings.effective_licensing_enabled
      ? await Promise.all([
        scopedSnapshot ? scopedSnapshot.entitled_seats : getWorkspacePlatformEntitledSeats(resolvedWorkspaceId),
        scopedSnapshot ? [scopedSnapshot] : getWorkspaceEnvironmentLicensingSnapshots(resolvedWorkspaceId),
      ])
      : [0, []];
    const platformOverageCount = workspaceLicensingSettings.effective_licensing_enabled
      ? Math.max(0, deviceCount - platformEntitledSeats)
      : 0;

    // If no license, return free plan defaults
    if (!license) {
      const freePlan = await queryOne<LicensePlan>(
        `SELECT * FROM license_plans WHERE name = 'Free' LIMIT 1`,
        []
      );
      const freeTierLimit = workspaceLicensingSettings.free_enabled
        ? workspaceLicensingSettings.free_seat_limit
        : 0;
      const fallbackLimit = Number.isFinite(freeTierLimit) ? freeTierLimit : 0;
      const usagePercentage = fallbackLimit > 0
        ? Math.round((deviceCount / fallbackLimit) * 100)
        : 0;

      return jsonResponse({
        license: null,
        plan: freePlan ?? { name: 'Free', max_devices: 10, features: {} },
        device_count: deviceCount,
        device_limit: fallbackLimit,
        usage_percentage: usagePercentage,
        stripe_enabled: stripeEnabled,
        platform_entitled_seats: platformEntitledSeats,
        platform_consumed_seats: deviceCount,
        platform_overage_count: platformOverageCount,
        environments: environmentSnapshots,
        workspace_licensing_settings: workspaceLicensingSettings,
        licensing_enabled: workspaceLicensingSettings.effective_licensing_enabled,
      });
    }

    const deviceLimit = license.max_devices === -1 ? Infinity : license.max_devices;
    const usagePercentage = deviceLimit === Infinity
      ? 0
      : Math.round((deviceCount / deviceLimit) * 100);

    return jsonResponse({
      license: {
        id: license.id,
        workspace_id: license.workspace_id,
        plan_id: license.plan_id,
        stripe_subscription_id: license.stripe_subscription_id,
        status: license.status,
        current_period_end: license.current_period_end,
        created_at: license.created_at,
        updated_at: license.updated_at,
      },
      plan: {
        id: license.plan_id,
        name: license.plan_name,
        max_devices: license.max_devices,
        features: license.features,
      },
      device_count: deviceCount,
      device_limit: license.max_devices,
      usage_percentage: usagePercentage,
      stripe_enabled: stripeEnabled,
      platform_entitled_seats: platformEntitledSeats,
      platform_consumed_seats: deviceCount,
      platform_overage_count: platformOverageCount,
      environments: environmentSnapshots,
      workspace_licensing_settings: workspaceLicensingSettings,
      licensing_enabled: workspaceLicensingSettings.effective_licensing_enabled,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('License status error:', err);
    return errorResponse('Internal server error', 500);
  }
}
