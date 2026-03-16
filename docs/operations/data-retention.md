# Data retention & cleanup

Flash MDM includes scheduled cleanup routines that enforce retention windows for operational and compliance purposes.

## Scheduled cleanup

Handler:

- `netlify/functions/cleanup-scheduled.ts`

This function runs daily at **03:00 UTC** (`0 3 * * *`). It reads retention configuration from environment variables and runs batched DB cleanup queries (up to 10,000 rows per batch per table).

### What gets cleaned up

| Target | Behaviour |
|---|---|
| Expired sessions | Hard-deleted |
| Expired magic links | Hard-deleted |
| Expired/pending invites | Marked `expired` |
| Old Pub/Sub events (>30 days) | Archived (status set to `archived`) |
| Completed/dead job queue entries (>7 days) | Hard-deleted |
| Stale rate limit buckets (unused >24 hours) | Hard-deleted |
| Stale pending TOTP setup data | Pending TOTP blob + timestamp cleared when older than 1 day (or legacy rows missing timestamp) |
| Expired API keys | Revoked (`revoked_at` set) — keys with no expiry are left active |
| Old audit log rows | Hard-deleted per `AUDIT_LOG_RETENTION_DAYS` |
| Old device location records | Hard-deleted per `DEVICE_LOCATION_RETENTION_DAYS` |
| Old device status reports | Hard-deleted per `DEVICE_STATUS_REPORT_RETENTION_DAYS` |
| Long-soft-deleted devices | Hard-deleted per `SOFT_DELETED_DEVICE_RETENTION_DAYS`; audit log and workflow execution device references are nullified before deletion |

## Retention-related environment variables

As built (with defaults when unset/invalid):

- `AUDIT_LOG_RETENTION_DAYS` (default: **365**)
- `DEVICE_LOCATION_RETENTION_DAYS` (default: **90**)
- `DEVICE_STATUS_REPORT_RETENTION_DAYS` (default: **90**)
- `SOFT_DELETED_DEVICE_RETENTION_DAYS` (default: **30**)

See also:

- `docs/reference/environment-variables.md`

## Enrollment token grace

Enrollment token reconciliation uses a grace window to allow delayed enrollment processing to resolve token metadata before hard-deletion:

- `ENROLLMENT_TOKEN_RETENTION_GRACE_HOURS = 24` (constant, not configurable)

Seen in:

- `netlify/functions/enrollment-sync.ts`
- `netlify/functions/sync-reconcile-scheduled.ts`

## Operator guidance

- Retention values are operator-controlled and should reflect your compliance and operational needs.
- Validate retention behavior in staging before tightening windows.
- If you need longer audit retention for compliance, increase `AUDIT_LOG_RETENTION_DAYS` and ensure your DB storage and backup policies match.
- Cleanup failures are logged but do not abort subsequent cleanup steps — check Netlify function logs for `Daily cleanup error` entries.
