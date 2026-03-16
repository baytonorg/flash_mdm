# `netlify/functions/cleanup-scheduled.ts`

> Scheduled daily cleanup function that purges expired sessions, magic links, invites, old audit logs, device telemetry, stale jobs, and soft-deleted devices.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `config` | `{ schedule: string }` | Netlify scheduled function config: runs daily at 03:00 UTC |
| `default` | `(request: Request, context: Context) => Promise<void>` | Default-exported scheduled handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parsePositiveInt` | 142-145 | Parses an env var string to a positive integer with a fallback default |
| `deleteInBatches` | 147-171 | Deletes rows matching a WHERE clause in batches of 10,000 to avoid long-running transactions |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute` | `_lib/db` | Database operations |

## Key Logic

Runs as a Netlify scheduled function (cron: `0 3 * * *`). Performs the following cleanup operations in sequence:

1. **Expired sessions** -- hard-delete where `expires_at < now()`
2. **Expired magic links** -- hard-delete where `expires_at < now()`
3. **Expired invites** -- mark pending invites as `expired`
4. **Old PubSub events** -- archive events older than 30 days
5. **Completed/dead jobs** -- delete from `job_queue` older than 7 days
6. **Stale rate limit buckets** -- delete buckets unused for 24 hours
7. **Expired API keys** -- revoke keys past their `expires_at`
8. **Old audit logs** -- delete older than `AUDIT_LOG_RETENTION_DAYS` (default 365)
9. **Device locations** -- delete older than `DEVICE_LOCATION_RETENTION_DAYS` (default 90)
10. **Device status reports** -- delete older than `DEVICE_STATUS_REPORT_RETENTION_DAYS` (default 90)
11. **Soft-deleted devices** -- nullify FK references in `audit_log` and `workflow_executions`, then hard-delete devices soft-deleted longer than `SOFT_DELETED_DEVICE_RETENTION_DAYS` (default 30)

All batch deletions use the `deleteInBatches` helper (batch size 10,000) to avoid lock contention on large tables.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| N/A | Scheduled (`0 3 * * *`) | Internal (Netlify scheduler) | Daily data retention and cleanup |
