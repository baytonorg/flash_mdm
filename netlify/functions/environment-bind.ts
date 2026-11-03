import type { PoolClient } from 'pg';
import { lockMembershipWorkspaces } from './_lib/membership-lifecycle.js';
import { requireEnvironmentLifecyclePermission } from './_lib/scope-authority.js';
import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { amapiCall, prepareAmapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { BRAND } from './_lib/brand.js';
import { syncPolicyDerivativesForPolicy } from './_lib/policy-derivatives.js';
import { preparePolicyBaseForDerivativeGeneration } from './_lib/policy-merge.js';
import { syncSigninDetailsToAmapi } from './signin-config.js';
import {
  resolveAmapiDeviceImei,
  type AmapiTelephonyInfo,
} from './_lib/amapi-device-network.js';

const BOOTSTRAP_DEVICE_PAGE_SIZE = 100;
const BOOTSTRAP_DEVICE_MAX = 500; // keep attach requests bounded; full reconcile can catch up later

interface AmapiBootstrapDevice {
  name: string;
  hardwareInfo?: {
    serialNumber?: string;
    manufacturer?: string;
    brand?: string;
    model?: string;
  };
  softwareInfo?: {
    androidVersion?: string;
    securityPatchLevel?: string;
  };
  networkInfo?: {
    imei?: string;
    telephonyInfo?: Array<{
      imei?: string;
    }>;
    telephonyInfos?: AmapiTelephonyInfo[];
  };
  state?: string;
  ownership?: string;
  managementMode?: string;
  policyCompliant?: boolean;
  enrollmentTime?: string;
  lastStatusReportTime?: string;
  [key: string]: unknown;
}

interface AmapiBootstrapDeviceListResponse {
  devices?: AmapiBootstrapDevice[];
  nextPageToken?: string;
}

/**
 * Enterprise binding flow (two-step):
 *
 * Step 1: POST /api/environments/bind with { environment_id }
 *   -> POST signupUrls?projectId=...&callbackUrl=... -> returns signup URL
 *
 * Step 2: POST /api/environments/bind with { environment_id, enterprise_token }
 *   -> POST enterprises?projectId=...&signupUrlName=...&enterpriseToken=... -> creates enterprise
 */
export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireAuth(request);
    const body = await parseJsonBody<{
      environment_id: string;
      enterprise_token?: string;
      existing_enterprise_name?: string;
      expected_enterprise_name?: string;
      action?: 'unbind' | 'delete_enterprise' | 'cancel_bind';
    }>(request);

    if (!body.environment_id) {
      return errorResponse('environment_id is required');
    }

    const env = await queryOne<{
      id: string; workspace_id: string; name: string;
      enterprise_name: string | null; signup_url_name: string | null;
      pubsub_topic: string | null;
      workspace_default_pubsub_topic: string | null;
    }>(
      `SELECT e.id, e.workspace_id, e.name, e.enterprise_name, e.signup_url_name, e.pubsub_topic,
              w.default_pubsub_topic AS workspace_default_pubsub_topic
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
       WHERE e.id = $1`,
      [body.environment_id]
    );

    if (!env) return errorResponse('Environment not found', 404);
    await requireEnvironmentResourcePermission(auth, body.environment_id, 'environment', 'manage_settings');

    // Effective pubsub topic: environment override > workspace default
    const effectivePubsubTopic = env.pubsub_topic ?? env.workspace_default_pubsub_topic ?? null;

    // ── Cancel pending bind (clear stored signup URL) ────────────────────────
    if (body.action === 'cancel_bind') {
      if (env.enterprise_name) {
        return errorResponse('Environment is already bound to an enterprise', 409);
      }
      if (!env.signup_url_name) {
        return errorResponse('No pending signup URL found', 400);
      }

      await execute(
        'UPDATE environments SET signup_url_name = NULL, updated_at = now() WHERE id = $1',
        [body.environment_id]
      );

      await logAudit({
        workspace_id: env.workspace_id,
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'environment.bind_cancelled',
        resource_type: 'environment',
        resource_id: body.environment_id,
        details: { cleared_signup_url_name: env.signup_url_name },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ cancelled: true });
    }

    // ── Unbind enterprise ─────────────────────────────────────────────────
    if (body.action === 'unbind' || body.action === 'delete_enterprise') {
      const remote = body.action === 'delete_enterprise';
      const previousEnterprise = env.enterprise_name;
      if (!body.expected_enterprise_name) return errorResponse('Confirm the exact enterprise name before changing this binding', 400);
      if (!previousEnterprise) {
        if (!remote) return errorResponse('Environment is not bound to an enterprise', 400);
        const prior = await queryOne(`SELECT 1 FROM audit_log WHERE environment_id = $1
          AND resource_type = 'environment' AND resource_id = $1 AND action = 'environment.enterprise_deleted'
          AND details->>'previous_enterprise' = $2 LIMIT 1`,
          [env.id, body.expected_enterprise_name]);
        if (prior) return jsonResponse({ deleted: true, previous_enterprise: body.expected_enterprise_name });
        return errorResponse('Flash is unbound. Google deletion of the confirmed enterprise cannot be verified.', 409);
      }
      if (body.expected_enterprise_name !== previousEnterprise) {
        return errorResponse('The enterprise binding changed. Refresh and confirm the current enterprise.', 409);
      }

      let dispatch: ((signal?: AbortSignal) => Promise<unknown>) | undefined;
      if (remote) {
        const workspace = await queryOne<{ gcp_project_id: string | null }>(
          'SELECT gcp_project_id FROM workspaces WHERE id = $1', [env.workspace_id]);
        if (!workspace?.gcp_project_id) return errorResponse('Workspace has no GCP project configured');
        dispatch = await prepareAmapiCall(previousEnterprise, env.workspace_id, {
          method: 'DELETE', projectId: workspace.gcp_project_id, enterpriseName: previousEnterprise,
          resourceType: 'enterprises', resourceId: previousEnterprise.split('/').pop(),
        });
      }
      let remoteComplete = false;
      let remoteAlreadyAbsent = false;
      try {
        await transaction(async client => {
          await lockMembershipWorkspaces(client, [env.workspace_id]);
          const binding = await client.query('SELECT enterprise_name FROM environments WHERE id = $1 FOR UPDATE', [env.id]);
          if (binding.rows[0]?.enterprise_name !== previousEnterprise) {
            throw errorResponse('The enterprise binding changed. Refresh before retrying.', 409);
          }
          await requireEnvironmentLifecyclePermission(client, auth, env.id, 'manage_settings');
          if (dispatch) {
            try {
              await dispatch(AbortSignal.timeout(30000));
            } catch (err) {
              const status = getAmapiErrorHttpStatus(err);
              if (status !== 404) throw errorResponse(
                'Google enterprise deletion could not be confirmed. Flash retained the binding.', status ?? 502);
              remoteAlreadyAbsent = true;
            }
            remoteComplete = true;
          }
          await cleanupEnterpriseReferences(client, env.id);
          await logAudit({
            workspace_id: env.workspace_id, environment_id: env.id, user_id: auth.user.id,
            action: remote ? 'environment.enterprise_deleted' : 'environment.enterprise_unbound',
            resource_type: 'environment', resource_id: env.id,
            details: { previous_enterprise: previousEnterprise, ...(remote ? { remote_already_absent: remoteAlreadyAbsent } : {}) },
            ip_address: getClientIp(request),
          }, client);
        });
      } catch (err) {
        if (!remoteComplete) throw err;
        await logAudit({
          workspace_id: env.workspace_id, environment_id: env.id, user_id: auth.user.id,
          action: 'environment.enterprise_cleanup_failed', resource_type: 'environment', resource_id: env.id,
          details: { previous_enterprise: previousEnterprise, remote_deleted: true }, ip_address: getClientIp(request),
        });
        return errorResponse('Google enterprise is deleted, but Flash cleanup could not be confirmed. Retry Unbind for the same enterprise.', 502);
      }
      return jsonResponse({ [remote ? 'deleted' : 'unbound']: true, previous_enterprise: previousEnterprise });
    }

    if (env.enterprise_name) {
      return errorResponse('Environment is already bound to an enterprise', 409);
    }

    const workspace = await queryOne<{ gcp_project_id: string | null }>(
      'SELECT gcp_project_id FROM workspaces WHERE id = $1',
      [env.workspace_id]
    );

    if (!workspace?.gcp_project_id) {
      return errorResponse('Workspace must have a GCP project ID configured. Upload service account credentials first.');
    }

    const projectId = workspace.gcp_project_id;

    // ── Attach existing enterprise (orphan recovery) ─────────────────────
    if (body.existing_enterprise_name) {
      const existingEnterpriseName = body.existing_enterprise_name.trim();
      if (!/^enterprises\/[A-Za-z0-9._-]+$/.test(existingEnterpriseName)) {
        return errorResponse('existing_enterprise_name must look like enterprises/<id>');
      }

      const alreadyLinked = await queryOne<{ id: string; name: string }>(
        `SELECT id, name
         FROM environments
         WHERE enterprise_name = $1 AND id <> $2`,
        [existingEnterpriseName, body.environment_id]
      );
      if (alreadyLinked) {
        return errorResponse(`Enterprise is already attached to environment "${alreadyLinked.name}"`, 409);
      }

      try {
        const enterprise = await amapiCall<{
          name: string;
          enterpriseDisplayName?: string;
          pubsubTopic?: string;
        }>(
          existingEnterpriseName,
          env.workspace_id,
          {
            method: 'GET',
            projectId,
            enterpriseName: existingEnterpriseName,
            resourceType: 'enterprises',
            resourceId: existingEnterpriseName.split('/').pop(),
          }
        );

        await execute(
          `UPDATE environments
           SET enterprise_name = $1,
               enterprise_display_name = $2,
               pubsub_topic = $3,
               signup_url_name = NULL,
               updated_at = now()
           WHERE id = $4`,
          [
            enterprise.name,
            enterprise.enterpriseDisplayName ?? env.name ?? BRAND.defaultEnterpriseName,
            enterprise.pubsubTopic ?? null,
            body.environment_id,
          ]
        );

        // Push the default safety-net policy to AMAPI now that the enterprise is available
        try {
          await pushAllPoliciesToAmapi({
            environmentId: body.environment_id,
            workspaceId: env.workspace_id,
            enterpriseName: enterprise.name,
            projectId,
          });
        } catch (policyErr) {
          console.warn('Failed to push default policy to AMAPI:', policyErr instanceof Error ? policyErr.message : policyErr);
        }

        // Push signinDetails if sign-in enrollment was previously configured
        try {
          await syncSigninDetailsToAmapi(body.environment_id);
        } catch (signinErr) {
          console.warn('Failed to sync signinDetails after enterprise attach:', signinErr instanceof Error ? signinErr.message : signinErr);
        }

        let bootstrap: { imported_devices: number; truncated: boolean; error?: string } = {
          imported_devices: 0,
          truncated: false,
        };
        try {
          const bootstrapResult = await bootstrapDevicesForAttachedEnterprise({
            environmentId: body.environment_id,
            workspaceId: env.workspace_id,
            enterpriseName: enterprise.name,
            projectId,
          });
          bootstrap = bootstrapResult;
        } catch (bootstrapErr) {
          const bootstrapMsg = bootstrapErr instanceof Error ? bootstrapErr.message : 'Unknown error';
          console.error('Attached enterprise bootstrap sync failed:', bootstrapMsg);
          bootstrap = {
            imported_devices: 0,
            truncated: false,
            error: 'Bootstrap device import failed. Run a sync to import devices.',
          };
        }

        await logAudit({
          workspace_id: env.workspace_id,
          environment_id: body.environment_id,
          user_id: auth.user.id,
          action: 'environment.enterprise_attached',
          resource_type: 'environment',
          resource_id: body.environment_id,
          details: {
            enterprise_name: enterprise.name,
            bootstrap_devices_imported: bootstrap.imported_devices,
            bootstrap_truncated: bootstrap.truncated,
            bootstrap_failed: !!bootstrap.error,
            ...(bootstrap.error ? { bootstrap_error: bootstrap.error } : {}),
          },
          ip_address: getClientIp(request),
        });

        return jsonResponse({
          enterprise: {
            name: enterprise.name,
            display_name: enterprise.enterpriseDisplayName ?? env.name ?? BRAND.defaultEnterpriseName,
            pubsub_topic: enterprise.pubsubTopic ?? null,
          },
          bootstrap_sync: bootstrap,
          ...(bootstrap.error ? { warning: bootstrap.error } : {}),
        });
      } catch (err) {
        const status = getAmapiErrorHttpStatus(err) ?? 502;
        return errorResponse(
          `Failed to attach existing enterprise: ${err instanceof Error ? err.message : 'Unknown error'}`,
          status
        );
      }
    }

    // ── Step 2: Finalize binding with enterprise_token ──────────────────
    if (body.enterprise_token) {
      if (!env.signup_url_name) {
        return errorResponse('No pending signup URL found. Start the bind process first.');
      }

      try {
        const enterpriseBody: {
          enterpriseDisplayName: string;
          enabledNotificationTypes?: string[];
          pubsubTopic?: string;
        } = {
          enterpriseDisplayName: env.name || BRAND.defaultEnterpriseName,
        };

        // AMAPI requires pubsubTopic when notifications are enabled.
        if (effectivePubsubTopic) {
          enterpriseBody.pubsubTopic = effectivePubsubTopic;
          enterpriseBody.enabledNotificationTypes = [
            'ENROLLMENT',
            'STATUS_REPORT',
            'COMMAND',
            'USAGE_LOGS',
            'ENTERPRISE_UPGRADE',
          ];
        }

        // AMAPI enterprises.create:
        // POST https://androidmanagement.googleapis.com/v1/enterprises
        //   ?projectId=...&signupUrlName=...&enterpriseToken=...
        const enterprise = await amapiCall<{
          name: string;
          enterpriseDisplayName: string;
          pubsubTopic?: string;
        }>(
          `enterprises?projectId=${encodeURIComponent(projectId)}&signupUrlName=${encodeURIComponent(env.signup_url_name)}&enterpriseToken=${encodeURIComponent(body.enterprise_token)}`,
          env.workspace_id,
          {
            method: 'POST',
            projectId,
            body: enterpriseBody,
          }
        );

        // Store enterprise details
        await execute(
          `UPDATE environments
           SET enterprise_name = $1,
               enterprise_display_name = $2,
               pubsub_topic = COALESCE($3, pubsub_topic),
               signup_url_name = NULL,
               updated_at = now()
           WHERE id = $4`,
          [enterprise.name, enterprise.enterpriseDisplayName, enterprise.pubsubTopic ?? null, body.environment_id]
        );

        // Push the default safety-net policy to AMAPI now that the enterprise is available
        try {
          await pushAllPoliciesToAmapi({
            environmentId: body.environment_id,
            workspaceId: env.workspace_id,
            enterpriseName: enterprise.name,
            projectId,
          });
        } catch (policyErr) {
          console.warn('Failed to push default policy to AMAPI:', policyErr instanceof Error ? policyErr.message : policyErr);
        }

        // Push signinDetails if sign-in enrollment was previously configured
        try {
          await syncSigninDetailsToAmapi(body.environment_id);
        } catch (signinErr) {
          console.warn('Failed to sync signinDetails after enterprise bind:', signinErr instanceof Error ? signinErr.message : signinErr);
        }

        await logAudit({
          workspace_id: env.workspace_id,
          environment_id: body.environment_id,
          user_id: auth.user.id,
          action: 'environment.enterprise_bound',
          resource_type: 'environment',
          resource_id: body.environment_id,
          details: { enterprise_name: enterprise.name },
          ip_address: getClientIp(request),
        });

        return jsonResponse({
          enterprise: {
            name: enterprise.name,
            display_name: enterprise.enterpriseDisplayName,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Enterprise creation failed:', msg);
        return errorResponse('Enterprise binding failed. Please try again or contact support.', getAmapiErrorHttpStatus(err) ?? 502);
      }
    }

    // ── Step 1: Create signup URL ───────────────────────────────────────
    const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://localhost:8888';
    const callbackUrl = `${baseUrl}/settings/enterprise/callback?environment_id=${body.environment_id}`;

    try {
      // AMAPI signupUrls.create:
      // POST https://androidmanagement.googleapis.com/v1/signupUrls
      //   ?projectId=...&callbackUrl=...
      const signupUrl = await amapiCall<{ name: string; url: string }>(
        `signupUrls?projectId=${encodeURIComponent(projectId)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        env.workspace_id,
        { method: 'POST', projectId }
      );

      // Store the signup URL name for step 2
      await execute(
        'UPDATE environments SET signup_url_name = $1, updated_at = now() WHERE id = $2',
        [signupUrl.name, body.environment_id]
      );

      await logAudit({
        workspace_id: env.workspace_id,
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'environment.bind_started',
        resource_type: 'environment',
        resource_id: body.environment_id,
        ip_address: getClientIp(request),
      });

      return jsonResponse({ signup_url: signupUrl.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('SignupUrl creation failed:', msg);
      return errorResponse('Failed to create signup URL. Please try again or contact support.', getAmapiErrorHttpStatus(err) ?? 502);
    }
  } catch (err) {
    // Handle thrown Response objects from requireAuth/parseJsonBody
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Bind handler error:', msg);
    return errorResponse('Internal server error', 500);
  }
};

/**
 * Push ALL policies in the environment to AMAPI after enterprise binding.
 * Each policy is synced via syncPolicyDerivativesForPolicy which handles:
 *   - Building the full AMAPI payload (with app/network deployments merged)
 *   - PATCHing to AMAPI (creating the AMAPI policy resource)
 *   - Generating scope-specific derivatives (group, device, environment)
 *   - Storing amapi_name and derivatives in the local DB
 * Failures are logged but do not block the bind response.
 */
async function pushAllPoliciesToAmapi(input: {
  environmentId: string;
  workspaceId: string;
  enterpriseName: string;
  projectId: string;
}): Promise<{ synced: number; failed: number }> {
  const amapiContext = {
    workspace_id: input.workspaceId,
    gcp_project_id: input.projectId,
    enterprise_name: input.enterpriseName,
  };

  const policies = await query<{ id: string; config: Record<string, unknown> | null }>(
    'SELECT id, config FROM policies WHERE environment_id = $1',
    [input.environmentId]
  );

  let synced = 0;
  let failed = 0;
  for (const policy of policies) {
    try {
      // Strip deployment-managed fields; preserve authored connectivity controls.
      const raw = (policy.config ?? {}) as Record<string, unknown>;
      const cleanBase = preparePolicyBaseForDerivativeGeneration(raw);

      await syncPolicyDerivativesForPolicy({
        policyId: policy.id,
        environmentId: input.environmentId,
        baseConfig: cleanBase,
        amapiContext,
      });

      // Mark as production now that it's pushed to AMAPI
      await execute(
        `UPDATE policies SET status = 'production', updated_at = now()
         WHERE id = $1 AND status = 'draft'`,
        [policy.id]
      );
      synced++;
    } catch (err) {
      console.warn(
        `pushAllPoliciesToAmapi: policy ${policy.id} failed:`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }
  return { synced, failed };
}

async function bootstrapDevicesForAttachedEnterprise(input: {
  environmentId: string;
  workspaceId: string;
  enterpriseName: string;
  projectId: string;
}): Promise<{ imported_devices: number; truncated: boolean }> {
  let importedDevices = 0;
  let pageToken: string | undefined;
  let truncated = false;

  do {
    const remaining = BOOTSTRAP_DEVICE_MAX - importedDevices;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const pageSize = Math.min(BOOTSTRAP_DEVICE_PAGE_SIZE, remaining);
    const path = pageToken
      ? `${input.enterpriseName}/devices?pageSize=${pageSize}&pageToken=${encodeURIComponent(pageToken)}`
      : `${input.enterpriseName}/devices?pageSize=${pageSize}`;

    const response = await amapiCall<AmapiBootstrapDeviceListResponse>(
      path,
      input.workspaceId,
      {
        projectId: input.projectId,
        enterpriseName: input.enterpriseName,
        resourceType: 'devices',
      }
    );

    for (const device of response.devices ?? []) {
      if (!device.name) continue;
      const hardwareInfo = device.hardwareInfo ?? {};
      const softwareInfo = device.softwareInfo ?? {};
      const networkInfo = device.networkInfo ?? {};
      const normalizedImei = resolveAmapiDeviceImei(networkInfo);

      await execute(
        `INSERT INTO devices (
           id, environment_id, amapi_name, serial_number, imei,
           manufacturer, model, os_version, security_patch_level,
           state, ownership, management_mode, policy_compliant,
           enrollment_time, last_status_report_at, snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (amapi_name) DO UPDATE SET
           environment_id = EXCLUDED.environment_id,
           serial_number = COALESCE(EXCLUDED.serial_number, devices.serial_number),
           imei = COALESCE(EXCLUDED.imei, devices.imei),
           manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
           model = COALESCE(EXCLUDED.model, devices.model),
           os_version = COALESCE(EXCLUDED.os_version, devices.os_version),
           security_patch_level = COALESCE(EXCLUDED.security_patch_level, devices.security_patch_level),
           state = COALESCE(EXCLUDED.state, devices.state),
           ownership = COALESCE(EXCLUDED.ownership, devices.ownership),
           management_mode = COALESCE(EXCLUDED.management_mode, devices.management_mode),
           policy_compliant = EXCLUDED.policy_compliant,
           enrollment_time = COALESCE(EXCLUDED.enrollment_time, devices.enrollment_time),
           last_status_report_at = COALESCE(EXCLUDED.last_status_report_at, devices.last_status_report_at),
           snapshot = EXCLUDED.snapshot,
           updated_at = now(),
           deleted_at = NULL`,
        [
          crypto.randomUUID(),
          input.environmentId,
          device.name,
          hardwareInfo.serialNumber ?? null,
          normalizedImei,
          hardwareInfo.manufacturer ?? hardwareInfo.brand ?? null,
          hardwareInfo.model ?? null,
          softwareInfo.androidVersion ?? null,
          softwareInfo.securityPatchLevel ?? null,
          device.state ?? 'ACTIVE',
          device.ownership ?? null,
          device.managementMode ?? null,
          device.policyCompliant === true,
          device.enrollmentTime ?? null,
          device.lastStatusReportTime ?? null,
          JSON.stringify(device),
        ]
      );

      importedDevices += 1;
      if (importedDevices >= BOOTSTRAP_DEVICE_MAX) break;
    }

    pageToken = response.nextPageToken;
    if (pageToken && importedDevices >= BOOTSTRAP_DEVICE_MAX) {
      truncated = true;
      break;
    }
  } while (pageToken);

  // Assign ungrouped devices to the environment's root group so they are
  // visible when the UI auto-selects the only group.
  if (importedDevices > 0) {
    const rootGroup = await queryOne<{ id: string }>(
      `SELECT id FROM groups
       WHERE environment_id = $1 AND parent_group_id IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [input.environmentId]
    );
    if (rootGroup) {
      await execute(
        `UPDATE devices SET group_id = $1, updated_at = now()
         WHERE environment_id = $2 AND group_id IS NULL AND deleted_at IS NULL`,
        [rootGroup.id, input.environmentId]
      );
    }
  }

  return { imported_devices: importedDevices, truncated };
}

/**
 * Shared cleanup logic for unbind and delete_enterprise.
 * Clears all local references to the enterprise so the environment
 * can be rebound to a new enterprise cleanly.
 */
async function cleanupEnterpriseReferences(client: PoolClient, environmentId: string): Promise<void> {
  await client.query(
    `UPDATE environments
     SET enterprise_name = NULL, enterprise_display_name = NULL,
         signup_url_name = NULL, updated_at = now()
     WHERE id = $1`,
    [environmentId]
  );

  await client.query(
    `UPDATE policies SET amapi_name = NULL, status = 'draft', updated_at = now()
     WHERE environment_id = $1`,
    [environmentId]
  );

  // Derivatives belong to the old enterprise. Assignment rows are local intent
  // and must survive so rebinding can recreate the same topology.
  await client.query(
    'DELETE FROM policy_derivatives WHERE environment_id = $1',
    [environmentId]
  );

  await client.query(
    `UPDATE enrollment_tokens
     SET amapi_name = NULL, amapi_value = NULL, qr_data = NULL,
         amapi_expiration_timestamp = NULL, updated_at = now()
     WHERE environment_id = $1`,
    [environmentId]
  );

  // Keep policy_id as the legacy direct-assignment fallback. Only the remote
  // synchronization marker is invalid after detaching the enterprise.
  await client.query(
    `UPDATE devices SET last_policy_sync_name = NULL, updated_at = now()
     WHERE environment_id = $1`,
    [environmentId]
  );
}
