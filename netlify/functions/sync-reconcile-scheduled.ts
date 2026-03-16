import { query, execute } from './_lib/db.js';
import { amapiCall } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';

export const config = {
  schedule: '*/15 * * * *',
};

const ENROLLMENT_TOKEN_RETENTION_GRACE_HOURS = 24;

interface AmapiDevice {
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
    telephonyInfo?: Array<{
      imei?: string;
      meid?: string;
      phoneNumber?: string;
      carrierName?: string;
      iccId?: string;
    }>;
  };
  state?: string;
  ownership?: string;
  managementMode?: string;
  policyCompliant?: boolean;
  enrollmentTime?: string;
  previousDeviceNames?: string[];
  appliedPolicyName?: string;
  lastStatusReportTime?: string;
  [key: string]: unknown;
}

interface AmapiDeviceListResponse {
  devices?: AmapiDevice[];
  nextPageToken?: string;
}

interface AmapiEnrollmentToken {
  name: string;
  [key: string]: unknown;
}

interface AmapiEnrollmentTokenListResponse {
  enrollmentTokens?: AmapiEnrollmentToken[];
  nextPageToken?: string;
}

interface Environment {
  id: string;
  workspace_id: string;
  enterprise_name: string;
  gcp_project_id: string;
}

export default async () => {
  console.log('Reconciliation scheduled function started');

  try {
    // Get all active environments with an enterprise binding
    const environments = await listReconcilableEnvironments();

    console.log(`Reconciling ${environments.length} environments`);

    for (const env of environments) {
      try {
        await reconcileEnvironment(env);
      } catch (err) {
        console.error(`Failed to reconcile environment ${env.id}:`, err);
      }
    }

    console.log('Reconciliation completed');
  } catch (err) {
    console.error('Reconciliation error:', err);
  }
};

async function listReconcilableEnvironments(): Promise<Environment[]> {
  try {
    return await query<Environment>(
      `SELECT e.id, e.workspace_id, e.enterprise_name, w.gcp_project_id
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
       WHERE e.enterprise_name IS NOT NULL
         AND e.deleted_at IS NULL
         AND w.google_credentials_enc IS NOT NULL`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('column e.deleted_at does not exist')) throw err;

    // Legacy schema: environments table has no soft-delete column.
    return query<Environment>(
      `SELECT e.id, e.workspace_id, e.enterprise_name, w.gcp_project_id
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
       WHERE e.enterprise_name IS NOT NULL
         AND w.google_credentials_enc IS NOT NULL`
    );
  }
}

async function reconcileEnvironment(env: Environment): Promise<void> {
  console.log(`Reconciling environment ${env.id} (${env.enterprise_name})`);

  const seenAmapiNames = new Set<string>();
  let pageToken: string | undefined;
  let devicePaginationCompleted = false;
  let devicePaginationError: unknown;

  // Paginate through all devices from AMAPI
  try {
    do {
      const path = pageToken
        ? `${env.enterprise_name}/devices?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
        : `${env.enterprise_name}/devices?pageSize=100`;

      const response = await amapiCall<AmapiDeviceListResponse>(
        path,
        env.workspace_id,
        {
          projectId: env.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'devices',
        }
      );

      const devices = response.devices ?? [];

      for (const device of devices) {
        if (!device.name) continue;
        seenAmapiNames.add(device.name);

        // Handle previousDeviceNames for deduplication
        if (device.previousDeviceNames?.length) {
          for (const prevName of device.previousDeviceNames) {
            // Update any existing records with the old name to point to the new name
            await execute(
              `UPDATE devices SET amapi_name = $1, updated_at = now()
               WHERE environment_id = $2 AND amapi_name = $3`,
              [device.name, env.id, prevName]
            );
            seenAmapiNames.add(prevName);
          }
        }

        // Upsert device
        const hardwareInfo = device.hardwareInfo ?? {};
        const softwareInfo = device.softwareInfo ?? {};
        const networkInfo = device.networkInfo ?? {};
        const modelStr = (hardwareInfo.model as string) ?? 'Device';
        const serialStr = (hardwareInfo.serialNumber as string) ?? device.name?.split('/').pop() ?? '';
        const autoName = `${modelStr}_${serialStr}`;

        await execute(
          `INSERT INTO devices (
             id, environment_id, amapi_name, name, serial_number, imei,
             manufacturer, model, os_version, security_patch_level,
             state, ownership, management_mode, policy_compliant,
             enrollment_time, last_status_report_at, snapshot
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (amapi_name) DO UPDATE SET
             name = COALESCE(devices.name, EXCLUDED.name),
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
             last_status_report_at = COALESCE(EXCLUDED.last_status_report_at, devices.last_status_report_at),
             snapshot = EXCLUDED.snapshot,
             updated_at = now(),
             deleted_at = NULL`,
          [
            crypto.randomUUID(),
            env.id,
            device.name,
            autoName,
            hardwareInfo.serialNumber ?? null,
            networkInfo.telephonyInfo?.[0]?.imei ?? null,
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
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    devicePaginationCompleted = true;
  } catch (err) {
    devicePaginationError = err;
    console.error(`Environment ${env.id}: device pagination did not complete; skipping soft-delete pass`, err);
  }

  // Mark devices not seen in the AMAPI response as potentially deleted
  if (devicePaginationCompleted && seenAmapiNames.size > 0) {
    // Get devices in the DB that we didn't see in AMAPI
    const dbDevices = await query<{ id: string; amapi_name: string }>(
      `SELECT id, amapi_name FROM devices
       WHERE environment_id = $1
         AND deleted_at IS NULL
         AND state != 'DELETED'`,
      [env.id]
    );

    for (const dbDevice of dbDevices) {
      if (!seenAmapiNames.has(dbDevice.amapi_name)) {
        // Device not in AMAPI — mark as potentially deleted
        await execute(
          `UPDATE devices SET
             state = 'DELETED',
             deleted_at = now(),
             updated_at = now()
           WHERE id = $1`,
          [dbDevice.id]
        );

        await logAudit({
          environment_id: env.id,
          actor_type: 'system',
          visibility_scope: 'privileged',
          action: 'device.deleted_by_reconciliation',
          resource_type: 'device',
          resource_id: dbDevice.id,
          details: { amapi_name: dbDevice.amapi_name },
        });
      }
    }
  }

  try {
    await reconcileEnrollmentTokens(env);
  } catch (err) {
    console.error(`Failed to reconcile enrollment tokens for environment ${env.id}:`, err);
  }

  if (devicePaginationError) {
    throw devicePaginationError;
  }

  console.log(`Environment ${env.id}: reconciled ${seenAmapiNames.size} devices`);
}

async function reconcileEnrollmentTokens(env: Environment): Promise<void> {
  const localTokenRows = await query<{ id: string; amapi_name: string | null; expires_at: string | null }>(
    `SELECT id, amapi_name
            , expires_at
     FROM enrollment_tokens
     WHERE environment_id = $1`,
    [env.id]
  );
  if (localTokenRows.length === 0) return;

  // Hard-delete tokens only after a grace period so delayed enrollment processing can
  // still resolve token metadata (group/policy/sign-in lookup) from local rows.
  const expiredRows = await query<{ id: string }>(
    `DELETE FROM enrollment_tokens
     WHERE environment_id = $1
       AND expires_at IS NOT NULL
       AND expires_at <= now() - ($2::int * interval '1 hour')
     RETURNING id`,
    [env.id, ENROLLMENT_TOKEN_RETENTION_GRACE_HOURS]
  );

  const expiredIds = new Set(expiredRows.map((row) => row.id));
  const remainingLocal = localTokenRows.filter((row) => !expiredIds.has(row.id));
  if (remainingLocal.length === 0) {
    if (expiredRows.length > 0) {
      console.log(`Environment ${env.id}: removed ${expiredRows.length} expired enrollment tokens`);
    }
    return;
  }

  const amapiNames = new Set<string>();
  let pageToken: string | undefined;
  do {
    const path = pageToken
      ? `${env.enterprise_name}/enrollmentTokens?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
      : `${env.enterprise_name}/enrollmentTokens?pageSize=100`;

    const response = await amapiCall<AmapiEnrollmentTokenListResponse>(
      path,
      env.workspace_id,
      {
        projectId: env.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'general',
      }
    );

    for (const token of response.enrollmentTokens ?? []) {
      if (token.name) amapiNames.add(token.name);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  const activeLocal = remainingLocal.filter((row) => {
    if (!row.expires_at) return true;
    return new Date(row.expires_at).getTime() > Date.now();
  });

  const staleIds = activeLocal
    .filter((row) => row.amapi_name && !amapiNames.has(row.amapi_name))
    .map((row) => row.id);

  // Legacy "invalidated" rows from older enrollment-sync behavior can persist forever.
  const orphanedIds = activeLocal
    .filter((row) => !row.amapi_name)
    .map((row) => row.id);

  const idsToRetire = [...new Set([...staleIds, ...orphanedIds])];
  if (idsToRetire.length > 0) {
    await execute(
      `UPDATE enrollment_tokens
       SET amapi_value = NULL,
           qr_data = NULL,
           expires_at = COALESCE(LEAST(expires_at, now()), now()),
           updated_at = now()
       WHERE id = ANY($1::uuid[])`,
      [idsToRetire]
    );
  }

  if (expiredRows.length > 0 || idsToRetire.length > 0) {
    console.log(
      `Environment ${env.id}: removed ${expiredRows.length} expired and retired ${idsToRetire.length} stale enrollment tokens`
    );
  }
}
