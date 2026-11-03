# Data retention & cleanup

Flash MDM includes scheduled cleanup routines that enforce retention windows for operational and compliance purposes.

## Scheduled cleanup

Handler:

- `netlify/functions/cleanup-scheduled.ts`

This function runs daily at **03:00 UTC** (`0 3 * * *`). It reads retention configuration from environment variables and runs batched DB cleanup queries (up to 10,000 rows per batch per table).

### What gets cleaned up

| Target | Behaviour |
|---|---|
| Expired sessions | Count-only observation, records preserved |
| Expired magic links | Count-only observation, records preserved |
| Expired/pending invites | Count-only observation, status preserved |
| Old Pub/Sub events (>30 days) | Archived (status set to `archived`) |
| Completed/dead/delivery-uncertain job queue entries (>7 days) | Hard-deleted |
| Stale rate limit buckets (unused >24 hours) | Hard-deleted |
| Stale pending TOTP setup data | Count-only observation, encrypted seed and timestamps preserved |
| Old audit log rows | Hard-deleted per `AUDIT_LOG_RETENTION_DAYS` |
| Command-operation ledger rows | Submitted, successful, failed, and cancelled rows are hard-deleted per `COMMAND_OPERATION_RETENTION_DAYS`; uncertain, reconciling, and unresolved rows are retained |
| Old device location records | Hard-deleted per `DEVICE_LOCATION_RETENTION_DAYS` |
| Old device status reports | Hard-deleted per `DEVICE_STATUS_REPORT_RETENTION_DAYS` |
| Long-soft-deleted devices | Hard-deleted per `SOFT_DELETED_DEVICE_RETENTION_DAYS`; audit log and workflow execution device references are nullified before deletion |

Credential observations return up to 10,000 candidates per category without selecting credential values. Legacy mutation-count fields remain zero. `observed_*` fields report counts and `observed_*_truncated` is 1 when additional candidates exist, otherwise 0. These observations require operator review and never authorise retirement. Scheduled cleanup does not mutate API keys. Authentication consumption and explicit operator actions are separate paths outside these maintenance guards.

## Retention-related environment variables

As built (with defaults when unset/invalid):

- `AUDIT_LOG_RETENTION_DAYS` (default: **30**)
- `COMMAND_OPERATION_RETENTION_DAYS` (default: **180**)
- `DEVICE_LOCATION_RETENTION_DAYS` (default: **90**)
- `DEVICE_STATUS_REPORT_RETENTION_DAYS` (default: **90**)
- `SOFT_DELETED_DEVICE_RETENTION_DAYS` (default: **30**)

See also:

- `docs/reference/environment-variables.md`

## Enrollment token observations

Scheduled reconciliation preserves enrollment token rows, credential values, QR data, expiry and backing metadata. Expired, remotely missing and orphaned records require explicit operator follow-up. Automated observations never authorise credential retirement.

Each environment reports at most 100 local rows, with a truncation flag, and uses GET requests only. Listings stop after 20 pages or a repeated page token. Incomplete listings fall back to resource GETs for the sampled local tokens. Non-404 failures remain uncertain. Counts may overlap because expiry and remote existence describe different facts. No credential values are selected or logged. Explicit operator deletion routes retain their existing behaviour.

## Operator guidance

- Retention values are operator-controlled and should reflect your compliance and operational needs.
- Validate retention behavior in staging before tightening windows.
- If you need longer audit retention for compliance, increase `AUDIT_LOG_RETENTION_DAYS` and ensure your DB storage and backup policies match.
- Most cleanup failures abort the remaining steps and return an error. Missing optional command-operation or chat tables are handled separately. Check function logs for `Daily cleanup error` entries.
