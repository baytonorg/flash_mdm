# `netlify/functions/cleanup-scheduled.ts`

> Scheduled daily retention function that observes credential-cleanup candidates without mutation and cleans up bounded non-credential operational data.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `config` | `{ schedule: string }` | Netlify scheduled function config: runs daily at 03:00 UTC |
| `default` | `(request: Request, context: Context) => Promise<void>` | Default-exported scheduled handler |

## Internal Functions

| Name | Location | Description |
|------|-------|-------------|
| `observeCredentials` | Source-backed helper | Counts up to 10,001 matching rows and reports a bounded count and truncation flag without selecting credential values or mutating records |
| `parsePositiveInt` | Source-backed helper | Parses an environment variable as a positive integer with a fallback default |
| `deleteInBatches` | Source-backed helper | Deletes non-credential rows matching a fixed predicate in batches of 10,000 to avoid long-running transactions |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute` | `_lib/db` | Database operations |

## Key Logic

Runs as a Netlify scheduled function (cron: `0 3 * * *`). Performs the following cleanup operations in sequence:

1. **Expired sessions** - count-only observation; records are preserved.
2. **Expired magic links** - count-only observation; records are preserved.
3. **Expired pending invites** - count-only observation; status is preserved.
4. **Old Pub/Sub events** - archive events older than 30 days.
5. **Terminal jobs** - delete completed, dead, and delivery-uncertain jobs older than 7 days.
6. **Stale rate-limit buckets** - delete buckets unused for 24 hours.
7. **Stale pending TOTP setup data** - count-only observation; encrypted material and timestamps are preserved.
8. **Old audit logs** - delete older than `AUDIT_LOG_RETENTION_DAYS` (default 30 days).
9. **Device locations** - delete older than `DEVICE_LOCATION_RETENTION_DAYS` (default 90 days).
10. **Device status reports** - delete older than `DEVICE_STATUS_REPORT_RETENTION_DAYS` (default 90 days).
11. **Terminal command operations** - delete submitted, successful, failed, and cancelled rows older than `COMMAND_OPERATION_RETENTION_DAYS` (default 180 days); uncertain, reconciling, and unresolved rows are preserved.
12. **Flashi chat messages** - delete older than `FLASHAGENT_CHAT_RETENTION_DAYS` (default 30 days).
13. **Soft-deleted devices** - nullify references in `audit_log` and `workflow_executions`, then hard-delete devices after `SOFT_DELETED_DEVICE_RETENTION_DAYS` (default 30 days).

Credential observations return at most 10,000 candidates per category and a truncation flag without selecting credential values. Legacy mutation-count fields remain zero. Manual credential consumption and explicit operator lifecycle routes are separate from scheduled maintenance. Scheduled cleanup also does not mutate API keys. Authentication rejects expired API keys without changing their backing records.

Non-credential deletions use `deleteInBatches` with a batch size of 10,000 to avoid long-running transactions. See the authoritative [data retention and cleanup guide](../../../operations/data-retention.md) and the credential-preservation decision recorded in [private issue #197](https://github.com/jasonbayton/flash_mdm/issues/197).

| Claim | Evidence | Confidence |
|---|---|---|
| Scheduled maintenance observes and preserves expired sessions, magic links, pending invites, and stale pending TOTP data. | `netlify/functions/cleanup-scheduled.ts`; `netlify/functions/__tests__/cleanup-scheduled.test.ts`; `docs/operations/data-retention.md`; [private issue #197](https://github.com/jasonbayton/flash_mdm/issues/197) | high |
| Non-credential retention still archives or deletes the bounded categories listed above. | `netlify/functions/cleanup-scheduled.ts`; focused retention tests | high |

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| N/A | Scheduled (`0 3 * * *`) | Internal (Netlify scheduler) | Daily data retention and cleanup |

Last reviewed: 2026-11-07.
