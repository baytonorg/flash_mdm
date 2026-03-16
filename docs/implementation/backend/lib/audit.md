# `netlify/functions/_lib/audit.ts`

> Writes sanitized audit log entries to the database with automatic API key attribution and sensitive field redaction.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `logAudit` | `(entry: AuditEntry) => Promise<void>` | Inserts an audit log row; never throws -- errors are caught and logged to console |
| `_sanitizeAuditValue` | `(value: unknown) => unknown` | Recursively redacts sensitive keys from audit detail objects (exported for testing) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `sanitizeAuditValue` | 28-46 | Recursively walks objects/arrays, replacing values whose keys match `SENSITIVE_KEY_PATTERN` with `[REDACTED]` |
| `applyRequestAuthAttribution` | 48-89 | Enriches audit entries with API key identity from the current request's auth context (via AsyncLocalStorage) |
| `isMissingAuditLogColumnError` | 154-160 | Detects Postgres error 42703 for missing `api_key_id`, `actor_type`, or `visibility_scope` columns to trigger legacy fallback |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute` | `_lib/db.ts` | Executing INSERT statements against the audit_log table |
| `getCurrentAuditAuthContext` | `_lib/request-auth-context.ts` | Retrieving the current request's auth context from AsyncLocalStorage for API key attribution |

## Key Logic

`logAudit` is the single entry point for all audit logging. It follows a defensive pattern:

1. **Attribution**: If the current request is authenticated via API key (detected via `getCurrentAuditAuthContext`), the entry is enriched with `actor_type: 'api_key'`, the API key ID, and detailed auth context in the `details` JSONB. Explicit actor overrides (e.g., system events) are preserved.

2. **Sanitization**: All `details` values are recursively scanned. Keys matching the pattern `/(pass(word)?|secret|token|authorization|api[_-]?key|private[_-]?key|totp|otp|activationcode)/i` have their values replaced with `[REDACTED]`.

3. **Insertion**: The entry is written with all 12 columns. If the database schema is missing newer columns (`api_key_id`, `actor_type`, `visibility_scope` -- Postgres error 42703), a fallback INSERT using only 9 columns is attempted.

4. **Failure tolerance**: All errors are caught and logged to console. Audit logging never breaks the calling function's flow.
