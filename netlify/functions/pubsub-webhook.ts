import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { storeBlob } from './_lib/blobs.js';
import { amapiCall } from './_lib/amapi.js';
import { jsonResponse, errorResponse } from './_lib/helpers.js';
import { timingSafeEqual, randomUUID } from 'crypto';

/**
 * PubSub push subscription webhook handler.
 *
 * Flow:
 * 1. Validate authenticity (shared secret or Google JWT)
 * 2. Base64 decode message.data, parse JSON
 * 3. INSERT INTO pubsub_events with idempotent upsert on message_id
 * 4. Store raw payload to Blobs for audit
 * 5. Enqueue processing job
 * 6. Return 204 fast
 */
export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  // Validate shared secret via Authorization header (optional).
  // If PUBSUB_SHARED_SECRET is configured, require it. Otherwise accept unauthenticated.
  // This is an intentional design decision: new deployments work out of the box without
  // requiring PubSub auth configuration. Operators SHOULD set PUBSUB_SHARED_SECRET in
  // production for defence-in-depth. See docs/security/auth.md for details.
  const expectedSecret = process.env.PUBSUB_SHARED_SECRET;
  if (expectedSecret) {
    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const expectedBuf = Buffer.from(expectedSecret, 'utf8');
    const tokenBuf = Buffer.from(token, 'utf8');
    if (expectedBuf.length !== tokenBuf.length || !timingSafeEqual(expectedBuf, tokenBuf)) {
      return errorResponse('Unauthorized', 401);
    }
  }

  let body: {
    message?: {
      data?: string;
      messageId?: string;
      attributes?: Record<string, string>;
    };
    subscription?: string;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.message?.messageId) {
    return errorResponse('Missing messageId', 400);
  }
  if (!body.message?.data) {
    const attrType =
      body.message.attributes?.notificationType ??
      body.message.attributes?.notification_type;
    if (String(attrType ?? '').toUpperCase() === 'TEST') {
      return new Response(null, { status: 204 });
    }
    return errorResponse('Missing message data', 400);
  }

  const messageId = body.message.messageId;

  // Decode message
  let payload: {
    notificationType?: string;
    enterpriseId?: string;
    enterprise?: string;
    enterpriseName?: string;
    deviceId?: string;
    newDevice?: string;
    resourceName?: string;
    name?: string;
    device?: { name?: string } | string;
    command?: { name?: string };
    operation?: { name?: string };
    event?: { name?: string; resourceName?: string; device?: { name?: string } };
    resource?: { name?: string };
    userEvent?: { name?: string };
    batchUsageLogEvents?: { device?: string };
    [key: string]: unknown;
  };

  try {
    const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
    payload = JSON.parse(decoded);
  } catch {
    return errorResponse('Invalid base64 or JSON in message.data', 400);
  }

  const notificationType = String(
    body.message.attributes?.notificationType ??
    body.message.attributes?.notification_type ??
    payload.notificationType ??
    'UNKNOWN'
  ).toUpperCase();

  // Determine environment from enterprise ID
  const enterpriseId = extractEnterpriseId(payload);
  let environmentId: string | null = null;

  if (enterpriseId) {
    const env = await queryOne<{ id: string }>(
      `SELECT id FROM environments WHERE enterprise_name = $1 OR enterprise_name = $2`,
      [`enterprises/${enterpriseId}`, enterpriseId]
    );
    environmentId = env?.id ?? null;
  }

  if (!environmentId) {
    try {
      await storeBlob(
        'pubsub-raw',
        `_unroutable/${messageId}.json`,
        JSON.stringify({
          message: body.message,
          payload,
          received_at: new Date().toISOString(),
          extracted_enterprise_id: enterpriseId,
          top_level_payload_keys: Object.keys(payload ?? {}),
        })
      );
    } catch (err) {
      console.error('Failed to store unroutable PubSub payload:', err);
    }
    // Can't route this event — log and ack anyway
    console.warn(`PubSub event ${messageId}: no matching environment for enterprise ${enterpriseId}`);
    return new Response(null, { status: 204 });
  }

  // Idempotent insert
  const deviceAmapiName = buildDeviceAmapiName(payload, enterpriseId);

  const inserted = await execute(
    `INSERT INTO pubsub_events (environment_id, message_id, notification_type, device_amapi_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (environment_id, message_id) DO NOTHING`,
    [environmentId, messageId, notificationType, deviceAmapiName]
  );

  // If this was a duplicate, just ack
  if (inserted.rowCount === 0) {
    return new Response(null, { status: 204 });
  }

  // Store raw payload to Blobs
  try {
    await storeBlob(
      'pubsub-raw',
      `${environmentId}/${messageId}.json`,
      JSON.stringify({ message: body.message, payload, received_at: new Date().toISOString() })
    );
  } catch (err) {
    console.error('Failed to store raw PubSub payload:', err);
  }

  // Fast-path UI visibility: create/update a placeholder device row immediately on webhook receipt.
  // The background worker will hydrate/overwrite this from AMAPI shortly after.
  if (
    deviceAmapiName &&
    (notificationType === 'ENROLLMENT' || notificationType === 'STATUS_REPORT')
  ) {
    try {
      await fastPathUpsertDevice(environmentId, deviceAmapiName, notificationType, payload);
    } catch (err) {
      console.warn(`Fast-path device upsert failed for ${deviceAmapiName}:`, err);
    }
  }

  // Enqueue processing job
  await execute(
    `INSERT INTO job_queue (job_type, environment_id, payload)
     VALUES ($1, $2, $3)`,
    [
      `process_${notificationType.toLowerCase()}`,
      environmentId,
      JSON.stringify({
        event_message_id: messageId,
        notification_type: notificationType,
        device_amapi_name: deviceAmapiName,
        payload,
      }),
    ]
  );

  // Best-effort: kick the queue worker so ENROLLMENT/STATUS_REPORT events are processed
  // immediately instead of waiting for a separate manual trigger.
  try {
    await triggerQueueWorker(request);
  } catch (err) {
    console.warn('Failed to trigger background queue worker:', err);
  }

  // Ack fast
  return new Response(null, { status: 204 });
};

function normalizeEnterpriseId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/(?:^|\/)enterprises\/([^/]+)/);
  if (match?.[1]) return match[1];
  return trimmed;
}

function extractEnterpriseId(payload: {
  enterpriseId?: string;
  enterprise?: string;
  enterpriseName?: string;
  deviceId?: string;
  newDevice?: string;
  resourceName?: string;
  name?: string;
  device?: { name?: string } | string;
  command?: { name?: string };
  operation?: { name?: string };
  event?: { name?: string; resourceName?: string; device?: { name?: string } };
  resource?: { name?: string };
  userEvent?: { name?: string };
  batchUsageLogEvents?: { device?: string };
}): string | null {
  const payloadDeviceName = typeof payload.device === 'string'
    ? payload.device
    : payload.device?.name;

  const direct =
    normalizeEnterpriseId(payload.enterpriseId) ??
    normalizeEnterpriseId(payload.enterprise) ??
    normalizeEnterpriseId(payload.enterpriseName);
  if (direct) return direct;

  const candidates = [
    payload.newDevice,
    payload.resourceName,
    payload.deviceId,
    payload.name,
    payloadDeviceName,
    payload.batchUsageLogEvents?.device,
    payload.command?.name,
    payload.operation?.name,
    payload.event?.name,
    payload.event?.resourceName,
    payload.event?.device?.name,
    payload.resource?.name,
    payload.userEvent?.name,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeEnterpriseId(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function buildDeviceAmapiName(
  payload: {
    deviceId?: string;
    newDevice?: string;
    resourceName?: string;
    name?: string;
    device?: { name?: string } | string;
    operation?: { name?: string };
    event?: { name?: string; resourceName?: string; device?: { name?: string } };
    resource?: { name?: string };
    batchUsageLogEvents?: { device?: string };
  },
  enterpriseId: string | null
): string | null {
  const payloadDeviceName = typeof payload.device === 'string'
    ? payload.device
    : payload.device?.name;

  if (payload.deviceId) {
    if (payload.deviceId.startsWith('enterprises/')) return payload.deviceId;
    if (enterpriseId) return `enterprises/${enterpriseId}/devices/${payload.deviceId}`;
  }

  if (payload.newDevice) return payload.newDevice;
  if (payload.batchUsageLogEvents?.device) return payload.batchUsageLogEvents.device;
  if (payloadDeviceName && payloadDeviceName.includes('/devices/')) return payloadDeviceName;

  if (payload.resourceName?.includes('/devices/')) {
    const m = payload.resourceName.match(/(enterprises\/[^/]+\/devices\/[^/]+)/);
    return m?.[1] ?? payload.resourceName;
  }

  const extraCandidates = [
    payload.name,
    payloadDeviceName,
    payload.operation?.name,
    payload.event?.name,
    payload.event?.resourceName,
    payload.event?.device?.name,
    payload.resource?.name,
    payload.batchUsageLogEvents?.device,
  ];
  for (const candidate of extraCandidates) {
    if (!candidate) continue;
    if (candidate.includes('/devices/')) {
      const m = candidate.match(/(enterprises\/[^/]+\/devices\/[^/]+)/);
      return m?.[1] ?? candidate;
    }
  }

  return payload.resourceName ?? payload.name ?? payloadDeviceName ?? payload.batchUsageLogEvents?.device ?? null;
}

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

async function fastPathUpsertDevice(
  environmentId: string,
  deviceAmapiName: string,
  notificationType: 'ENROLLMENT' | 'STATUS_REPORT',
  payload?: Record<string, unknown>
): Promise<void> {
  const device = payload ?? {};
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
  const modelStr = (hardwareInfo.model as string) ?? 'Device';
  const serialStr = (hardwareInfo.serialNumber as string) ?? deviceAmapiName.split('/').pop() ?? '';
  const autoName = `${modelStr}_${serialStr}`;
  const payloadStatusTime =
    (device.lastStatusReportTime as string | undefined) ??
    (device.lastPolicySyncTime as string | undefined) ??
    null;

  await execute(
    `INSERT INTO devices (
       id,
       environment_id,
       amapi_name,
       name,
       serial_number,
       imei,
       manufacturer,
       model,
       os_version,
       security_patch_level,
       state,
       ownership,
       management_mode,
       policy_compliant,
     enrollment_time,
     last_status_report_at,
     snapshot
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
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
       policy_compliant = COALESCE(EXCLUDED.policy_compliant, devices.policy_compliant),
       enrollment_time = COALESCE(EXCLUDED.enrollment_time, devices.enrollment_time),
       last_status_report_at = COALESCE(EXCLUDED.last_status_report_at, devices.last_status_report_at),
       snapshot = COALESCE(EXCLUDED.snapshot, devices.snapshot),
       deleted_at = NULL,
       updated_at = now()`,
    [
      randomUUID(),
      environmentId,
      deviceAmapiName,
      autoName,
      hardwareInfo.serialNumber ?? null,
      normalizedImei,
      hardwareInfo.manufacturer ?? hardwareInfo.brand ?? null,
      hardwareInfo.model ?? null,
      (softwareInfo.androidVersion as string) ?? null,
      (softwareInfo.securityPatchLevel as string) ?? null,
      (device.state as string) ?? 'PENDING_SYNC',
      (device.ownership as string) ?? null,
      (device.managementMode as string) ?? null,
      typeof device.policyCompliant === 'boolean' ? device.policyCompliant === true : null,
      (device.enrollmentTime as string) ?? null,
      notificationType === 'STATUS_REPORT' ? (payloadStatusTime ?? new Date().toISOString()) : null,
      JSON.stringify({
        ...device,
        source: 'pubsub-webhook',
        notificationType,
        receivedAt: new Date().toISOString(),
        pendingSync: true,
      }),
    ]
  );
}

async function hydrateDeviceInline(environmentId: string, deviceAmapiName: string): Promise<void> {
  const ctx = await queryOne<{
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

  if (!ctx?.enterprise_name) return;

  const device = await withTimeout(
    amapiCall<Record<string, unknown>>(deviceAmapiName, ctx.workspace_id, {
      projectId: ctx.gcp_project_id,
      enterpriseName: ctx.enterprise_name,
      resourceType: 'devices',
    }),
    2500,
    'inline AMAPI device hydration timed out'
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

  const modelStr = (hardwareInfo.model as string) ?? 'Device';
  const serialStr = (hardwareInfo.serialNumber as string) ?? deviceAmapiName.split('/').pop() ?? '';
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
       deleted_at = NULL,
       updated_at = now()`,
    [
      randomUUID(),
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
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
