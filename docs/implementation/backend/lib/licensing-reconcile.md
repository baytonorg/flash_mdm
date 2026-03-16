# `netlify/functions/_lib/licensing-reconcile.ts`

> Background reconciliation job that scans all environments for licence overage, manages overage cases, escalates enforcement actions (disable/wipe), sends notifications, and re-enables devices when overage resolves.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `LicensingReconcileStats` | `interface` | Counters returned after a reconciliation run (environments checked, cases created/resolved, actions queued, notifications, errors, lock status) |
| `runLicensingReconcile` | `(options: { dryRun: boolean }) => Promise<LicensingReconcileStats>` | Main entry point: acquires a Postgres advisory lock, expires stale grants, iterates all environments in batches, reconciles each, and returns aggregate stats |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `intervalDaysSince` | 51-57 | Computes whole days elapsed since a timestamp string |
| `toBoolean` | 59-61 | Coerces Postgres boolean-like values (`'t'`, `'true'`, `1`, etc.) to JS boolean |
| `tryAcquireReconcileLock` | 63-69 | Attempts a Postgres advisory lock to prevent concurrent reconcile runs |
| `releaseReconcileLock` | 71-73 | Releases the advisory lock |
| `ensureOpenCase` | 75-122 | Finds or creates a `license_overage_cases` row for an environment; updates peak overage and phase on existing cases |
| `enqueueDeviceCommand` | 124-134 | Inserts a `device_command` job into `job_queue` for DISABLE, ENABLE, or WIPE |
| `getNotificationContext` | 202-235 | Loads workspace name, environment name, and owner/admin email addresses for notifications |
| `queueOverageNotification` | 237-323 | Inserts a deduplicated notification row, sends email via Resend, updates status, and logs audit events for success or failure |
| `canQueueEnforcementAction` | 325-336 | Checks the per-run enforcement action cap (500) and logs a warning once when reached |
| `queueNearExpiryBillingNotifications` | 338-434 | Finds platform grants and environment entitlements expiring in 30, 7, or 1 days and sends near-expiry billing emails |
| `reconcileEnvironment` | 436-668 | Core per-environment logic: checks licensing enabled, gets snapshot, resolves or escalates overage, queues disable/wipe/enable commands, sends milestone and phase-change notifications |
| `buildNotificationSubject` | 161-176 | Generates email subject lines based on notification key (milestone day or phase transition) |
| `buildNotificationHtml` | 178-200 | Generates HTML email body with overage details |
| `escapeHtml` | 152-159 | Escapes HTML special characters for safe email rendering |
| `milestoneKey` | 144-146 | Returns notification dedup key for day milestones (e.g. `overage:day:7`) |
| `phaseKey` | 148-150 | Returns notification dedup key for phase transitions (e.g. `phase:block`) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne` | `_lib/db.js` | All database operations |
| `isMissingRelationError` | `_lib/db-errors.js` | Graceful handling when tables are missing during migrations |
| `getEnvironmentLicensingSnapshot`, `getOveragePhaseForAgeDays`, `isPlatformLicensingEnabled`, `getWorkspaceLicensingSettings`, `syncLicensingWindowExpiries` | `_lib/licensing.js` | Core licensing data reads and expiry sync |
| `logAudit` | `_lib/audit.js` | Audit trail for notification and enforcement events |
| `sendEmail` | `_lib/resend.js` | Sending overage notification emails |
| `buildNearExpiryEmail`, `getWorkspaceScopeNames`, `queueAndSendBillingEmail` | `_lib/billing-notifications.js` | Near-expiry billing notification content and dispatch |

## Key Logic

The reconciliation loop is designed to run as a scheduled background job. It uses a Postgres advisory lock (`pg_try_advisory_lock`) to guarantee only one instance runs at a time; concurrent invocations exit immediately with `skipped_due_to_lock: true`.

**Main flow:**
1. Check if platform licensing is enabled globally. If disabled, resolve all open cases and cancel queued enforcement actions.
2. Expire stale license grants and environment entitlements via `syncLicensingWindowExpiries`.
3. Send near-expiry billing notifications for grants/entitlements expiring in 30, 7, or 1 days.
4. Iterate all environments in batches of 200.
5. For each environment, get the licensing snapshot and determine the overage phase.

**Per-environment reconciliation:**
- **No overage**: If an open case exists, resolve it, send a "resolved" notification, and queue ENABLE commands for previously disabled (non-wiped) devices.
- **Overage detected**: Create or update an overage case. Send milestone notifications at days 1, 7, and 25. Send phase-transition notifications when moving to block, disable, or wipe.
- **Disable phase**: Queue DISABLE commands for the most recently enrolled active devices up to the overage count.
- **Wipe phase**: Queue WIPE commands for previously disabled devices that have not yet been wiped.

Enforcement actions are capped at 500 per run to prevent runaway operations. All enforcement and notification actions are skipped in dry-run mode.
