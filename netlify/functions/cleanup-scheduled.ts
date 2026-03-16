import type { Context } from '@netlify/functions';
import { execute } from './_lib/db.js';

export const config = {
  schedule: '0 3 * * *',
};

const DELETE_BATCH_SIZE = 10_000;

export default async (request: Request, context: Context) => {
  console.log('Daily cleanup started');

  const results: Record<string, number> = {};
  const auditRetentionDays = parsePositiveInt(process.env.AUDIT_LOG_RETENTION_DAYS, 365);
  const locationRetentionDays = parsePositiveInt(process.env.DEVICE_LOCATION_RETENTION_DAYS, 90);
  const statusReportRetentionDays = parsePositiveInt(process.env.DEVICE_STATUS_REPORT_RETENTION_DAYS, 90);
  const softDeletedDeviceRetentionDays = parsePositiveInt(process.env.SOFT_DELETED_DEVICE_RETENTION_DAYS, 30);
  const flashagentChatRetentionDays = parsePositiveInt(process.env.FLASHAGENT_CHAT_RETENTION_DAYS, 30);

  try {
    // Delete expired sessions
    results.expired_sessions = await deleteInBatches(
      'sessions',
      `expires_at < now()`
    );

    // Delete expired magic links
    results.expired_magic_links = await deleteInBatches(
      'magic_links',
      `expires_at < now()`
    );

    // Delete expired invites
    const invites = await execute(
      `UPDATE user_invites SET status = 'expired'
       WHERE status = 'pending' AND expires_at < now()`
    );
    results.expired_invites = invites.rowCount;

    // Archive old pubsub events (older than 30 days)
    const archivedEvents = await execute(
      `UPDATE pubsub_events SET status = 'archived'
       WHERE created_at < now() - interval '30 days'
         AND status != 'archived'`
    );
    results.archived_pubsub_events = archivedEvents.rowCount;

    // Delete completed/dead jobs older than 7 days
    results.deleted_jobs = await deleteInBatches(
      'job_queue',
      `status IN ('completed', 'dead')
       AND created_at < now() - interval '7 days'`
    );

    // Clean up stale rate limit buckets (not used in 24 hours)
    results.stale_rate_limit_buckets = await deleteInBatches(
      'rate_limit_buckets',
      `last_refill_at < now() - interval '24 hours'`
    );

    // Clear stale or legacy pending TOTP setup blobs.
    const staleTotpSetup = await execute(
      `UPDATE users
       SET totp_pending_enc = NULL,
           totp_pending_created_at = NULL,
           updated_at = now()
       WHERE totp_pending_enc IS NOT NULL
         AND (
           totp_pending_created_at IS NULL
           OR totp_pending_created_at < now() - interval '1 day'
         )`
    );
    results.stale_totp_pending_secrets = staleTotpSetup.rowCount;

    // Revoke expired API keys (keys may have no expiry and should remain active).
    const expiredApiKeys = await execute(
      `UPDATE api_keys
       SET revoked_at = now()
       WHERE revoked_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at < now()`
    );
    results.expired_api_keys = expiredApiKeys.rowCount;

    // Retain audit logs for a bounded period (default 365 days)
    results.deleted_audit_log_rows = await deleteInBatches(
      'audit_log',
      `created_at < now() - make_interval(days => $1)`,
      [auditRetentionDays]
    );

    // Retain only recent sensitive device telemetry
    results.deleted_device_locations = await deleteInBatches(
      'device_locations',
      `recorded_at < now() - make_interval(days => $1)`,
      [locationRetentionDays]
    );

    results.deleted_device_status_reports = await deleteInBatches(
      'device_status_reports',
      `received_at < now() - make_interval(days => $1)`,
      [statusReportRetentionDays]
    );

    // Retain assistant chat history for a bounded period (default 30 days).
    try {
      results.deleted_flashagent_chat_messages = await deleteInBatches(
        'flashagent_chat_messages',
        `created_at < now() - make_interval(days => $1)`,
        [flashagentChatRetentionDays]
      );
    } catch (err) {
      if (!isUndefinedTableError(err)) throw err;
      // Migration may not exist yet in some environments.
      results.deleted_flashagent_chat_messages = 0;
    }

    // Hard-delete long-soft-deleted devices after clearing non-cascading references.
    const nullAuditDeviceRefs = await execute(
      `UPDATE audit_log
       SET device_id = NULL
       WHERE device_id IN (
         SELECT id FROM devices
         WHERE deleted_at IS NOT NULL
           AND deleted_at < now() - make_interval(days => $1)
       )`,
      [softDeletedDeviceRetentionDays]
    );
    results.nullified_audit_device_refs = nullAuditDeviceRefs.rowCount;

    const nullWorkflowDeviceRefs = await execute(
      `UPDATE workflow_executions
       SET device_id = NULL
       WHERE device_id IN (
         SELECT id FROM devices
         WHERE deleted_at IS NOT NULL
           AND deleted_at < now() - make_interval(days => $1)
       )`,
      [softDeletedDeviceRetentionDays]
    );
    results.nullified_workflow_execution_device_refs = nullWorkflowDeviceRefs.rowCount;

    results.deleted_soft_deleted_devices = await deleteInBatches(
      'devices',
      `deleted_at IS NOT NULL
       AND deleted_at < now() - make_interval(days => $1)`,
      [softDeletedDeviceRetentionDays]
    );

    console.log('Daily cleanup completed:', results);
  } catch (err) {
    console.error('Daily cleanup error:', err);
  }
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function deleteInBatches(
  tableName: string,
  whereClauseSql: string,
  params: unknown[] = []
): Promise<number> {
  let totalDeleted = 0;

  while (true) {
    const batchSizeParam = params.length + 1;
    const result = await execute(
      `DELETE FROM ${tableName}
       WHERE id IN (
         SELECT id FROM ${tableName}
         WHERE ${whereClauseSql}
         LIMIT $${batchSizeParam}
       )`,
      [...params, DELETE_BATCH_SIZE]
    );

    totalDeleted += result.rowCount;
    if (result.rowCount < DELETE_BATCH_SIZE) {
      return totalDeleted;
    }
  }
}

function isUndefinedTableError(err: unknown): boolean {
  return typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: string }).code === '42P01';
}
