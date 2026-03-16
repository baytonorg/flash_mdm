import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { buildEnterpriseUpgradeStatus } from './_lib/enterprise-upgrade.js';

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const body = await parseJsonBody<{
      environment_id: string;
      action: 'generate_upgrade_url' | 'get_upgrade_status' | 'reconcile_device_import';
    }>(request);

    if (!body.environment_id || !body.action) {
      return errorResponse('environment_id and action are required');
    }

    const env = await queryOne<{
      id: string; workspace_id: string; enterprise_name: string | null; enterprise_features: Record<string, unknown> | null;
    }>(
      'SELECT id, workspace_id, enterprise_name, enterprise_features FROM environments WHERE id = $1',
      [body.environment_id]
    );
    if (!env) return errorResponse('Environment not found', 404);
    if (!env.enterprise_name) return errorResponse('Environment is not bound to an enterprise', 400);

    await requireEnvironmentResourcePermission(auth, body.environment_id, 'environment', 'manage_settings');

    const workspace = await queryOne<{ gcp_project_id: string }>(
      'SELECT gcp_project_id FROM workspaces WHERE id = $1',
      [env.workspace_id]
    );
    if (!workspace?.gcp_project_id) return errorResponse('Workspace has no GCP project configured');

    if (body.action === 'reconcile_device_import') {
      let pageToken: string | undefined;
      let pages = 0;
      const amapiDeviceNames: string[] = [];

      do {
        const params = new URLSearchParams({ pageSize: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await amapiCall<{
          devices?: Array<{ name?: string | null }>;
          nextPageToken?: string;
        }>(
          `${env.enterprise_name}/devices?${params.toString()}`,
          env.workspace_id,
          {
            method: 'GET',
            projectId: workspace.gcp_project_id,
            enterpriseName: env.enterprise_name,
            resourceType: 'devices',
          }
        );
        pages += 1;
        for (const device of page.devices ?? []) {
          if (typeof device?.name === 'string' && device.name.trim()) {
            amapiDeviceNames.push(device.name.trim());
          }
        }
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);

      const uniqueNames = [...new Set(amapiDeviceNames)];
      if (uniqueNames.length > 0) {
        const valuesSql: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        for (const deviceAmapiName of uniqueNames) {
          valuesSql.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
          params.push(
            'process_enrollment',
            body.environment_id,
            JSON.stringify({
              notification_type: 'ENROLLMENT',
              device_amapi_name: deviceAmapiName,
              payload: { source: 'manual_reconcile_import' },
            })
          );
          idx += 3;
        }
        await execute(
          `INSERT INTO job_queue (job_type, environment_id, payload)
           VALUES ${valuesSql.join(', ')}`,
          params
        );
      }

      try {
        await triggerQueueWorker(request);
      } catch (err) {
        console.warn('Failed to trigger background queue worker after reconcile_device_import:', err);
      }

      await logAudit({
        workspace_id: env.workspace_id,
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'environment.device_reconcile_import.queued',
        resource_type: 'environment',
        resource_id: body.environment_id,
        details: {
          devices_found: uniqueNames.length,
          jobs_enqueued: uniqueNames.length,
          pages_scanned: pages,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        message: 'AMAPI device re-import queued',
        devices_found: uniqueNames.length,
        jobs_enqueued: uniqueNames.length,
        pages_scanned: pages,
      });
    }

    let enterprise: {
      name: string;
      enterpriseType?: string;
      managedGooglePlayAccountsEnterpriseType?: string;
      managedGoogleDomainType?: string;
    };
    try {
      enterprise = await amapiCall<{
        name: string;
        enterpriseType?: string;
        managedGooglePlayAccountsEnterpriseType?: string;
        managedGoogleDomainType?: string;
      }>(
        env.enterprise_name,
        env.workspace_id,
        {
          method: 'GET',
          projectId: workspace.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'enterprises',
          resourceId: env.enterprise_name.split('/').pop(),
        }
      );
    } catch (err) {
      const status = getAmapiErrorHttpStatus(err) ?? 502;
      return errorResponse(
        `Failed to load enterprise details: ${err instanceof Error ? err.message : 'Unknown error'}`,
        Number.isFinite(status) ? status : 502
      );
    }

    const cachedUpgradeStatus = buildEnterpriseUpgradeStatus(enterprise);
    const eligibleForUpgrade = cachedUpgradeStatus.eligible_for_upgrade;

    await execute(
      `UPDATE environments
       SET enterprise_features = COALESCE(enterprise_features, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        body.environment_id,
        JSON.stringify({
          enterprise_upgrade_status: cachedUpgradeStatus,
        }),
      ]
    );

    if (body.action === 'get_upgrade_status') {
      return jsonResponse({
        ...cachedUpgradeStatus,
        cached_upgrade_status: (env.enterprise_features as Record<string, unknown> | null)?.enterprise_upgrade_status ?? null,
      });
    }

    if (body.action === 'generate_upgrade_url') {
      if (!eligibleForUpgrade) {
        return errorResponse(
          'Enterprise upgrade is only available for managed Google Play Accounts enterprises',
          400
        );
      }

      try {
        const result = await amapiCall<{ url: string }>(
          `${env.enterprise_name}:generateEnterpriseUpgradeUrl`,
          env.workspace_id,
          {
            method: 'POST',
            projectId: workspace.gcp_project_id,
            enterpriseName: env.enterprise_name,
            resourceType: 'enterprises',
            resourceId: env.enterprise_name.split('/').pop(),
          }
        );

        await logAudit({
          workspace_id: env.workspace_id,
          environment_id: body.environment_id,
          user_id: auth.user.id,
          action: 'environment.upgrade_url_generated',
          resource_type: 'environment',
          resource_id: body.environment_id,
          ip_address: getClientIp(request),
        });

        return jsonResponse({ upgrade_url: result.url });
      } catch (err) {
        const status = getAmapiErrorHttpStatus(err) ?? 502;
        return errorResponse(
          `Failed to generate upgrade URL: ${err instanceof Error ? err.message : 'Unknown error'}`,
          Number.isFinite(status) ? status : 502
        );
      }
    }

    return errorResponse('Invalid action', 400);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Environment enterprise error:', err instanceof Error ? err.message : 'Unknown error');
    return errorResponse('An internal error occurred', 500);
  }
};

async function triggerQueueWorker(request: Request): Promise<void> {
  const origin = new URL(request.url).origin;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(`${origin}/.netlify/functions/sync-process-background`, {
      method: 'POST',
      headers: {
        'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET ?? '',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
