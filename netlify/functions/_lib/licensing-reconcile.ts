import { execute, query, queryOne } from './db.js';
import { isMissingRelationError } from './db-errors.js';
import {
  getEnvironmentLicensingSnapshot,
  getOveragePhaseForAgeDays,
  isPlatformLicensingEnabled,
  getWorkspaceLicensingSettings,
  syncLicensingWindowExpiries,
} from './licensing.js';
import { logAudit } from './audit.js';
import { sendEmail } from './resend.js';
import {
  buildNearExpiryEmail,
  getWorkspaceScopeNames,
  queueAndSendBillingEmail,
} from './billing-notifications.js';

const ENV_BATCH_SIZE = 200;
const RECONCILE_ADVISORY_LOCK_KEY = 724501923;
const MAX_ENFORCEMENT_ACTIONS_PER_RUN = 500;

export interface LicensingReconcileStats {
  environments_checked: number;
  overage_environments: number;
  cases_created: number;
  cases_resolved: number;
  disable_actions_queued: number;
  wipe_actions_queued: number;
  enable_actions_queued: number;
  errors: number;
  platform_grants_expired: number;
  environment_entitlements_expired: number;
  notifications_queued: number;
  notifications_sent: number;
  dry_run: boolean;
  lock_acquired: boolean;
  skipped_due_to_lock: boolean;
}

interface ReconcileOptions {
  dryRun: boolean;
}

type WorkspaceLicensingSettings = Awaited<ReturnType<typeof getWorkspaceLicensingSettings>>;

interface EnforcementActionState {
  actionsQueued: number;
  capWarningLogged: boolean;
}

function intervalDaysSince(value: string): number {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return 0;
  const diff = Date.now() - ts;
  if (diff <= 0) return 0;
  return Math.floor(diff / 86_400_000);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

async function tryAcquireReconcileLock(): Promise<boolean> {
  const row = await queryOne<{ locked: boolean | string | number }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [RECONCILE_ADVISORY_LOCK_KEY]
  );
  return toBoolean(row?.locked);
}

async function releaseReconcileLock(): Promise<void> {
  await execute('SELECT pg_advisory_unlock($1)', [RECONCILE_ADVISORY_LOCK_KEY]);
}

async function ensureOpenCase(
  workspaceId: string,
  environmentId: string,
  overageCount: number,
  phase: 'warn' | 'block' | 'disable' | 'wipe'
): Promise<{ id: string; started_at: string; created: boolean; previous_phase: string | null }> {
  const openCase = await queryOne<{ id: string; started_at: string; overage_peak: number; phase: string }>(
    `SELECT id, started_at, overage_peak, phase
     FROM license_overage_cases
     WHERE environment_id = $1
       AND resolved_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [environmentId]
  );

  if (openCase) {
    await execute(
      `UPDATE license_overage_cases
       SET phase = $1,
           overage_peak = GREATEST(overage_peak, $2),
           updated_at = now()
       WHERE id = $3`,
      [phase, overageCount, openCase.id]
    );
    return {
      id: openCase.id,
      started_at: openCase.started_at,
      created: false,
      previous_phase: openCase.phase ?? null,
    };
  }

  const id = crypto.randomUUID();
  const inserted = await queryOne<{ id: string; started_at: string }>(
    `INSERT INTO license_overage_cases
       (id, workspace_id, environment_id, started_at, phase, overage_peak, created_at, updated_at)
     VALUES ($1, $2, $3, now(), $4, $5, now(), now())
     RETURNING id, started_at`,
    [id, workspaceId, environmentId, phase, overageCount]
  );
  return {
    id: inserted?.id ?? id,
    started_at: inserted?.started_at ?? new Date().toISOString(),
    created: true,
    previous_phase: null,
  };
}

async function enqueueDeviceCommand(environmentId: string, deviceId: string, commandType: 'DISABLE' | 'ENABLE' | 'WIPE'): Promise<void> {
  const payload = commandType === 'WIPE'
    ? { device_id: deviceId, command_type: commandType, params: { wipeReason: 'License expiry. Oversubscribed.' } }
    : { device_id: deviceId, command_type: commandType };

  await execute(
    `INSERT INTO job_queue (id, job_type, environment_id, payload, status, scheduled_for)
     VALUES (gen_random_uuid(), 'device_command', $1, $2::jsonb, 'pending', now())`,
    [environmentId, JSON.stringify(payload)]
  );
}

interface NotificationContext {
  workspaceName: string;
  environmentName: string;
  recipients: string[];
}

const OVERAGE_DAY_MILESTONES = [1, 7, 25] as const;

function milestoneKey(day: number): string {
  return `overage:day:${day}`;
}

function phaseKey(phase: string): string {
  return `phase:${phase}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildNotificationSubject(
  workspaceName: string,
  environmentName: string,
  notificationKey: string,
  payload: Record<string, unknown>
): string {
  if (notificationKey.startsWith('overage:day:')) {
    const day = notificationKey.split(':').pop();
    return `[Licensing] Overage day ${day} for ${workspaceName}/${environmentName}`;
  }
  if (notificationKey === 'phase:block') return `[Licensing] Enrollment blocked for ${workspaceName}/${environmentName}`;
  if (notificationKey === 'phase:disable') return `[Licensing] Device disable phase started for ${workspaceName}/${environmentName}`;
  if (notificationKey === 'phase:wipe') return `[Licensing] Device wipe phase started for ${workspaceName}/${environmentName}`;
  if (notificationKey === 'phase:resolved') return `[Licensing] Overage resolved for ${workspaceName}/${environmentName}`;
  return `[Licensing] Overage update for ${workspaceName}/${environmentName}`;
}

function buildNotificationHtml(
  workspaceName: string,
  environmentName: string,
  notificationKey: string,
  payload: Record<string, unknown>
): string {
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeEnvironmentName = escapeHtml(environmentName);
  const safeNotificationKey = escapeHtml(notificationKey);
  const overageCount = Number(payload.overage_count ?? 0);
  const activeDeviceCount = Number(payload.active_device_count ?? 0);
  const entitledSeats = Number(payload.entitled_seats ?? 0);
  const overageAgeDays = Number(payload.overage_age_days ?? 0);

  return `
    <p>Workspace: <strong>${safeWorkspaceName}</strong></p>
    <p>Environment: <strong>${safeEnvironmentName}</strong></p>
    <p>Notification: <strong>${safeNotificationKey}</strong></p>
    <p>Overage: <strong>${overageCount}</strong> (active devices ${activeDeviceCount}, entitled seats ${entitledSeats})</p>
    <p>Overage age (days): <strong>${overageAgeDays}</strong></p>
    <p>Action required: purchase additional seats or reduce active devices to return to compliance.</p>
  `;
}

async function getNotificationContext(
  workspaceId: string,
  environmentId: string
): Promise<NotificationContext> {
  const [workspace, environment, recipients] = await Promise.all([
    queryOne<{ name: string }>(
      `SELECT name
       FROM workspaces
       WHERE id = $1`,
      [workspaceId]
    ),
    queryOne<{ name: string }>(
      `SELECT name
       FROM environments
       WHERE id = $1`,
      [environmentId]
    ),
    query<{ email: string }>(
      `SELECT DISTINCT u.email
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
         AND wm.role IN ('owner', 'admin')
         AND COALESCE(u.email, '') <> ''`,
      [workspaceId]
    ),
  ]);

  return {
    workspaceName: workspace?.name ?? workspaceId,
    environmentName: environment?.name ?? environmentId,
    recipients: recipients.map((recipient) => recipient.email).filter(Boolean),
  };
}

async function queueOverageNotification(
  caseId: string,
  workspaceId: string,
  environmentId: string,
  notificationKey: string,
  payload: Record<string, unknown>,
  stats: LicensingReconcileStats
): Promise<void> {
  let insertResult: { rowCount?: number } = {};
  try {
    insertResult = await execute(
      `INSERT INTO license_overage_notifications
         (id, case_id, workspace_id, environment_id, notification_key, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6::jsonb, now(), now())
       ON CONFLICT (case_id, notification_key) DO NOTHING`,
      [crypto.randomUUID(), caseId, workspaceId, environmentId, notificationKey, JSON.stringify(payload)]
    );
  } catch (err) {
    if (isMissingRelationError(err)) return;
    throw err;
  }
  if ((insertResult.rowCount ?? 0) === 0) return;

  stats.notifications_queued += 1;
  await logAudit({
    workspace_id: workspaceId,
    environment_id: environmentId,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'license.overage.notification.queued',
    resource_type: 'license_overage_notification',
    resource_id: caseId,
    details: { notification_key: notificationKey, ...payload },
  });

  try {
    const context = await getNotificationContext(workspaceId, environmentId);
    if (context.recipients.length === 0) {
      return;
    }

    const subject = buildNotificationSubject(context.workspaceName, context.environmentName, notificationKey, payload);
    const html = buildNotificationHtml(context.workspaceName, context.environmentName, notificationKey, payload);

    await Promise.all(
      context.recipients.map((email) => sendEmail({ to: email, subject, html }))
    );

    await execute(
      `UPDATE license_overage_notifications
       SET status = 'sent', sent_at = now(), updated_at = now()
       WHERE case_id = $1 AND notification_key = $2`,
      [caseId, notificationKey]
    );
    stats.notifications_sent += 1;

    await logAudit({
      workspace_id: workspaceId,
      environment_id: environmentId,
      actor_type: 'system',
      visibility_scope: 'privileged',
      action: 'license.overage.notification.sent',
      resource_type: 'license_overage_notification',
      resource_id: caseId,
      details: { notification_key: notificationKey, recipient_count: context.recipients.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await execute(
      `UPDATE license_overage_notifications
       SET status = 'failed', error = $3, updated_at = now()
       WHERE case_id = $1 AND notification_key = $2`,
      [caseId, notificationKey, message]
    );

    await logAudit({
      workspace_id: workspaceId,
      environment_id: environmentId,
      actor_type: 'system',
      visibility_scope: 'privileged',
      action: 'license.overage.notification.failed',
      resource_type: 'license_overage_notification',
      resource_id: caseId,
      details: { notification_key: notificationKey, error: message },
    });
  }
}

function canQueueEnforcementAction(state: EnforcementActionState): boolean {
  if (state.actionsQueued >= MAX_ENFORCEMENT_ACTIONS_PER_RUN) {
    if (!state.capWarningLogged) {
      state.capWarningLogged = true;
      console.warn(
        `licensing-reconcile enforcement cap reached (${MAX_ENFORCEMENT_ACTIONS_PER_RUN}); skipping remaining disable/wipe actions for this run`
      );
    }
    return false;
  }
  return true;
}

async function queueNearExpiryBillingNotifications(
  options: ReconcileOptions,
  stats: LicensingReconcileStats
): Promise<void> {
  if (options.dryRun) return;

  const platformExpiringRows = await query<{
    id: string;
    workspace_id: string;
    seat_count: number;
    ends_at: string;
    days_remaining: number;
  }>(
    `SELECT lg.id,
            lg.workspace_id,
            lg.seat_count,
            lg.ends_at,
            (lg.ends_at::date - CURRENT_DATE)::integer AS days_remaining
     FROM license_grants lg
     WHERE lg.status = 'active'
       AND lg.ends_at IS NOT NULL
       AND (lg.ends_at::date - CURRENT_DATE)::integer IN (30, 7, 1)`
  );

  for (const row of platformExpiringRows) {
    const names = await getWorkspaceScopeNames(row.workspace_id, null);
    const { subject, html } = buildNearExpiryEmail(
      names,
      Number(row.seat_count ?? 0),
      Number(row.days_remaining ?? 0),
      row.ends_at
    );
    const result = await queueAndSendBillingEmail({
      workspaceId: row.workspace_id,
      notificationType: 'platform_near_expiry',
      dedupeKey: `platform-near-expiry:${row.id}:d${row.days_remaining}`,
      subject,
      html,
      payload: {
        grant_id: row.id,
        days_remaining: row.days_remaining,
        seat_count: row.seat_count,
        ends_at: row.ends_at,
      },
    });
    if (result.queued) stats.notifications_queued += 1;
    if (result.sent) stats.notifications_sent += 1;
  }

  const environmentExpiringRows = await query<{
    id: string;
    workspace_id: string;
    environment_id: string;
    seat_count: number;
    ends_at: string;
    days_remaining: number;
  }>(
    `SELECT ee.id,
            ee.workspace_id,
            ee.environment_id,
            ee.seat_count,
            ee.ends_at,
            (ee.ends_at::date - CURRENT_DATE)::integer AS days_remaining
     FROM environment_entitlements ee
     WHERE ee.status = 'active'
       AND ee.ends_at IS NOT NULL
       AND (ee.ends_at::date - CURRENT_DATE)::integer IN (30, 7, 1)`
  );

  for (const row of environmentExpiringRows) {
    const names = await getWorkspaceScopeNames(row.workspace_id, row.environment_id);
    const { subject, html } = buildNearExpiryEmail(
      names,
      Number(row.seat_count ?? 0),
      Number(row.days_remaining ?? 0),
      row.ends_at
    );
    const result = await queueAndSendBillingEmail({
      workspaceId: row.workspace_id,
      environmentId: row.environment_id,
      notificationType: 'environment_near_expiry',
      dedupeKey: `environment-near-expiry:${row.id}:d${row.days_remaining}`,
      subject,
      html,
      payload: {
        entitlement_id: row.id,
        environment_id: row.environment_id,
        days_remaining: row.days_remaining,
        seat_count: row.seat_count,
        ends_at: row.ends_at,
      },
      includeEnvironmentCustomer: true,
    });
    if (result.queued) stats.notifications_queued += 1;
    if (result.sent) stats.notifications_sent += 1;
  }
}

async function reconcileEnvironment(
  env: { id: string; workspace_id: string },
  options: ReconcileOptions,
  stats: LicensingReconcileStats,
  workspaceSettingsCache: Map<string, WorkspaceLicensingSettings>,
  enforcementState: EnforcementActionState
): Promise<void> {
  stats.environments_checked += 1;

  try {
    let settings = workspaceSettingsCache.get(env.workspace_id);
    if (!settings) {
      settings = await getWorkspaceLicensingSettings(env.workspace_id);
      workspaceSettingsCache.set(env.workspace_id, settings);
    }

    if (!settings.effective_licensing_enabled) {
      if (!options.dryRun) {
        await execute(
          `DELETE FROM job_queue jq
           USING license_enforcement_actions lea
           WHERE jq.job_type = 'device_command'
             AND jq.status = 'pending'
             AND jq.environment_id = lea.environment_id
             AND jq.payload ->> 'device_id' = lea.device_id::text
             AND UPPER(COALESCE(jq.payload ->> 'command_type', '')) IN ('DISABLE', 'ENABLE', 'WIPE')
             AND lea.status = 'queued'
             AND lea.environment_id = $1`,
          [env.id]
        );
        await execute(
          `UPDATE license_enforcement_actions
           SET status = 'failed',
               error = 'Licensing disabled',
               updated_at = now()
           WHERE status = 'queued'
             AND environment_id = $1`,
          [env.id]
        );
        await execute(
          `UPDATE license_overage_cases
           SET resolved_at = now(), phase = 'resolved', updated_at = now()
           WHERE environment_id = $1
             AND resolved_at IS NULL`,
          [env.id]
        );
      }
      return;
    }

    const snapshot = await getEnvironmentLicensingSnapshot(env.id);

    if (snapshot.overage_count <= 0) {
      if (snapshot.open_case_id && !options.dryRun) {
        await queueOverageNotification(
          snapshot.open_case_id,
          snapshot.workspace_id,
          snapshot.environment_id,
          phaseKey('resolved'),
          {
            overage_count: 0,
            active_device_count: snapshot.active_device_count,
            entitled_seats: snapshot.entitled_seats,
            overage_age_days: snapshot.overage_age_days,
          },
          stats
        );

        await execute(
          `UPDATE license_overage_cases
           SET resolved_at = now(), phase = 'resolved', updated_at = now()
           WHERE id = $1`,
          [snapshot.open_case_id]
        );
        stats.cases_resolved += 1;

        const devicesToEnable = await query<{ device_id: string }>(
          `SELECT DISTINCT lea.device_id
           FROM license_enforcement_actions lea
           LEFT JOIN license_enforcement_actions wipe
             ON wipe.case_id = lea.case_id
            AND wipe.device_id = lea.device_id
            AND wipe.action = 'wipe'
           JOIN devices d ON d.id = lea.device_id
           WHERE lea.case_id = $1
             AND lea.action = 'disable'
             AND wipe.id IS NULL
             AND d.deleted_at IS NULL
             AND d.state = 'DISABLED'
           ORDER BY lea.created_at DESC`,
          [snapshot.open_case_id]
        );

        for (const row of devicesToEnable) {
          await execute(
            `INSERT INTO license_enforcement_actions
               (id, case_id, workspace_id, environment_id, device_id, action, status, reason, executed_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'enable', 'queued', 'Licensing overage resolved', now(), now(), now())
             ON CONFLICT (case_id, device_id, action) DO NOTHING`,
            [crypto.randomUUID(), snapshot.open_case_id, snapshot.workspace_id, snapshot.environment_id, row.device_id]
          );
          await enqueueDeviceCommand(snapshot.environment_id, row.device_id, 'ENABLE');
          stats.enable_actions_queued += 1;
        }
      }
      return;
    }

    stats.overage_environments += 1;
    const overageAgeDays = snapshot.overage_started_at ? intervalDaysSince(snapshot.overage_started_at) : 0;
    const phase = getOveragePhaseForAgeDays(overageAgeDays, settings);

    let openCaseId = snapshot.open_case_id;
    if (!options.dryRun) {
      const openCase = await ensureOpenCase(env.workspace_id, env.id, snapshot.overage_count, phase);
      openCaseId = openCase.id;
      if (openCase.created) stats.cases_created += 1;

      for (const milestone of OVERAGE_DAY_MILESTONES) {
        if (overageAgeDays >= milestone) {
          await queueOverageNotification(
            openCaseId,
            env.workspace_id,
            env.id,
            milestoneKey(milestone),
            {
              overage_count: snapshot.overage_count,
              active_device_count: snapshot.active_device_count,
              entitled_seats: snapshot.entitled_seats,
              overage_age_days: overageAgeDays,
              overage_phase: phase,
            },
            stats
          );
        }
      }

      const shouldSendPhaseNotification = openCase.created
        ? (phase === 'block' || phase === 'disable' || phase === 'wipe')
        : openCase.previous_phase !== phase && (phase === 'block' || phase === 'disable' || phase === 'wipe');
      if (shouldSendPhaseNotification) {
        await queueOverageNotification(
          openCaseId,
          env.workspace_id,
          env.id,
          phaseKey(phase),
          {
            overage_count: snapshot.overage_count,
            active_device_count: snapshot.active_device_count,
            entitled_seats: snapshot.entitled_seats,
            overage_age_days: overageAgeDays,
            overage_phase: phase,
          },
          stats
        );
      }
    }

    if (options.dryRun || !openCaseId) return;

    if (phase === 'disable' || phase === 'wipe') {
      if (!canQueueEnforcementAction(enforcementState)) return;

      const devicesToDisable = await query<{ id: string }>(
        `SELECT id
         FROM devices
         WHERE environment_id = $1
           AND deleted_at IS NULL
           AND state = 'ACTIVE'
         ORDER BY enrollment_time DESC NULLS LAST, created_at DESC, id DESC
         LIMIT $2`,
        [env.id, snapshot.overage_count]
      );

      for (const device of devicesToDisable) {
        if (!canQueueEnforcementAction(enforcementState)) break;

        const inserted = await execute(
          `INSERT INTO license_enforcement_actions
             (id, case_id, workspace_id, environment_id, device_id, action, status, reason, executed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'disable', 'queued', 'License expiry. Oversubscribed.', now(), now(), now())
           ON CONFLICT (case_id, device_id, action) DO NOTHING`,
          [crypto.randomUUID(), openCaseId, env.workspace_id, env.id, device.id]
        );
        if ((inserted.rowCount ?? 0) > 0) {
          await enqueueDeviceCommand(env.id, device.id, 'DISABLE');
          stats.disable_actions_queued += 1;
          enforcementState.actionsQueued += 1;
        }
      }
    }

    if (phase === 'wipe') {
      if (!canQueueEnforcementAction(enforcementState)) return;

      const devicesToWipe = await query<{ device_id: string }>(
        `SELECT lea.device_id
         FROM license_enforcement_actions lea
         JOIN devices d ON d.id = lea.device_id
         LEFT JOIN license_enforcement_actions wipe
           ON wipe.case_id = lea.case_id
          AND wipe.device_id = lea.device_id
          AND wipe.action = 'wipe'
         WHERE lea.case_id = $1
           AND lea.action = 'disable'
           AND wipe.id IS NULL
           AND d.deleted_at IS NULL
         ORDER BY d.enrollment_time DESC NULLS LAST, d.created_at DESC, d.id DESC`,
        [openCaseId]
      );

      for (const row of devicesToWipe) {
        if (!canQueueEnforcementAction(enforcementState)) break;

        const inserted = await execute(
          `INSERT INTO license_enforcement_actions
             (id, case_id, workspace_id, environment_id, device_id, action, status, reason, executed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'wipe', 'queued', 'License expiry. Oversubscribed.', now(), now(), now())
           ON CONFLICT (case_id, device_id, action) DO NOTHING`,
          [crypto.randomUUID(), openCaseId, env.workspace_id, env.id, row.device_id]
        );
        if ((inserted.rowCount ?? 0) > 0) {
          await enqueueDeviceCommand(env.id, row.device_id, 'WIPE');
          stats.wipe_actions_queued += 1;
          enforcementState.actionsQueued += 1;
        }
      }
    }
  } catch (err) {
    stats.errors += 1;
    console.error(`licensing-reconcile failed for environment ${env.id}:`, err);
  }
}

export async function runLicensingReconcile(options: ReconcileOptions): Promise<LicensingReconcileStats> {
  const stats: LicensingReconcileStats = {
    environments_checked: 0,
    overage_environments: 0,
    cases_created: 0,
    cases_resolved: 0,
    disable_actions_queued: 0,
    wipe_actions_queued: 0,
    enable_actions_queued: 0,
    errors: 0,
    platform_grants_expired: 0,
    environment_entitlements_expired: 0,
    notifications_queued: 0,
    notifications_sent: 0,
    dry_run: options.dryRun,
    lock_acquired: false,
    skipped_due_to_lock: false,
  };
  const workspaceSettingsCache = new Map<string, WorkspaceLicensingSettings>();
  const enforcementState: EnforcementActionState = { actionsQueued: 0, capWarningLogged: false };

  const lockAcquired = await tryAcquireReconcileLock();
  stats.lock_acquired = lockAcquired;
  if (!lockAcquired) {
    stats.skipped_due_to_lock = true;
    return stats;
  }

  try {
    const platformLicensingEnabled = await isPlatformLicensingEnabled();
    if (!platformLicensingEnabled) {
      if (!options.dryRun) {
        await execute(
          `DELETE FROM job_queue jq
           USING license_enforcement_actions lea
           WHERE jq.job_type = 'device_command'
             AND jq.status = 'pending'
             AND jq.environment_id = lea.environment_id
             AND jq.payload ->> 'device_id' = lea.device_id::text
             AND UPPER(COALESCE(jq.payload ->> 'command_type', '')) IN ('DISABLE', 'ENABLE', 'WIPE')
             AND lea.status = 'queued'`
        );
        await execute(
          `UPDATE license_enforcement_actions
           SET status = 'failed',
               error = 'Licensing disabled',
               updated_at = now()
           WHERE status = 'queued'`
        );
        await execute(
          `UPDATE license_overage_cases
           SET resolved_at = now(), phase = 'resolved', updated_at = now()
           WHERE resolved_at IS NULL`
        );
      }
      return stats;
    }

    if (!options.dryRun) {
      const expiryStats = await syncLicensingWindowExpiries();
      stats.platform_grants_expired = expiryStats.platform_grants_expired;
      stats.environment_entitlements_expired = expiryStats.environment_entitlements_expired;
      await queueNearExpiryBillingNotifications(options, stats);
    }

    let offset = 0;

    while (true) {
      const environments = await query<{ id: string; workspace_id: string }>(
        `SELECT id, workspace_id
         FROM environments
         ORDER BY created_at ASC
         LIMIT $1 OFFSET $2`,
        [ENV_BATCH_SIZE, offset]
      );

      if (environments.length === 0) break;
      offset += environments.length;

      for (const env of environments) {
        await reconcileEnvironment(env, options, stats, workspaceSettingsCache, enforcementState);
      }
    }

    return stats;
  } finally {
    await releaseReconcileLock();
  }
}
