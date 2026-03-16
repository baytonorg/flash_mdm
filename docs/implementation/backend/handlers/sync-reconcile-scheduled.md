# `netlify/functions/sync-reconcile-scheduled.ts`

> Scheduled reconciliation function that syncs local device and enrollment token records against the Android Management API every 15 minutes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `config` | `{ schedule: string }` | Netlify scheduled function config: runs every 15 minutes |
| `default` | `() => Promise<void>` | Default-exported scheduled handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `listReconcilableEnvironments` | 88-111 | Queries environments that have an enterprise binding and credentials, with schema fallback for missing `deleted_at` column |
| `reconcileEnvironment` | 113-267 | Paginates through AMAPI devices, upserts each into the local DB, and soft-deletes devices no longer present in AMAPI |
| `reconcileEnrollmentTokens` | 269-354 | Hard-deletes expired tokens (after a 24h grace period), paginates AMAPI enrollment tokens, and retires stale/orphaned local tokens |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `execute` | `_lib/db` | Database operations |
| `amapiCall` | `_lib/amapi` | Android Management API calls |
| `logAudit` | `_lib/audit` | Audit logging for reconciliation-driven deletions |

## Key Logic

Runs as a Netlify scheduled function (cron: `*/15 * * * *`). Iterates all environments that have a bound enterprise and stored Google credentials.

**Device reconciliation per environment:**
1. Paginates through all AMAPI devices (page size 100).
2. For each device: handles `previousDeviceNames` by updating existing records to the new AMAPI name, then upserts the device record using `ON CONFLICT (amapi_name) DO UPDATE`.
3. After full pagination completes, queries local active devices and soft-deletes any not seen in the AMAPI response (sets `state = 'DELETED'`, `deleted_at = now()`). Logs each deletion to the audit trail.
4. If pagination fails partway, the soft-delete pass is skipped to avoid false deletions.

**Enrollment token reconciliation:**
1. Hard-deletes expired tokens after a 24-hour grace period (`ENROLLMENT_TOKEN_RETENTION_GRACE_HOURS`) to allow delayed enrollment processing.
2. Paginates AMAPI enrollment tokens and builds a set of known AMAPI names.
3. Retires stale tokens (local tokens with AMAPI names not found remotely) and orphaned tokens (no AMAPI name) by clearing sensitive fields and setting expiry to now.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| N/A | Scheduled (`*/15 * * * *`) | Internal (Netlify scheduler) | Reconcile devices and enrollment tokens with AMAPI |
