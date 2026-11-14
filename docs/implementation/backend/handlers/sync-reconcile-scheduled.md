# `netlify/functions/sync-reconcile-scheduled.ts`

> Scheduled reconciliation function that reconciles devices and observes enrollment token status against the Android Management API every 15 minutes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `config` | `{ schedule: string }` | Netlify scheduled function config: runs every 15 minutes |
| `default` | `(request: Request) => Promise<Response>` | Default-exported scheduled handler |

## Internal Functions

| Name | Description |
|------|-------------|
| `listReconcilableEnvironments` | Queries environments that have an enterprise binding and credentials, with schema fallback for missing `deleted_at` column |
| `reconcileEnvironment` | Paginates through AMAPI devices, reconciles device lineage and upserts each local record, then soft-deletes devices no longer present in AMAPI |
| `reconcileEnrollmentTokens` | Reads bounded local token metadata, checks remote presence with GET requests, and reports candidates for operator review |

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
2. For each device: reconciles `previousDeviceNames` in a per-device advisory-lock transaction. An existing current row is retained with its predecessor history. Only if no current row exists is one ranked predecessor renamed to the current AMAPI name; ranking prefers active rows, matching IMEI/serial, and recency. The upsert records `previous_device_names` atomically and a unique-name race preserves the winning row.
3. After full pagination completes, queries local active devices and soft-deletes any not seen in the AMAPI response (sets `state = 'DELETED'`, `deleted_at = now()`). Logs each deletion to the audit trail.
4. If pagination fails partway, the soft-delete pass is skipped to avoid false deletions.

**Enrollment token observations:**
1. Inspects at most 100 local rows per environment. The query reads one extra row to detect truncation and projects only identifiers and expiry metadata.
2. Lists remote token names with bounded GET pagination. An incomplete listing falls back to GETs for the sampled local token names. A non-404 failure leaves the remote status uncertain.
3. Reports expired, missing, orphaned and uncertain candidates for operator review. The scheduled run preserves the token rows, credential values, QR data, expiry and backing metadata.

The [data retention and cleanup guide](../../../operations/data-retention.md) describes the preservation contract and the separate operator lifecycle paths.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| N/A | Scheduled (`*/15 * * * *`) | Internal (Netlify scheduler) | Reconcile devices and observe enrollment token status with AMAPI |
