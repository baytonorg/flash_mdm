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
| `normalizeAllowPersonalUsage`, `normalizeOneTimeUse`, `resolveEnrollmentDurationDays` | `_lib/enrollment-token-options.js` | Normalize enrollment token parameters (personal usage aliases, one-time flag, and duration formats) |

## Key Logic

1. Validates the request body requires `environment_id`; verifies the environment exists and is bound to an enterprise with a GCP project.
2. If a `group_id` is provided, validates it belongs to the environment.
3. Resolves the effective AMAPI policy by walking the group hierarchy (`group_closures`) upward to find the nearest `policy_assignment`, falling back to the environment-level assignment. Prefers group-specific `policy_derivatives` for immediate correct policy on enrollment.
4. Calls `assertEnvironmentEnrollmentAllowed` to enforce licensing limits.
5. Normalizes token options via `enrollment-token-options` library: duration accepts `expiryDays`, `durationDays`, or `duration`/`durationSeconds` (seconds string like `"604800s"` or bare number), clamped to 1-365 days (default 30); `allowPersonalUsage` accepts shorthand aliases (e.g. `"DEDICATED_DEVICE"`, `"ALLOWED"`); `oneTimeOnly` accepts boolean/string/number truthy values. Builds and sends a `POST` to the AMAPI `enrollmentTokens` endpoint with the resolved parameters and embedded `additionalData` containing the group ID.
6. Merges provisioning extras (Wi-Fi SSID/password/security, locale, timezone, skip flags) into the AMAPI-returned QR code JSON via `applyProvisioningExtrasToQrPayload`.
7. Stores the token locally in `enrollment_tokens` and returns the token value, QR data, and metadata.
8. On failure, logs a `create_failed` audit event and returns the AMAPI error status or 502.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/enrollment-create` | Authenticated user with `write` permission on the environment | Create a new enrollment token |
