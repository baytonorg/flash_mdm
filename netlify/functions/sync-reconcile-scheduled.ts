import { query, queryOne, execute, transaction } from './_lib/db.js';
import { amapiCall } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import {
  resolveAmapiDeviceImei,
  type AmapiTelephonyInfo,
} from './_lib/amapi-device-network.js';
import { enqueueOutstandingCommandReconciliations } from './_lib/command-operation-ledger.js';
import { internalFunctionUrl } from './_lib/runtime.js';

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
    imei?: string;
    meid?: string;
    wifiMacAddress?: string;
    networkOperatorName?: string;
    telephonyInfos?: AmapiTelephonyInfo[];
    // Compatibility for snapshots captured against the obsolete singular shape.
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

interface DeviceLineageRow {
  id: string;
  amapi_name: string;
  serial_number: string | null;
  imei: string | null;
  deleted_at: string | null;
  enrollment_time: string | null;
  last_status_report_at: string | null;
  created_at: string | null;
}

const DEVICE_UPSERT_SQL = `INSERT INTO devices (
   id, environment_id, amapi_name, name, serial_number, imei,
   manufacturer, model, os_version, security_patch_level,
   state, ownership, management_mode, policy_compliant,
   enrollment_time, last_status_report_at, previous_device_names, snapshot
 )
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
 ON CONFLICT (amapi_name) DO UPDATE SET
   environment_id = EXCLUDED.environment_id,
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
   enrollment_time = COALESCE(EXCLUDED.enrollment_time, devices.enrollment_time),
   last_status_report_at = COALESCE(EXCLUDED.last_status_report_at, devices.last_status_report_at),
   previous_device_names = COALESCE(EXCLUDED.previous_device_names, devices.previous_device_names),
   snapshot = EXCLUDED.snapshot,
   updated_at = now(),
   deleted_at = NULL`;

function timestampOrZero(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function selectCanonicalPredecessor(
  rows: DeviceLineageRow[],
  previousNames: string[],
  serialNumber: string | null,
  imei: string | null
): DeviceLineageRow {
  return [...rows].sort((left, right) => {
    const score = (row: DeviceLineageRow) => [
      row.deleted_at ? 0 : 1,
      imei !== null && row.imei === imei ? 1 : 0,
      serialNumber !== null && row.serial_number === serialNumber ? 1 : 0,
      timestampOrZero(row.enrollment_time),
      timestampOrZero(row.last_status_report_at),
      timestampOrZero(row.created_at),
      previousNames.indexOf(row.amapi_name),
    ];
    const leftScore = score(left);
    const rightScore = score(right);
    for (let index = 0; index < leftScore.length; index += 1) {
      if (leftScore[index] !== rightScore[index]) {
        return rightScore[index] - leftScore[index];
      }
    }
    return left.id.localeCompare(right.id);
  })[0];
}

function isAmapiNameUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const pgError = error as { code?: string; constraint?: string; message?: string };
  return pgError.code === '23505'
    && (pgError.constraint === 'devices_amapi_name_key'
      || pgError.message?.includes('devices_amapi_name_key') === true);
}

export default async (request: Request) => {
  console.log('Reconciliation scheduled function started');
  const stats = { environments_checked: 0, errors: 0 };

  try {
    // Get all active environments with an enterprise binding
    const environments = await listReconcilableEnvironments();

    console.log(`Reconciling ${environments.length} environments`);

    for (const env of environments) {
      stats.environments_checked++;
      try {
        await reconcileEnvironment(env);
      } catch (err) {
        stats.errors++;
        console.error(`Failed to reconcile environment ${env.id}:`, err);
      }
    }

    const queuedReconciliations = await enqueueOutstandingCommandReconciliations();
    if (queuedReconciliations > 0) {
      try {
        await fetch(internalFunctionUrl(request, 'sync-process-background'), {
          method: 'POST',
          headers: { 'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET ?? '' },
        });
      } catch (triggerError) {
        console.warn('Failed to trigger command reconciliation worker:', triggerError);
      }
    }

    console.log('Reconciliation completed');
    return new Response(JSON.stringify({
      message: stats.errors > 0 ? 'Reconciliation completed with errors' : 'Reconciliation completed',
      stats,
    }), {
      status: stats.errors > 0 ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Reconciliation error:', err);
    return new Response(JSON.stringify({ error: 'Reconciliation failed', stats }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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

        const hardwareInfo = device.hardwareInfo ?? {};
        const softwareInfo = device.softwareInfo ?? {};
        const networkInfo = device.networkInfo ?? {};
        const normalizedImei = resolveAmapiDeviceImei(networkInfo);
        const modelStr = (hardwareInfo.model as string) ?? 'Device';
        const serialStr = (hardwareInfo.serialNumber as string) ?? device.name.split('/').pop() ?? '';
        const autoName = `${modelStr}_${serialStr}`;
        const previousNames = [...new Set(
          (device.previousDeviceNames ?? [])
            .filter((name): name is string => typeof name === 'string' && name.length > 0)
            .filter((name) => name !== device.name)
        )];
        const upsertParams = [
          crypto.randomUUID(),
          env.id,
          device.name,
          autoName,
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
          previousNames.length > 0 ? previousNames : null,
          JSON.stringify(device),
        ];

        if (previousNames.length === 0) {
          const activeSuccessor = await queryOne<{ id: string; amapi_name: string }>(
            `SELECT id, amapi_name
             FROM devices
             WHERE environment_id = $1
               AND deleted_at IS NULL
               AND amapi_name <> $2
               AND previous_device_names @> ARRAY[$2]::text[]
             ORDER BY last_status_report_at DESC NULLS LAST,
                      enrollment_time DESC NULLS LAST,
                      created_at DESC
             LIMIT 1`,
            [env.id, device.name]
          );
          if (activeSuccessor) {
            console.warn('reconciliation: skipped historical predecessor with an active successor', {
              environment_id: env.id,
              historical_device_amapi_name: device.name,
              successor_device_id: activeSuccessor.id,
              successor_amapi_name: activeSuccessor.amapi_name,
            });
            continue;
          }

          await execute(DEVICE_UPSERT_SQL, upsertParams);
          seenAmapiNames.add(device.name);
          continue;
        }

        try {
          await transaction(async (client) => {
            await client.query(
              'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
              [`${env.id}:${device.name}`]
            );
            const lineageResult = await client.query<DeviceLineageRow>(
              `SELECT id, amapi_name, serial_number, imei, deleted_at,
                      enrollment_time, last_status_report_at, created_at
               FROM devices
               WHERE environment_id = $1
                 AND (amapi_name = $2 OR amapi_name = ANY($3::text[]))
               ORDER BY id
               FOR UPDATE`,
              [env.id, device.name, previousNames]
            );
            const currentRow = lineageResult.rows.find((row) => row.amapi_name === device.name);
            const previousMatches = lineageResult.rows.filter((row) =>
              previousNames.includes(row.amapi_name)
            );

            if (!currentRow && previousMatches.length > 0) {
              const canonicalPredecessor = selectCanonicalPredecessor(
                previousMatches,
                previousNames,
                typeof hardwareInfo.serialNumber === 'string' ? hardwareInfo.serialNumber : null,
                normalizedImei
              );
              await client.query(
                `UPDATE devices SET amapi_name = $1, updated_at = now()
                 WHERE id = $2`,
                [device.name, canonicalPredecessor.id]
              );

              if (previousMatches.length > 1) {
                console.warn('reconciliation: multiple predecessors matched; canonicalized one record', {
                  environment_id: env.id,
                  device_amapi_name: device.name,
                  matched_count: previousMatches.length,
                  canonical_device_id: canonicalPredecessor.id,
                });
              }
            } else if (currentRow && previousMatches.length > 0) {
              console.warn('reconciliation: retained existing current row and preserved predecessor history', {
                environment_id: env.id,
                device_amapi_name: device.name,
                current_device_id: currentRow.id,
                predecessor_count: previousMatches.length,
              });
            }

            await client.query(DEVICE_UPSERT_SQL, upsertParams);
          });
        } catch (error) {
          if (!isAmapiNameUniqueViolation(error)) throw error;
          console.warn('reconciliation: concurrent lineage update won; preserving current row', {
            environment_id: env.id,
            device_amapi_name: device.name,
          });
          await execute(DEVICE_UPSERT_SQL, upsertParams);
        }

        seenAmapiNames.add(device.name);
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    devicePaginationCompleted = true;
  } catch (err) {
    devicePaginationError = err;
    console.error(`Environment ${env.id}: device pagination did not complete; skipping soft-delete pass`, err);
  }

  // Mark devices not seen in the AMAPI response as potentially deleted
  if (devicePaginationCompleted) {
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

  // Assign ungrouped devices to the environment's root group so they are
  // visible when the UI auto-selects the only group.
  if (seenAmapiNames.size > 0) {
    const rootGroup = await queryOne<{ id: string }>(
      `SELECT id FROM groups
       WHERE environment_id = $1 AND parent_group_id IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [env.id]
    );
    if (rootGroup) {
      await execute(
        `UPDATE devices SET group_id = $1, updated_at = now()
         WHERE environment_id = $2 AND group_id IS NULL AND deleted_at IS NULL`,
        [rootGroup.id, env.id]
      );
    }
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
