# `netlify/functions/enrollment-create.ts`

> Creates an AMAPI enrollment token for a given environment, optionally scoped to a group, with provisioning extras (Wi-Fi, locale, etc.) merged into the QR payload.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `applyProvisioningExtrasToQrPayload` | 61-109 | Parses a raw QR JSON string and merges provisioning extras (locale, timezone, Wi-Fi config, skip flags) into the Android provisioning payload |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database queries and inserts |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Enforce write permission on the target environment |
| `logAudit` | `_lib/audit.js` | Audit logging for token creation and failures |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Create the enrollment token via the Android Management API |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response utilities and request parsing |
| `assertEnvironmentEnrollmentAllowed` | `_lib/licensing.js` | Licensing gate -- ensures the environment has not exceeded its enrollment limit |
| `normalizeAllowPersonalUsage`, `normalizeOneTimeUse`, `resolveEnrollmentTokenDuration`, `toPostgresTimestampPrecision` | `_lib/enrollment-token-options.js` | Normalize enrollment token parameters and safely store AMAPI timestamps |

## Key Logic

1. Validates the request body requires `environment_id`; verifies the environment exists and is bound to an enterprise with a GCP project.
2. If a `group_id` is provided, validates it belongs to the environment.
3. Resolves the effective AMAPI policy by walking the group hierarchy (`group_closures`) upward to find the nearest `policy_assignment`, falling back to the environment-level assignment. Prefers group-specific `policy_derivatives` for immediate correct policy on enrollment.
4. Calls `assertEnvironmentEnrollmentAllowed` to enforce licensing limits.
5. Normalizes token options via `enrollment-token-options`: ordinary duration accepts `expiryDays`, `durationDays`, or `duration`/`durationSeconds` and is clamped to 1-365 days (default 30). The exact shared AMAPI maximum `315576000000s` is preserved for the explicit maximum-duration mode. Personal usage and one-time aliases are normalized before the AMAPI request.
6. Merges provisioning extras (Wi-Fi SSID/password/security, locale, timezone, skip flags) into the AMAPI-returned QR code JSON via `applyProvisioningExtrasToQrPayload`.
7. Stores the exact AMAPI `expirationTimestamp` in `amapi_expiration_timestamp` for API round-tripping. A microsecond-truncated copy is stored in `expires_at` for PostgreSQL comparisons, avoiding maximum timestamps rounding into year 10000.
8. On failure, logs a `create_failed` audit event and returns the AMAPI error status or 502.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/enrollment-create` | Authenticated user with `write` permission on the environment | Create a new enrollment token |
