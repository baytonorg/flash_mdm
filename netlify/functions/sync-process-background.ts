import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { buildAmapiCommandPayload } from './_lib/amapi-command.js';
import { storeBlob } from './_lib/blobs.js';
import { logAudit } from './_lib/audit.js';
import { assignPolicyToDeviceWithDerivative, ensurePreferredDerivativeForDevicePolicy } from './_lib/policy-derivatives.js';
import { requireInternalCaller } from './_lib/internal-auth.js';
import { dispatchWorkflowEvent } from './_lib/workflow-dispatch.js';
import { buildEnterpriseUpgradeStatus } from './_lib/enterprise-upgrade.js';
import { executeValidatedOutboundWebhook } from './_lib/outbound-webhook.js';

export const config = {
  type: 'background',
};

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const BULK_UPSERT_CHUNK_SIZE = 250;
const ON_CONFLICT_TARGET_MISSING = 'no unique or exclusion constraint matching the ON CONFLICT specification';

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

interface Job {
  id: string;
  job_type: string;
  environment_id: string;
  payload: unknown;
  attempts: number;
}

interface ProcessEventPayload {
  event_message_id: string;
  notification_type: string;
  device_amapi_name: string | null;
  payload: Record<string, unknown>;
}

interface BulkCommandPayload {
  device_amapi_names: string[];
  command_type: string;
  command_data?: Record<string, unknown>;
  workspace_id: string;
  project_id: string;
  enterprise_name: string;
}

function isUsableDevicePayloadSnapshot(
  payload: Record<string, unknown> | null | undefined,
  expectedDeviceAmapiName: string
): payload is Record<string, unknown> {
  if (!payload) return false;
  const name = payload.name;
  return typeof name === 'string' && name === expectedDeviceAmapiName;
}

/**
 * Get environment context needed for AMAPI calls.
 */
async function getEnvironmentContext(environmentId: string) {
  return queryOne<{
    workspace_id: string;
    enterprise_name: string;
    gcp_project_id: string;
  }>(
    `SELECT e.workspace_id, e.enterprise_name, w.gcp_project_id
     FROM environments e
     JOIN workspaces w ON w.id = e.workspace_id
     WHERE e.id = $1`,
    [environmentId]
  );
}

async function syncDeviceApplicationsTable(
  deviceId: string | null,
  applicationReports: unknown,
): Promise<void> {
  if (!deviceId || !Array.isArray(applicationReports)) return;

  try {
    for (const report of applicationReports as Array<Record<string, unknown>>) {
      const packageName = report.packageName as string | undefined;
      if (!packageName) continue;
      await execute(
        `INSERT INTO device_applications (device_id, package_name, display_name, version_name, version_code, state, source, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (device_id, package_name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           version_name = EXCLUDED.version_name,
           version_code = EXCLUDED.version_code,
           state = EXCLUDED.state,
           source = EXCLUDED.source,
           updated_at = now()`,
        [
          deviceId,
          packageName,
          (report.displayName as string) ?? null,
          (report.versionName as string) ?? null,
          typeof report.versionCode === 'number' ? report.versionCode : null,
          (report.state as string) ?? null,
          (report.applicationSource as string) ?? null,
        ]
      );
    }

    const reportedPackages = (applicationReports as Array<Record<string, unknown>>)
      .map((r) => r.packageName as string)
      .filter(Boolean);

    if (reportedPackages.length > 0) {
      await execute(
        `DELETE FROM device_applications WHERE device_id = $1 AND package_name <> ALL($2::text[])`,
        [deviceId, reportedPackages]
      );
    } else {
      // Empty applicationReports means no apps are reported — remove all stale entries
      await execute(
        'DELETE FROM device_applications WHERE device_id = $1',
        [deviceId]
      );
    }
  } catch (err) {
    console.error('Failed to sync device applications:', err);
  }
}

function toTimestampOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  if (values.length === 0) return [];
  if (values.length <= chunkSize) return [values];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function resolveUsageLogDeviceAmapiName(
  explicitDeviceAmapiName: string | null,
  payload: Record<string, unknown>
): string | null {
  if (explicitDeviceAmapiName?.trim()) return explicitDeviceAmapiName.trim();

  const batchPayload =
    payload.batchUsageLogEvents && typeof payload.batchUsageLogEvents === 'object' && !Array.isArray(payload.batchUsageLogEvents)
      ? payload.batchUsageLogEvents as Record<string, unknown>
      : null;

  const candidates: unknown[] = [
    payload.device,
    batchPayload?.device,
    payload.resourceName,
    payload.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const normalized = candidate.trim();
    if (normalized.includes('/devices/')) {
      const match = normalized.match(/(enterprises\/[^/]+\/devices\/[^/]+)/);
      return match?.[1] ?? normalized;
    }
  }

  return null;
}

function extractLostModeLocationRecords(
  payload: Record<string, unknown>
): Array<{ latitude: number; longitude: number; accuracy: number | null; recorded_at: string; source: string }> {
  const batchPayload =
    payload.batchUsageLogEvents && typeof payload.batchUsageLogEvents === 'object' && !Array.isArray(payload.batchUsageLogEvents)
      ? payload.batchUsageLogEvents as Record<string, unknown>
      : payload;

  const usageLogEvents = Array.isArray(batchPayload.usageLogEvents)
    ? batchPayload.usageLogEvents as Array<Record<string, unknown>>
    : [];

  const fallbackRecordedAt = toTimestampOrNull(batchPayload.retrievalTime ?? payload.retrievalTime) ?? new Date().toISOString();
  const records: Array<{ latitude: number; longitude: number; accuracy: number | null; recorded_at: string; source: string }> = [];

  for (const usageEvent of usageLogEvents) {
    if (!usageEvent || typeof usageEvent !== 'object' || Array.isArray(usageEvent)) continue;

    const lostModeLocationEvent =
      usageEvent.lostModeLocationEvent && typeof usageEvent.lostModeLocationEvent === 'object' && !Array.isArray(usageEvent.lostModeLocationEvent)
        ? usageEvent.lostModeLocationEvent as Record<string, unknown>
        : null;
    if (!lostModeLocationEvent) continue;

    const location =
      lostModeLocationEvent.location && typeof lostModeLocationEvent.location === 'object' && !Array.isArray(lostModeLocationEvent.location)
        ? lostModeLocationEvent.location as Record<string, unknown>
        : null;
    if (!location) continue;

    const latitude = toFiniteNumber(location.latitude ?? location.lat);
    const longitude = toFiniteNumber(location.longitude ?? location.lng ?? location.lon);
    if (latitude === null || longitude === null) continue;

    const accuracy = toFiniteNumber(
      location.accuracy ??
      location.accuracyMeters ??
      lostModeLocationEvent.accuracy ??
      lostModeLocationEvent.accuracyMeters
    );
    const recordedAt = toTimestampOrNull(usageEvent.eventTime) ?? fallbackRecordedAt;

    records.push({
      latitude,
      longitude,
      accuracy,
      recorded_at: recordedAt,
      source: 'lost_mode_usage_log',
    });
  }

  return records;
}

function extractDeviceAmapiNameFromOperationName(operationName: string): string | null {
  const match = operationName.match(/(enterprises\/[^/]+\/devices\/[^/]+)\/operations\/[^/]+$/);
  return match?.[1] ?? null;
}

function extractCommandType(payload: Record<string, unknown>): string | null {
  const metadata = parseJsonObject(payload.metadata);
  const response = parseJsonObject(payload.response);
  const responseCommand = parseJsonObject(response.command);
  const payloadCommand = parseJsonObject(payload.command);
  const responseType =
    typeof response['@type'] === 'string'
      ? String(response['@type'])
      : null;
  if (responseType?.includes('StartLostModeStatus')) return 'START_LOST_MODE';
  if (responseType?.includes('StopLostModeStatus')) return 'STOP_LOST_MODE';

  const typeCandidates = [
    payload.type,
    metadata.type,
    payloadCommand.type,
    responseCommand.type,
  ];
  for (const candidate of typeCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }
  return null;
}

async function syncAppFeedbackFromReports(
  environmentId: string,
  deviceId: string | null,
  deviceAmapiName: string,
  applicationReports: unknown,
): Promise<void> {
  if (!Array.isArray(applicationReports)) return;

  const allRows: Array<{
    id: string;
    environment_id: string;
    device_id: string | null;
    device_amapi_name: string;
    package_name: string;
    feedback_key: string;
    severity: string | null;
    message: string | null;
    data_json: Record<string, unknown>;
    last_update_time: string | null;
    status: string;
  }> = [];

  for (const report of applicationReports as Array<Record<string, unknown>>) {
    const packageName = typeof report.packageName === 'string' ? report.packageName.trim() : '';
    if (!packageName) continue;

    const keyedStates = Array.isArray(report.keyedAppStates)
      ? report.keyedAppStates as Array<Record<string, unknown>>
      : [];

    for (const state of keyedStates) {
      const feedbackKey = typeof state.key === 'string' ? state.key.trim() : '';
      if (!feedbackKey) continue;

      const severity = typeof state.severity === 'string' ? state.severity : null;
      const message = typeof state.message === 'string' ? state.message : null;
      const dataJson = state.data && typeof state.data === 'object' && !Array.isArray(state.data)
        ? state.data
        : null;
      const lastUpdateTime = toTimestampOrNull(state.stateTimestampMillis ?? state.lastUpdateTime);
      const normalizedStatus = severity === 'INFO' ? 'resolved' : 'open';
      allRows.push({
        id: crypto.randomUUID(),
        environment_id: environmentId,
        device_id: deviceId,
        device_amapi_name: deviceAmapiName,
        package_name: packageName,
        feedback_key: feedbackKey,
        severity,
        message,
        data_json: (dataJson ?? {}) as Record<string, unknown>,
        last_update_time: lastUpdateTime,
        status: normalizedStatus,
      });
    }
  }

  if (allRows.length === 0) return;

  const deviceScopedRows = allRows.filter((row) => row.device_id !== null);
  const fleetScopedRows = allRows.filter((row) => row.device_id === null);

  for (const chunk of chunkArray(deviceScopedRows, BULK_UPSERT_CHUNK_SIZE)) {
    try {
      await execute(
        `WITH input_rows AS (
           SELECT *
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id uuid,
             environment_id uuid,
             device_id uuid,
             device_amapi_name text,
             package_name text,
             feedback_key text,
             severity text,
             message text,
             data_json jsonb,
             last_update_time timestamptz,
             status text
           )
         )
         INSERT INTO app_feedback_items (
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, first_reported_at, last_reported_at, last_update_time, status
         )
         SELECT
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, now(), now(), last_update_time, status
         FROM input_rows
         ON CONFLICT (environment_id, device_id, package_name, feedback_key) WHERE device_id IS NOT NULL
         DO UPDATE SET
           severity = EXCLUDED.severity,
           message = EXCLUDED.message,
           data_json = EXCLUDED.data_json,
           device_amapi_name = EXCLUDED.device_amapi_name,
           last_reported_at = now(),
           last_update_time = COALESCE(EXCLUDED.last_update_time, app_feedback_items.last_update_time),
           status = EXCLUDED.status,
           updated_at = now()`,
        [JSON.stringify(chunk)]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes(ON_CONFLICT_TARGET_MISSING)) throw err;
      await execute(
        `WITH input_rows AS (
           SELECT *
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id uuid,
             environment_id uuid,
             device_id uuid,
             device_amapi_name text,
             package_name text,
             feedback_key text,
             severity text,
             message text,
             data_json jsonb,
             last_update_time timestamptz,
             status text
           )
         )
         INSERT INTO app_feedback_items (
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, first_reported_at, last_reported_at, last_update_time, status
         )
         SELECT
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, now(), now(), last_update_time, status
         FROM input_rows
         ON CONFLICT (environment_id, device_id, package_name, feedback_key)
         DO UPDATE SET
           severity = EXCLUDED.severity,
           message = EXCLUDED.message,
           data_json = EXCLUDED.data_json,
           device_amapi_name = EXCLUDED.device_amapi_name,
           last_reported_at = now(),
           last_update_time = COALESCE(EXCLUDED.last_update_time, app_feedback_items.last_update_time),
           status = EXCLUDED.status,
           updated_at = now()`,
        [JSON.stringify(chunk)]
      );
    }
  }

  for (const chunk of chunkArray(fleetScopedRows, BULK_UPSERT_CHUNK_SIZE)) {
    try {
      await execute(
        `WITH input_rows AS (
           SELECT *
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id uuid,
             environment_id uuid,
             device_id uuid,
             device_amapi_name text,
             package_name text,
             feedback_key text,
             severity text,
             message text,
             data_json jsonb,
             last_update_time timestamptz,
             status text
           )
         )
         INSERT INTO app_feedback_items (
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, first_reported_at, last_reported_at, last_update_time, status
         )
         SELECT
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, now(), now(), last_update_time, status
         FROM input_rows
         ON CONFLICT (environment_id, package_name, feedback_key) WHERE device_id IS NULL
         DO UPDATE SET
           severity = EXCLUDED.severity,
           message = EXCLUDED.message,
           data_json = EXCLUDED.data_json,
           device_amapi_name = EXCLUDED.device_amapi_name,
           last_reported_at = now(),
           last_update_time = COALESCE(EXCLUDED.last_update_time, app_feedback_items.last_update_time),
           status = EXCLUDED.status,
           updated_at = now()`,
        [JSON.stringify(chunk)]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes(ON_CONFLICT_TARGET_MISSING)) throw err;
      await execute(
        `WITH input_rows AS (
           SELECT *
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id uuid,
             environment_id uuid,
             device_id uuid,
             device_amapi_name text,
             package_name text,
             feedback_key text,
             severity text,
             message text,
             data_json jsonb,
             last_update_time timestamptz,
             status text
           )
         )
         INSERT INTO app_feedback_items (
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, first_reported_at, last_reported_at, last_update_time, status
         )
         SELECT
           id, environment_id, device_id, device_amapi_name, package_name, feedback_key,
           severity, message, data_json, now(), now(), last_update_time, status
         FROM input_rows
         ON CONFLICT (environment_id, device_id, package_name, feedback_key)
         DO UPDATE SET
           severity = EXCLUDED.severity,
           message = EXCLUDED.message,
           data_json = EXCLUDED.data_json,
           device_amapi_name = EXCLUDED.device_amapi_name,
           last_reported_at = now(),
           last_update_time = COALESCE(EXCLUDED.last_update_time, app_feedback_items.last_update_time),
           status = EXCLUDED.status,
           updated_at = now()`,
        [JSON.stringify(chunk)]
      );
    }
  }
}

async function processEnterpriseUpgrade(
  environmentId: string,
): Promise<void> {
  const ctx = await getEnvironmentContext(environmentId);
  if (!ctx?.enterprise_name) return;

  const enterprise = await amapiCall<{
    enterpriseType?: string;
    managedGooglePlayAccountsEnterpriseType?: string;
    managedGoogleDomainType?: string;
  }>(
    ctx.enterprise_name,
    ctx.workspace_id,
    {
      method: 'GET',
      projectId: ctx.gcp_project_id,
      enterpriseName: ctx.enterprise_name,
      resourceType: 'enterprises',
      resourceId: ctx.enterprise_name.split('/').pop(),
    }
  );

  await execute(
    `UPDATE environments
     SET enterprise_features = COALESCE(enterprise_features, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      environmentId,
      JSON.stringify({
        enterprise_upgrade_status: {
          ...buildEnterpriseUpgradeStatus(enterprise),
        },
      }),
    ]
  );

  await logAudit({
    environment_id: environmentId,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'environment.enterprise_upgrade_status_synced',
    resource_type: 'environment',
    resource_id: environmentId,
    details: {
      enterprise_type: enterprise.enterpriseType ?? 'ENTERPRISE_TYPE_UNSPECIFIED',
      managed_google_play_accounts_enterprise_type:
        enterprise.managedGooglePlayAccountsEnterpriseType ?? null,
      managed_google_domain_type: enterprise.managedGoogleDomainType ?? null,
    },
  });
}

/**
 * Resolve and assign the effective policy for a newly enrolled device based on
 * its group membership (set from the enrollment token's additionalData) or
 * environment-level policy assignment. This replaces the old token-stored
 * policy_id approach, so policy changes to groups take effect immediately for
 * new enrollments without needing to recreate tokens.
 */
async function syncEnrollmentPolicyFromGroup(
  environmentId: string,
  deviceAmapiName: string,
): Promise<void> {
  const persistedDevice = await queryOne<{ id: string; group_id: string | null }>(
    `SELECT id, group_id
     FROM devices
     WHERE environment_id = $1 AND amapi_name = $2 AND deleted_at IS NULL`,
    [environmentId, deviceAmapiName]
  );
  if (!persistedDevice?.id) return;

  // Resolve effective policy: device assignment > group hierarchy > environment
  let resolvedPolicyId: string | null = null;
  let resolvedPolicySourceType: 'device' | 'group' | 'environment' | null = null;
  let resolvedPolicySourceId: string | null = null;

  // 1. Check for an existing device-level policy assignment
  const deviceAssignment = await queryOne<{ policy_id: string }>(
    `SELECT policy_id FROM policy_assignments
     WHERE scope_type = 'device' AND scope_id = $1`,
    [persistedDevice.id]
  );
  resolvedPolicyId = deviceAssignment?.policy_id ?? null;
  if (resolvedPolicyId) {
    resolvedPolicySourceType = 'device';
    resolvedPolicySourceId = persistedDevice.id;
  }

  // 2. Walk group hierarchy
  if (!resolvedPolicyId && persistedDevice.group_id) {
    const groupAssignment = await queryOne<{ policy_id: string }>(
      `SELECT pa.policy_id
       FROM group_closures gc
       JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
       WHERE gc.descendant_id = $1
       ORDER BY gc.depth ASC
       LIMIT 1`,
      [persistedDevice.group_id]
    );
    resolvedPolicyId = groupAssignment?.policy_id ?? null;
    if (resolvedPolicyId) {
      resolvedPolicySourceType = 'group';
      resolvedPolicySourceId = persistedDevice.group_id;
    }
  }

  // 3. Environment-level
  if (!resolvedPolicyId) {
    const envAssignment = await queryOne<{ policy_id: string }>(
      `SELECT policy_id FROM policy_assignments
       WHERE scope_type = 'environment' AND scope_id = $1
       LIMIT 1`,
      [environmentId]
    );
    resolvedPolicyId = envAssignment?.policy_id ?? null;
    if (resolvedPolicyId) {
      resolvedPolicySourceType = 'environment';
      resolvedPolicySourceId = environmentId;
    }
  }

  if (!resolvedPolicyId) return;

  // H1 fix: Update policy_id and push derivative to AMAPI together.
  // If AMAPI call fails, roll back policy_id so device doesn't get into a stuck state.
  const ctx = await getEnvironmentContext(environmentId);
  if (!ctx?.enterprise_name || !ctx.gcp_project_id) {
    // No AMAPI context — just update the local reference
    await execute(
      'UPDATE devices SET policy_id = $1, updated_at = now() WHERE id = $2',
      [resolvedPolicyId, persistedDevice.id]
    );
    return;
  }

  try {
    const expected = await ensurePreferredDerivativeForDevicePolicy({
      policyId: resolvedPolicyId,
      environmentId,
      deviceId: persistedDevice.id,
      deviceAmapiName,
      amapiContext: {
        workspace_id: ctx.workspace_id,
        gcp_project_id: ctx.gcp_project_id,
        enterprise_name: ctx.enterprise_name,
      },
    });

    // Change guard: compare against the current expected derivative generated from the effective source scope.
    // Hash-aware but fallback-safe: if generation_hash metadata exists, require a metadata hash match too.
    const deviceRow = await queryOne<{ last_policy_sync_name: string | null }>(
      'SELECT last_policy_sync_name FROM devices WHERE id = $1',
      [persistedDevice.id]
    );
    let canNoop = deviceRow?.last_policy_sync_name === expected.derivative.amapi_name;
    let storedGenerationHashForLog: string | null = null;
    if (canNoop) {
      const expectedGenerationHash =
        typeof expected.derivative.metadata?.generation_hash === 'string'
          ? expected.derivative.metadata.generation_hash
          : null;
      if (expectedGenerationHash) {
        const derivativeRow = await queryOne<{ metadata: Record<string, unknown> | string | null }>(
          `SELECT metadata
           FROM policy_derivatives
           WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3
           LIMIT 1`,
          [resolvedPolicyId, expected.derivative.scope_type, expected.derivative.scope_id]
        );
        const derivativeMetadata = parseJsonObject(derivativeRow?.metadata);
        const storedGenerationHash =
          typeof derivativeMetadata.generation_hash === 'string'
            ? derivativeMetadata.generation_hash
            : null;
        storedGenerationHashForLog = storedGenerationHash;
        canNoop = storedGenerationHash === expectedGenerationHash;
      }
    }
    // Defensive guard: a redundant device derivative should never no-op as "correct".
    if (canNoop && expected.device_derivative_redundant && expected.derivative.scope_type === 'device') {
      canNoop = false;
    }

    const expectedGenerationHashForLog =
      typeof expected.derivative.metadata?.generation_hash === 'string'
        ? expected.derivative.metadata.generation_hash
        : null;
    console.info('sync-process: derivative applicability decision', {
      environmentId,
      deviceId: persistedDevice.id,
      expected_scope: `${expected.derivative.scope_type}:${expected.derivative.scope_id}`,
      expected_amapi_name: expected.derivative.amapi_name,
      reason_code: expected.reason_code,
      reason_details: expected.reason_details,
      expected_generation_hash: expectedGenerationHashForLog,
      stored_generation_hash: storedGenerationHashForLog,
      can_noop: canNoop,
      used_device_derivative: expected.used_device_derivative,
      device_derivative_required: expected.device_derivative_required,
      device_derivative_redundant: expected.device_derivative_redundant,
    });
    if (!canNoop || expected.device_derivative_redundant) {
      await logAudit({
        workspace_id: ctx.workspace_id,
        environment_id: environmentId,
        device_id: persistedDevice.id,
        actor_type: 'system',
        visibility_scope: 'privileged',
        action: 'policy.derivative_decision',
        resource_type: 'device',
        resource_id: persistedDevice.id,
        details: {
          policy_id: resolvedPolicyId,
          expected_scope: `${expected.derivative.scope_type}:${expected.derivative.scope_id}`,
          expected_amapi_name: expected.derivative.amapi_name,
          reason_code: expected.reason_code,
          reason_details: expected.reason_details,
          expected_generation_hash: expectedGenerationHashForLog,
          stored_generation_hash: storedGenerationHashForLog,
          can_noop: canNoop,
          used_device_derivative: expected.used_device_derivative,
          device_derivative_required: expected.device_derivative_required,
          device_derivative_redundant: expected.device_derivative_redundant,
        },
      });
    }

    if (canNoop) {
      await execute(
        'UPDATE devices SET policy_id = $1, updated_at = now() WHERE id = $2',
        [resolvedPolicyId, persistedDevice.id]
      );
      return;
    }

    // Update device policy_id first
    await execute(
      'UPDATE devices SET policy_id = $1, updated_at = now() WHERE id = $2',
      [resolvedPolicyId, persistedDevice.id]
    );

    const syncResult = await assignPolicyToDeviceWithDerivative({
      policyId: resolvedPolicyId,
      environmentId,
      deviceId: persistedDevice.id,
      deviceAmapiName,
      amapiContext: {
        workspace_id: ctx.workspace_id,
        gcp_project_id: ctx.gcp_project_id,
        enterprise_name: ctx.enterprise_name,
      },
    });

    // Track the synced derivative name for future change guards
    await execute(
      'UPDATE devices SET last_policy_sync_name = $1 WHERE id = $2',
      [syncResult.derivative.amapi_name, persistedDevice.id]
    );
  } catch (err) {
    // Roll back the policy_id update to avoid orphaned state
    await execute(
      'UPDATE devices SET policy_id = NULL, last_policy_sync_name = NULL, updated_at = now() WHERE id = $1',
      [persistedDevice.id]
    ).catch(() => { /* best effort rollback */ });

    console.error('Failed to assign derivative policy to enrolled device — rolled back policy_id', {
      environmentId,
      deviceAmapiName,
      policyId: resolvedPolicyId,
      sourceScope: resolvedPolicySourceType && resolvedPolicySourceId ? `${resolvedPolicySourceType}:${resolvedPolicySourceId}` : null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface EnrollmentTokenMatch {
  id: string;
  group_id: string | null;
  one_time_use: boolean | null;
  signin_url: string | null;
}

async function findEnrollmentTokenMatchForDevice(
  environmentId: string,
  enrollmentTokenName: string | null,
  signinEmail: string | null,
): Promise<{ token: EnrollmentTokenMatch | null; source: 'amapi_name' | 'signin_email' | 'none' }> {
  if (enrollmentTokenName) {
    const token = await queryOne<EnrollmentTokenMatch>(
      `SELECT id, group_id, one_time_use, signin_url
       FROM enrollment_tokens
       WHERE environment_id = $1 AND amapi_name = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [environmentId, enrollmentTokenName]
    );
    if (token) return { token, source: 'amapi_name' };
  }

  if (signinEmail) {
    const token = await queryOne<EnrollmentTokenMatch>(
      `SELECT id, group_id, one_time_use, signin_url
       FROM enrollment_tokens
       WHERE environment_id = $1
         AND signin_url = 'signin_enroll'
         AND one_time_use = true
         AND lower(name) = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [environmentId, `sign-in: ${signinEmail.toLowerCase()}`]
    );
    if (token) return { token, source: 'signin_email' };
  }

  return { token: null, source: 'none' };
}

async function consumeEnrollmentTokenIfOneTime(token: EnrollmentTokenMatch | null): Promise<void> {
  if (!token?.id || token.one_time_use !== true) return;
  await execute(
    'DELETE FROM enrollment_tokens WHERE id = $1',
    [token.id]
  );
}

/**
 * Process an ENROLLMENT event: create or update the device in the DB from AMAPI.
 */
async function processEnrollment(
  environmentId: string,
  deviceAmapiName: string,
  eventPayload?: Record<string, unknown>
): Promise<void> {
  const ctx = await getEnvironmentContext(environmentId);
  if (!ctx || !ctx.enterprise_name) return;

  const device = isUsableDevicePayloadSnapshot(eventPayload, deviceAmapiName)
    ? eventPayload
    : await amapiCall<Record<string, unknown>>(
      deviceAmapiName,
      ctx.workspace_id,
      {
        projectId: ctx.gcp_project_id,
        enterpriseName: ctx.enterprise_name,
        resourceType: 'devices',
      }
    );

  if (!device) return;

  const hardwareInfo = (device.hardwareInfo as Record<string, unknown>) ?? {};
  const softwareInfo = (device.softwareInfo as Record<string, unknown>) ?? {};
  const networkInfo = (device.networkInfo as Record<string, unknown>) ?? {};
  const primaryTelephonyInfo =
    (
      (networkInfo.telephonyInfos as Array<Record<string, unknown>> | undefined) ??
      (networkInfo.telephonyInfo as Array<Record<string, unknown>> | undefined)
    )?.[0] ?? null;
  const normalizedImei =
    (networkInfo.imei as string | undefined) ??
    (primaryTelephonyInfo?.imei as string | undefined) ??
    null;

  // Deduplicate via AMAPI previousDeviceNames only.
  // Keep a single prior record (if any) as canonical, and collapse a transient
  // webhook placeholder row for the current amapi_name before renaming.
  const previousNames = Array.isArray(device.previousDeviceNames)
    ? (device.previousDeviceNames as string[])
    : [];
  if (previousNames.length > 0) {
    const previousMatches = await query<{
      id: string;
      amapi_name: string;
      serial_number: string | null;
      imei: string | null;
      deleted_at: string | null;
      enrollment_time: string | null;
      last_status_report_at: string | null;
      created_at: string | null;
    }>(
      `SELECT id, amapi_name, serial_number, imei, deleted_at,
              enrollment_time, last_status_report_at, created_at
       FROM devices
       WHERE environment_id = $1
         AND amapi_name = ANY($2::text[])
       ORDER BY created_at ASC`,
      [environmentId, previousNames]
    );

    if (previousMatches.length > 0) {
      const hardwareSerial = (hardwareInfo.serialNumber as string | undefined) ?? null;
      const canonicalPrevious = [...previousMatches].sort((a, b) => {
        const score = (row: typeof a) => {
          const deletedPenalty = row.deleted_at ? 0 : 1;
          const imeiMatch = normalizedImei && row.imei === normalizedImei ? 1 : 0;
          const serialMatch = hardwareSerial && row.serial_number === hardwareSerial ? 1 : 0;
          const enrollmentTs = row.enrollment_time ? Date.parse(row.enrollment_time) : 0;
          const statusTs = row.last_status_report_at ? Date.parse(row.last_status_report_at) : 0;
          const createdTs = row.created_at ? Date.parse(row.created_at) : 0;
          return [deletedPenalty, imeiMatch, serialMatch, enrollmentTs, statusTs, createdTs];
        };
        const sa = score(a);
        const sb = score(b);
        for (let i = 0; i < sa.length; i += 1) {
          if (sa[i] === sb[i]) continue;
          return (sb[i] as number) - (sa[i] as number);
        }
        return 0;
      })[0];

      const currentRow = await queryOne<{
        id: string;
        state: string | null;
        group_id: string | null;
        snapshot: Record<string, unknown> | string | null;
      }>(
        `SELECT id, state, group_id, snapshot
         FROM devices
         WHERE environment_id = $1 AND amapi_name = $2`,
        [environmentId, deviceAmapiName]
      );

      if (currentRow) {
        if (currentRow.group_id !== null) {
          console.warn('enrollment: collapsing current re-enrollment row that already had group assignment', {
            environment_id: environmentId,
            device_amapi_name: deviceAmapiName,
            current_device_id: currentRow.id,
            group_id: currentRow.group_id,
          });
        }

        await execute(
          'DELETE FROM devices WHERE id = $1',
          [currentRow.id]
        );
      }

      // Rename exactly one canonical prior record. Renaming all previous names can
      // conflict once duplicate historic rows already exist from past failures.
      await execute(
        `UPDATE devices SET amapi_name = $1, updated_at = now()
         WHERE id = $2`,
        [deviceAmapiName, canonicalPrevious.id]
      );

      if (previousMatches.length > 1) {
        console.warn('enrollment: multiple previousDeviceNames matched local rows; canonicalized one record only', {
          environment_id: environmentId,
          device_amapi_name: deviceAmapiName,
          matched_count: previousMatches.length,
          canonical_device_id: canonicalPrevious.id,
        });
      }
    }
  }

  // Guard against reviving historical predecessor devices during manual/full imports.
  // If another active local row already references this AMAPI name as a previousDeviceName,
  // then this device is a known predecessor in the same lineage and should not be restored
  // as a second active row. We only apply this when the incoming device itself has no
  // previousDeviceNames to avoid suppressing the current device in a normal re-enrollment.
  if (previousNames.length === 0) {
    const successorRow = await queryOne<{ id: string; amapi_name: string }>(
      `SELECT id, amapi_name
       FROM devices
       WHERE environment_id = $1
         AND deleted_at IS NULL
         AND amapi_name <> $2
         AND previous_device_names @> ARRAY[$2]::text[]
       ORDER BY last_status_report_at DESC NULLS LAST, enrollment_time DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [environmentId, deviceAmapiName]
    );
    if (successorRow) {
      console.warn('enrollment: skipping historical predecessor device import because active successor lineage exists', {
        environment_id: environmentId,
        historical_device_amapi_name: deviceAmapiName,
        successor_device_id: successorRow.id,
        successor_amapi_name: successorRow.amapi_name,
      });
      return;
    }
  }

  // Snapshot the existing device record BEFORE the upsert so we can detect
  // re-enrollment (device wiped and re-enrolled with a new token). After
  // previousDeviceNames consolidation above, the old record already carries
  // the new amapi_name so this lookup will find it.
  const existingBeforeUpsert = await queryOne<{ enrollment_time: string | null }>(
    'SELECT enrollment_time FROM devices WHERE environment_id = $1 AND amapi_name = $2',
    [environmentId, deviceAmapiName]
  );
  const newEnrollmentTime = (device.enrollmentTime as string) ?? null;
  const isReEnrollment =
    existingBeforeUpsert !== null &&
    existingBeforeUpsert.enrollment_time !== null &&
    newEnrollmentTime !== null &&
    existingBeforeUpsert.enrollment_time !== newEnrollmentTime;

  const deviceId = crypto.randomUUID();

  const modelStr = (hardwareInfo.model as string) ?? 'Device';
  const serialStr = (hardwareInfo.serialNumber as string) ?? deviceAmapiName.split('/').pop() ?? deviceId;
  const autoName = `${modelStr}_${serialStr}`;

  await execute(
    `INSERT INTO devices (
       id, environment_id, amapi_name, name, serial_number, imei,
       manufacturer, model, os_version, security_patch_level,
       state, ownership, management_mode, policy_compliant,
       enrollment_time, last_status_report_at, snapshot
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), $16)
     ON CONFLICT (amapi_name) DO UPDATE SET
       name = COALESCE(devices.name, EXCLUDED.name),
       serial_number = EXCLUDED.serial_number,
       imei = EXCLUDED.imei,
       manufacturer = EXCLUDED.manufacturer,
       model = EXCLUDED.model,
       os_version = EXCLUDED.os_version,
       security_patch_level = EXCLUDED.security_patch_level,
       state = EXCLUDED.state,
       ownership = EXCLUDED.ownership,
       management_mode = EXCLUDED.management_mode,
       policy_compliant = EXCLUDED.policy_compliant,
       enrollment_time = EXCLUDED.enrollment_time,
       last_status_report_at = now(),
       snapshot = EXCLUDED.snapshot,
       updated_at = now()`,
    [
      deviceId,
      environmentId,
      deviceAmapiName,
      autoName,
      hardwareInfo.serialNumber ?? null,
      normalizedImei,
      hardwareInfo.manufacturer ?? hardwareInfo.brand ?? null,
      hardwareInfo.model ?? null,
      (softwareInfo.androidVersion as string) ?? null,
      (softwareInfo.securityPatchLevel as string) ?? null,
      (device.state as string) ?? 'ACTIVE',
      (device.ownership as string) ?? null,
      (device.managementMode as string) ?? null,
      device.policyCompliant === true,
      (device.enrollmentTime as string) ?? null,
      JSON.stringify(device),
    ]
  );

  const enrolledDeviceForApps = await queryOne<{ id: string }>(
    'SELECT id FROM devices WHERE environment_id = $1 AND amapi_name = $2',
    [environmentId, deviceAmapiName]
  );
  await syncDeviceApplicationsTable(enrolledDeviceForApps?.id ?? null, device.applicationReports);
  await syncAppFeedbackFromReports(
    environmentId,
    enrolledDeviceForApps?.id ?? null,
    deviceAmapiName,
    device.applicationReports
  );

  // Extract group_id from enrollment token data and assign device to group.
  // enrollmentTokenData may be a JSON string (from AMAPI) or an already-parsed object.
  const rawTokenData = device.enrollmentTokenData;
  const enrollmentTokenData: Record<string, unknown> | null =
    typeof rawTokenData === 'string'
      ? (() => { try { const p = JSON.parse(rawTokenData); return p && typeof p === 'object' ? p : null; } catch { return null; } })()
      : (rawTokenData && typeof rawTokenData === 'object' && !Array.isArray(rawTokenData))
        ? (rawTokenData as Record<string, unknown>)
        : null;
  const enrollmentTokenName = (device.enrollmentTokenName as string) ?? null;
  const tokenSigninEmailRaw = enrollmentTokenData?.signin_email;
  const tokenSigninEmail = typeof tokenSigninEmailRaw === 'string'
    ? tokenSigninEmailRaw.toLowerCase().trim()
    : null;
  let tokenGroupId = (enrollmentTokenData?.group_id as string) ?? null;
  let groupSource: 'amapi_token_data' | 'enrollment_tokens_table' | 'none' = tokenGroupId ? 'amapi_token_data' : 'none';
  const tokenMatch = await findEnrollmentTokenMatchForDevice(
    environmentId,
    enrollmentTokenName,
    tokenSigninEmail
  );

  // Fallback: look up group_id from the enrollment_tokens table if AMAPI
  // device doesn't include enrollmentTokenData (e.g. timing/sync issue).
  if (!tokenGroupId && tokenMatch.token?.group_id) {
    tokenGroupId = tokenMatch.token.group_id;
    groupSource = 'enrollment_tokens_table';
  }

  if (tokenGroupId) {
    if (isReEnrollment) {
      // Re-enrollment (device wiped & re-enrolled with a new token): the new
      // token's group always wins, even if an admin previously moved the device.
      await execute(
        'UPDATE devices SET group_id = $1, updated_at = now() WHERE environment_id = $2 AND amapi_name = $3',
        [tokenGroupId, environmentId, deviceAmapiName]
      );
      console.log(
        `enrollment: re-enrollment detected, set group_id=${tokenGroupId} for ${deviceAmapiName} ` +
        `(source=${groupSource}, old_enrollment=${existingBeforeUpsert?.enrollment_time}, new_enrollment=${newEnrollmentTime})`
      );
    } else {
      // First enrollment or re-processing of same enrollment event: only set
      // group_id if currently NULL — an admin may have manually moved the
      // device to a different group, and we must not auto-revert that.
      const groupResult = await execute(
        'UPDATE devices SET group_id = $1, updated_at = now() WHERE environment_id = $2 AND amapi_name = $3 AND group_id IS NULL',
        [tokenGroupId, environmentId, deviceAmapiName]
      );
      if ((groupResult.rowCount ?? 0) > 0) {
        console.log(`enrollment: set group_id=${tokenGroupId} for ${deviceAmapiName} (source=${groupSource})`);
      } else {
        console.log(`enrollment: group_id already set for ${deviceAmapiName}, skipping token group_id=${tokenGroupId} (source=${groupSource})`);
      }
    }
  } else {
    console.log(`enrollment: no group_id found for ${deviceAmapiName} (enrollmentTokenData=${!!rawTokenData}, enrollmentTokenName=${(device.enrollmentTokenName as string) ?? 'N/A'})`);
  }

  // Persist previousDeviceNames for reference
  if (previousNames.length > 0) {
    await execute(
      'UPDATE devices SET previous_device_names = $1, updated_at = now() WHERE environment_id = $2 AND amapi_name = $3',
      [previousNames, environmentId, deviceAmapiName]
    );
  }

  await syncEnrollmentPolicyFromGroup(environmentId, deviceAmapiName);

  // One-time enrollment tokens should disappear from the local token list after use.
  // This includes sign-in enrollment tokens and manual one-time tokens when we can match them.
  await consumeEnrollmentTokenIfOneTime(tokenMatch.token).catch((err) => {
    console.warn(
      'enrollment: failed to consume one-time token after enrollment',
      err instanceof Error ? err.message : String(err)
    );
  });

  await logAudit({
    environment_id: environmentId,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'device.enrolled',
    resource_type: 'device',
    resource_id: deviceAmapiName,
    details: {
      manufacturer: hardwareInfo.manufacturer,
      model: hardwareInfo.model,
      group_id: tokenGroupId ?? null,
      group_source: groupSource,
      is_re_enrollment: isReEnrollment,
      enrollment_token_name: enrollmentTokenName,
      signin_email: tokenSigninEmail,
      enrollment_token_lookup_source: tokenMatch.source,
    },
  });

  // Dispatch workflow event for device enrollment
  const enrolledDevice = await queryOne<{ id: string; group_id: string | null }>(
    'SELECT id, group_id FROM devices WHERE environment_id = $1 AND amapi_name = $2',
    [environmentId, deviceAmapiName]
  );
  if (enrolledDevice) {
    await dispatchWorkflowEvent({
      environmentId,
      deviceId: enrolledDevice.id,
      deviceGroupId: enrolledDevice.group_id,
      triggerType: 'device.enrolled',
      triggerData: {
        manufacturer: hardwareInfo.manufacturer ?? null,
        model: hardwareInfo.model ?? null,
        serial_number: hardwareInfo.serialNumber ?? null,
      },
    });
  }
}

/**
 * Process a STATUS_REPORT event: update device snapshot, extract apps/location.
 */
async function processStatusReport(
  environmentId: string,
  deviceAmapiName: string,
  eventPayload?: Record<string, unknown>
): Promise<void> {
  const ctx = await getEnvironmentContext(environmentId);
  if (!ctx || !ctx.enterprise_name) return;

  const device = isUsableDevicePayloadSnapshot(eventPayload, deviceAmapiName)
    ? eventPayload
    : await amapiCall<Record<string, unknown>>(
      deviceAmapiName,
      ctx.workspace_id,
      {
        projectId: ctx.gcp_project_id,
        enterpriseName: ctx.enterprise_name,
        resourceType: 'devices',
      }
    );

  if (!device) return;

  const hardwareInfo = (device.hardwareInfo as Record<string, unknown>) ?? {};
  const softwareInfo = (device.softwareInfo as Record<string, unknown>) ?? {};
  const networkInfo = (device.networkInfo as Record<string, unknown>) ?? {};
  const primaryTelephonyInfo =
    (
      (networkInfo.telephonyInfos as Array<Record<string, unknown>> | undefined) ??
      (networkInfo.telephonyInfo as Array<Record<string, unknown>> | undefined)
    )?.[0] ?? null;
  const normalizedImei =
    (networkInfo.imei as string | undefined) ??
    (primaryTelephonyInfo?.imei as string | undefined) ??
    null;

  // Fetch previous state/compliance before updating so we can detect changes
  const previousDevice = await queryOne<{
    id: string;
    group_id: string | null;
    state: string | null;
    policy_compliant: boolean;
  }>(
    'SELECT id, group_id, state, policy_compliant FROM devices WHERE environment_id = $1 AND amapi_name = $2',
    [environmentId, deviceAmapiName]
  );

  await execute(
    `UPDATE devices SET
       serial_number = COALESCE($2, serial_number),
       imei = COALESCE($3, imei),
       manufacturer = COALESCE($4, manufacturer),
       model = COALESCE($5, model),
       os_version = COALESCE($6, os_version),
       security_patch_level = COALESCE($7, security_patch_level),
       state = COALESCE($8, state),
       ownership = COALESCE($9, ownership),
       management_mode = COALESCE($10, management_mode),
       policy_compliant = $11,
       last_status_report_at = now(),
       snapshot = $12,
       updated_at = now()
     WHERE environment_id = $1 AND amapi_name = $13`,
    [
      environmentId,
      hardwareInfo.serialNumber ?? null,
      normalizedImei,
      hardwareInfo.manufacturer ?? hardwareInfo.brand ?? null,
      hardwareInfo.model ?? null,
      (softwareInfo.androidVersion as string) ?? null,
      (softwareInfo.securityPatchLevel as string) ?? null,
      (device.state as string) ?? null,
      (device.ownership as string) ?? null,
      (device.managementMode as string) ?? null,
      device.policyCompliant === true,
      JSON.stringify(device),
      deviceAmapiName,
    ]
  );

  const isDeletedStatus =
    (device.state as string | undefined) === 'DELETED' ||
    (device.appliedState as string | undefined) === 'DELETED';
  if (isDeletedStatus) {
    await execute(
      `UPDATE devices
       SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
       WHERE environment_id = $1 AND amapi_name = $2`,
      [environmentId, deviceAmapiName]
    );
    return;
  }

  await syncEnrollmentPolicyFromGroup(environmentId, deviceAmapiName);

  // Dispatch workflow events for state/compliance changes
  if (previousDevice) {
    const newState = (device.state as string) ?? previousDevice.state;
    const newCompliant = device.policyCompliant === true;

    if (newState && newState !== previousDevice.state) {
      await dispatchWorkflowEvent({
        environmentId,
        deviceId: previousDevice.id,
        deviceGroupId: previousDevice.group_id,
        triggerType: 'device.state_changed',
        triggerData: {
          previous_state: previousDevice.state,
          new_state: newState,
        },
      });
    }

    if (newCompliant !== previousDevice.policy_compliant) {
      await dispatchWorkflowEvent({
        environmentId,
        deviceId: previousDevice.id,
        deviceGroupId: previousDevice.group_id,
        triggerType: 'compliance.changed',
        triggerData: {
          previous_compliant: previousDevice.policy_compliant,
          new_compliant: newCompliant,
        },
      });
    }
  }

  // Store application reports in blobs for detailed querying
  if (device.applicationReports) {
    try {
      await storeBlob(
        'device-apps',
        `${environmentId}/${deviceAmapiName.replace(/\//g, '_')}/apps.json`,
        JSON.stringify(device.applicationReports)
      );
    } catch (err) {
      console.error('Failed to store app reports:', err);
    }
  }

  const statusReportDeviceId = previousDevice?.id ?? (
    await queryOne<{ id: string }>(
      'SELECT id FROM devices WHERE environment_id = $1 AND amapi_name = $2',
      [environmentId, deviceAmapiName]
    )
  )?.id ?? null;
  await syncDeviceApplicationsTable(statusReportDeviceId, device.applicationReports);
  await syncAppFeedbackFromReports(
    environmentId,
    statusReportDeviceId,
    deviceAmapiName,
    device.applicationReports
  );
}

/**
 * Process a COMMAND event: update the command status in the DB.
 */
async function processCommand(
  environmentId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const commandName =
    (payload.resourceName as string | undefined) ??
    (payload.name as string | undefined);
  if (!commandName) return;

  // Prefer documented AMAPI COMMAND payload fields (`done`, `response`, `error`)
  // and fall back to older/internal shapes if present.
  const done = payload.done;
  const hasOperationError =
    payload.error !== null &&
    typeof payload.error === 'object' &&
    !Array.isArray(payload.error);
  const commandState = typeof payload.commandState === 'string'
    ? (hasOperationError ? 'FAILED' : payload.commandState)
    : done === true
      ? (hasOperationError ? 'FAILED' : 'SUCCEEDED')
      : done === false
        ? 'RUNNING'
        : 'UNKNOWN';
  const normalizedCommandState = commandState.toUpperCase();
  const commandSucceeded =
    !hasOperationError && (
      (done === true && normalizedCommandState !== 'FAILED') ||
      normalizedCommandState === 'SUCCEEDED' ||
      normalizedCommandState === 'EXECUTED'
    );

  try {
    await execute(
      `UPDATE device_commands SET
         status = $1,
         updated_at = now()
       WHERE environment_id = $2 AND amapi_name = $3`,
      [commandState, environmentId, commandName]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('relation "device_commands" does not exist')) {
      console.warn('device_commands table missing; skipping command status update');
    } else {
      throw err;
    }
  }

  const commandType = extractCommandType(payload);
  const commandDeviceAmapiName = extractDeviceAmapiNameFromOperationName(commandName);
  if (!commandSucceeded || !commandType || !commandDeviceAmapiName) return;

  if (commandType === 'START_LOST_MODE') {
    await execute(
      `UPDATE devices
       SET snapshot = jsonb_set(COALESCE(snapshot, '{}'::jsonb), '{appliedState}', to_jsonb($3::text), true),
           updated_at = now()
       WHERE environment_id = $1
         AND amapi_name = $2
         AND deleted_at IS NULL`,
      [environmentId, commandDeviceAmapiName, 'LOST']
    );
  } else if (commandType === 'STOP_LOST_MODE') {
    await execute(
      `UPDATE devices
       SET snapshot = jsonb_set(
             COALESCE(snapshot, '{}'::jsonb),
             '{appliedState}',
             to_jsonb(COALESCE(state, 'ACTIVE')::text),
             true
           ),
           updated_at = now()
       WHERE environment_id = $1
         AND amapi_name = $2
         AND deleted_at IS NULL`,
      [environmentId, commandDeviceAmapiName]
    );
  }
}

/**
 * Process USAGE_LOGS events: store raw payload and map Lost Mode location points.
 */
async function processUsageLogs(
  environmentId: string,
  deviceAmapiName: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  const resolvedDeviceAmapiName = resolveUsageLogDeviceAmapiName(deviceAmapiName, payload);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await storeBlob(
    'usage-logs',
    `${environmentId}/${(resolvedDeviceAmapiName ?? '_unknown_device').replace(/\//g, '_')}/${timestamp}.json`,
    JSON.stringify(payload)
  );

  if (!resolvedDeviceAmapiName) return;

  const device = await queryOne<{ id: string }>(
    `SELECT id
     FROM devices
     WHERE environment_id = $1 AND amapi_name = $2 AND deleted_at IS NULL`,
    [environmentId, resolvedDeviceAmapiName]
  );
  if (!device?.id) return;

  const lostModeLocations = extractLostModeLocationRecords(payload);
  if (lostModeLocations.length === 0) return;

  for (const chunk of chunkArray(lostModeLocations, BULK_UPSERT_CHUNK_SIZE)) {
    await execute(
      `WITH input_rows AS (
         SELECT *
         FROM jsonb_to_recordset($2::jsonb) AS x(
           latitude double precision,
           longitude double precision,
           accuracy double precision,
           recorded_at timestamptz,
           source text
         )
       )
       INSERT INTO device_locations (device_id, latitude, longitude, accuracy, source, recorded_at)
       SELECT
         $1::uuid,
         input_rows.latitude,
         input_rows.longitude,
         input_rows.accuracy,
         input_rows.source,
         input_rows.recorded_at
       FROM input_rows
       WHERE NOT EXISTS (
         SELECT 1
         FROM device_locations existing
         WHERE existing.device_id = $1
           AND existing.latitude = input_rows.latitude
           AND existing.longitude = input_rows.longitude
           AND existing.source = input_rows.source
           AND existing.recorded_at = input_rows.recorded_at
       )`,
      [device.id, JSON.stringify(chunk)]
    );
  }
}

/**
 * Process a bulk command job: send device commands via AMAPI.
 */
async function processBulkCommand(payload: BulkCommandPayload): Promise<void> {
  const { device_amapi_names, command_type, command_data, workspace_id, project_id, enterprise_name } = payload;

  for (const deviceName of device_amapi_names) {
    try {
      await amapiCall(
        `${deviceName}:issueCommand`,
        workspace_id,
        {
          method: 'POST',
          body: buildAmapiCommandPayload(command_type, command_data ?? {}, { allowUnknown: true }),
          projectId: project_id,
          enterpriseName: enterprise_name,
          resourceType: 'devices',
          resourceId: deviceName,
        }
      );

      // Update command status
      await tryUpdateDeviceCommandStatus(
        `UPDATE device_commands SET status = 'SENT', updated_at = now()
         WHERE device_amapi_name = $1 AND command_type = $2 AND status = 'PENDING'
         ORDER BY created_at DESC LIMIT 1`,
        [deviceName, command_type]
      );
    } catch (err) {
      console.error(`Failed to send command to ${deviceName}:`, err);
      await tryUpdateDeviceCommandStatus(
        `UPDATE device_commands SET status = 'FAILED', error = $3, updated_at = now()
         WHERE device_amapi_name = $1 AND command_type = $2 AND status = 'PENDING'
         ORDER BY created_at DESC LIMIT 1`,
        [deviceName, command_type, String(err)]
      );
    }
  }
}

async function processQueuedDeviceDelete(payload: {
  device_id: string;
  initiated_by?: string;
}): Promise<void> {
  const device = await queryOne<{
    id: string; amapi_name: string; environment_id: string;
  }>(
    'SELECT id, amapi_name, environment_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
    [payload.device_id]
  );
  if (!device) return;

  const env = await queryOne<{ workspace_id: string; enterprise_name: string | null }>(
    'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
    [device.environment_id]
  );
  const workspace = env?.workspace_id
    ? await queryOne<{ gcp_project_id: string | null }>(
        'SELECT gcp_project_id FROM workspaces WHERE id = $1',
        [env.workspace_id]
      )
    : null;

  if (env?.enterprise_name && workspace?.gcp_project_id) {
    try {
      await amapiCall(device.amapi_name, env.workspace_id, {
        method: 'DELETE',
        projectId: workspace.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'devices',
        resourceId: device.amapi_name.split('/').pop(),
      });
    } catch (err) {
      const status = getAmapiErrorHttpStatus(err);
      if (status !== 404) {
        throw err;
      }
    }
  }

  await execute('UPDATE devices SET deleted_at = now(), updated_at = now() WHERE id = $1', [device.id]);
  await execute("DELETE FROM app_deployments WHERE scope_type = 'device' AND scope_id = $1", [device.id]);
  await execute("DELETE FROM network_deployments WHERE scope_type = 'device' AND scope_id = $1", [device.id]);
  await execute("DELETE FROM policy_assignments WHERE scope_type = 'device' AND scope_id = $1", [device.id]);
  await execute("DELETE FROM policy_derivatives WHERE scope_type = 'device' AND scope_id = $1", [device.id]);

  await logAudit({
    workspace_id: env?.workspace_id,
    environment_id: device.environment_id,
    user_id: payload.initiated_by,
    actor_type: 'system',
    visibility_scope: 'privileged',
    device_id: device.id,
    action: 'device.deleted',
    resource_type: 'device',
    resource_id: device.id,
    details: { amapi_name: device.amapi_name, source: 'bulk_job' },
  });
}

export default async (request: Request, context: Context) => {
  console.log('Background sync processor started');

  try {
    requireInternalCaller(request);

    // Process jobs in a loop so that jobs enqueued during processing (e.g.
    // workflow_evaluate jobs created by dispatchWorkflowEvent) are picked up
    // in subsequent iterations without needing an external re-trigger.
    const MAX_BATCHES = 10;
    let batchNum = 0;
    let totalProcessed = 0;

    while (batchNum < MAX_BATCHES) {
      // Fetch and lock pending jobs
      const jobs = await transaction(async (client) => {
        const result = await client.query(
          `UPDATE job_queue SET
             status = 'locked',
             locked_at = now()
           WHERE id IN (
             SELECT id FROM job_queue
             WHERE status = 'pending'
               AND scheduled_for <= now()
             ORDER BY created_at ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED
           )
           RETURNING id, job_type, environment_id, payload, attempts`,
          [BATCH_SIZE]
        );
        return result.rows as Job[];
      });

      if (jobs.length === 0) break;

      console.log(`Processing batch ${batchNum + 1}: ${jobs.length} jobs`);

    for (const job of jobs) {
      try {
        const payload = parseJobPayload(job.payload);

        switch (job.job_type) {
          case 'process_event':
          case 'process_enrollment': {
            const eventPayload = payload as ProcessEventPayload;
            const notificationType = eventPayload.notification_type;

            if (notificationType === 'ENROLLMENT' && eventPayload.device_amapi_name) {
              await processEnrollment(job.environment_id, eventPayload.device_amapi_name, eventPayload.payload);
            } else if (notificationType === 'STATUS_REPORT' && eventPayload.device_amapi_name) {
              await processStatusReport(job.environment_id, eventPayload.device_amapi_name, eventPayload.payload);
            } else if (notificationType === 'COMMAND') {
              await processCommand(job.environment_id, eventPayload.payload);
            } else if (notificationType === 'USAGE_LOGS') {
              await processUsageLogs(job.environment_id, eventPayload.device_amapi_name, eventPayload.payload);
            } else if (notificationType === 'ENTERPRISE_UPGRADE') {
              await processEnterpriseUpgrade(job.environment_id);
            }

            // Mark pubsub event as processed
            if (eventPayload.event_message_id) {
              await execute(
                `UPDATE pubsub_events SET status = 'processed', processed_at = now()
                 WHERE environment_id = $1 AND message_id = $2`,
                [job.environment_id, eventPayload.event_message_id]
              );
            }
            break;
          }

          case 'process_status_report': {
            const eventPayload = payload as ProcessEventPayload;
            if (eventPayload.device_amapi_name) {
              await processStatusReport(job.environment_id, eventPayload.device_amapi_name, eventPayload.payload);
            }
            if (eventPayload.event_message_id) {
              await execute(
                `UPDATE pubsub_events SET status = 'processed', processed_at = now()
                 WHERE environment_id = $1 AND message_id = $2`,
                [job.environment_id, eventPayload.event_message_id]
              );
            }
            break;
          }

          case 'process_command': {
            const eventPayload = payload as ProcessEventPayload;
            await processCommand(job.environment_id, eventPayload.payload);
            if (eventPayload.event_message_id) {
              await execute(
                `UPDATE pubsub_events SET status = 'processed', processed_at = now()
                 WHERE environment_id = $1 AND message_id = $2`,
                [job.environment_id, eventPayload.event_message_id]
              );
            }
            break;
          }

          case 'process_usage_logs': {
            const eventPayload = payload as ProcessEventPayload;
            await processUsageLogs(job.environment_id, eventPayload.device_amapi_name, eventPayload.payload);
            if (eventPayload.event_message_id) {
              await execute(
                `UPDATE pubsub_events SET status = 'processed', processed_at = now()
                 WHERE environment_id = $1 AND message_id = $2`,
                [job.environment_id, eventPayload.event_message_id]
              );
            }
            break;
          }

          case 'process_enterprise_upgrade': {
            await processEnterpriseUpgrade(job.environment_id);
            break;
          }

          case 'bulk_command': {
            await processBulkCommand(payload as BulkCommandPayload);
            break;
          }

          case 'workflow_evaluate': {
            // Enqueued by workflow-cron-scheduled — invoke the background evaluator
            const { workflow_id, device_id, trigger_data } = payload as {
              workflow_id: string;
              device_id: string;
              trigger_data?: Record<string, unknown>;
            };
            const origin = new URL(request.url).origin;
            await fetch(`${origin}/.netlify/functions/workflow-evaluate-background`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET ?? '',
              },
              body: JSON.stringify({ workflow_id, device_id, trigger_data }),
            });
            break;
          }

          case 'device_command': {
            // Enqueued by geofence-check-scheduled — issue AMAPI device command
            const { device_id: cmdDeviceId, command_type, params: cmdParams } = payload as {
              device_id: string;
              command_type: string;
              params?: Record<string, unknown>;
            };
            const cmdDevice = await queryOne<{ amapi_name: string; environment_id: string }>(
              'SELECT amapi_name, environment_id FROM devices WHERE id = $1',
              [cmdDeviceId]
            );
            if (cmdDevice?.amapi_name) {
              const cmdEnvCtx = await queryOne<{ workspace_id: string; gcp_project_id: string; enterprise_name: string }>(
                `SELECT e.workspace_id, w.gcp_project_id, e.enterprise_name
                 FROM environments e JOIN workspaces w ON w.id = e.workspace_id
                 WHERE e.id = $1`,
                [cmdDevice.environment_id]
              );
              if (cmdEnvCtx) {
                if (command_type === 'DISABLE' || command_type === 'ENABLE') {
                  const targetState = command_type === 'DISABLE' ? 'DISABLED' : 'ACTIVE';
                  try {
                    await amapiCall(
                      `${cmdDevice.amapi_name}?updateMask=state`,
                      cmdEnvCtx.workspace_id,
                      {
                        method: 'PATCH',
                        body: { state: targetState },
                        projectId: cmdEnvCtx.gcp_project_id,
                        enterpriseName: cmdEnvCtx.enterprise_name,
                        resourceType: 'devices',
                        resourceId: cmdDevice.amapi_name.split('/').pop(),
                      }
                    );
                    await execute(
                      'UPDATE devices SET state = $1, updated_at = now() WHERE id = $2',
                      [targetState, cmdDeviceId]
                    );
                  } catch (err) {
                    const status = getAmapiErrorHttpStatus(err);
                    throw new Error(
                      `Bulk ${command_type.toLowerCase()} failed${status ? ` (${status})` : ''}: ${err instanceof Error ? err.message : String(err)}`
                    );
                  }
                } else {
                  try {
                    await amapiCall(
                      `${cmdDevice.amapi_name}:issueCommand`,
                      cmdEnvCtx.workspace_id,
                      {
                        method: 'POST',
                        body: buildAmapiCommandPayload(command_type, cmdParams ?? {}, { allowUnknown: true }),
                        projectId: cmdEnvCtx.gcp_project_id,
                        enterpriseName: cmdEnvCtx.enterprise_name,
                        resourceType: 'devices',
                        resourceId: cmdDevice.amapi_name.split('/').pop(),
                      }
                    );
                  } catch (err) {
                    const status = getAmapiErrorHttpStatus(err);
                    throw new Error(
                      `Bulk ${command_type.toLowerCase()} failed${status ? ` (${status})` : ''}: ${err instanceof Error ? err.message : String(err)}`
                    );
                  }
                }
              }
            }
            break;
          }

          case 'device_delete': {
            const { device_id: deleteDeviceId, initiated_by } = payload as {
              device_id: string;
              initiated_by?: string;
            };
            if (deleteDeviceId) {
              await processQueuedDeviceDelete({ device_id: deleteDeviceId, initiated_by });
            }
            break;
          }

          case 'webhook': {
            // Enqueued by geofence-check-scheduled — fire webhook
            const { url: webhookUrl, method: webhookMethod, body: webhookBody } = payload as {
              url: string;
              method?: string;
              body?: Record<string, unknown>;
            };
            if (typeof webhookUrl === 'string' && webhookUrl.trim()) {
              await executeValidatedOutboundWebhook({
                url: webhookUrl,
                method: typeof webhookMethod === 'string' && webhookMethod.trim()
                  ? webhookMethod
                  : 'POST',
                body: webhookBody ?? {},
              });
            }
            break;
          }

          default: {
            console.warn(`Unknown job type: ${job.job_type}`);
            const eventPayload = payload as Partial<ProcessEventPayload>;
            if (eventPayload.event_message_id) {
              await updatePubSubEventStatus(
                job.environment_id,
                eventPayload.event_message_id,
                'dead',
                `Unhandled job type: ${job.job_type}`
              );
            }
            await execute(
              `UPDATE job_queue SET status = 'dead', error = $2 WHERE id = $1`,
              [job.id, `Unhandled job type: ${job.job_type}`]
            );
            continue; // Skip the "mark completed" below
          }
        }

        // Mark job as completed
        await execute(
          `UPDATE job_queue SET status = 'completed', completed_at = now() WHERE id = $1`,
          [job.id]
        );
      } catch (err) {
        console.error(`Job ${job.id} (${job.job_type}) failed:`, err);

        const newAttempts = job.attempts + 1;
        const failedEventMessageId = extractPubSubEventMessageId(job.payload);
        if (newAttempts >= MAX_ATTEMPTS) {
          // Mark as dead
          await updateJobQueueFailure(job.id, newAttempts, String(err), null);
          if (failedEventMessageId) {
            await updatePubSubEventStatus(
              job.environment_id,
              failedEventMessageId,
              'dead',
              String(err)
            );
          }
        } else {
          // Increment attempts, reset to pending with exponential backoff
          const backoffSeconds = Math.pow(2, newAttempts) * 30; // 60s, 120s, 240s, 480s
          await updateJobQueueFailure(job.id, newAttempts, String(err), backoffSeconds);
          if (failedEventMessageId) {
            await updatePubSubEventStatus(
              job.environment_id,
              failedEventMessageId,
              'retrying',
              String(err)
            );
          }
        }
      }
    }

      totalProcessed += jobs.length;
      batchNum++;
    }

    console.log(`Background sync processor completed: ${totalProcessed} jobs across ${batchNum} batch(es)`);
  } catch (err) {
    console.error('Background sync processor error:', err);
  }
};

function parseJobPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid job payload: expected object JSON');
    }
    return parsed as Record<string, unknown>;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid job payload: expected object');
  }

  return payload as Record<string, unknown>;
}

function extractPubSubEventMessageId(payload: unknown): string | null {
  try {
    const parsed = parseJobPayload(payload);
    const raw = parsed.event_message_id;
    return typeof raw === 'string' && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

async function updatePubSubEventStatus(
  environmentId: string,
  messageId: string,
  status: 'retrying' | 'dead',
  error: string
): Promise<void> {
  await execute(
    `UPDATE pubsub_events
     SET status = $3, error = LEFT($4, 2000)
     WHERE environment_id = $1 AND message_id = $2`,
    [environmentId, messageId, status, error]
  );
}

async function tryUpdateDeviceCommandStatus(sql: string, params: unknown[]): Promise<void> {
  try {
    await execute(sql, params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('relation "device_commands" does not exist')) {
      console.warn('device_commands table missing; skipping device command row update');
      return;
    }
    throw err;
  }
}

async function updateJobQueueFailure(
  jobId: string,
  attempts: number,
  error: string,
  backoffSeconds: number | null
): Promise<void> {
  if (backoffSeconds == null) {
    try {
      await execute(
        `UPDATE job_queue SET status = 'dead', attempts = $2, error = $3, updated_at = now() WHERE id = $1`,
        [jobId, attempts, error]
      );
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('column "updated_at" of relation "job_queue" does not exist')) throw err;
      await execute(
        `UPDATE job_queue SET status = 'dead', attempts = $2, error = $3 WHERE id = $1`,
        [jobId, attempts, error]
      );
      return;
    }
  }

  try {
    await execute(
      `UPDATE job_queue SET
         status = 'pending',
         attempts = $2,
         error = $3,
         scheduled_for = now() + interval '1 second' * $4,
         locked_at = NULL,
         updated_at = now()
       WHERE id = $1`,
      [jobId, attempts, error, backoffSeconds]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('column "updated_at" of relation "job_queue" does not exist')) throw err;
    await execute(
      `UPDATE job_queue SET
         status = 'pending',
         attempts = $2,
         error = $3,
         scheduled_for = now() + interval '1 second' * $4,
         locked_at = NULL
       WHERE id = $1`,
      [jobId, attempts, error, backoffSeconds]
    );
  }
}
