# `netlify/functions/environment-zero-touch.ts`

> Zero-touch provisioning configuration endpoint. Manages zero-touch iframe token generation and reusable enrollment token creation for zero-touch setups.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireEnvironmentPermission`, `requireEnvironmentResourcePermission` | `_lib/rbac` | Environment-scoped permission checks |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi` | AMAPI web token and enrollment token creation |
| `query`, `queryOne`, `execute` | `_lib/db` | Database operations |
| `logAudit` | `_lib/audit` | Audit trail |
| `assertEnvironmentEnrollmentAllowed` | `_lib/licensing` | Licensing entitlement check |
| `applyProvisioningExtrasToQrPayload` | `enrollment-create` | Merging provisioning extras into QR payload |

## Internal Functions

| Name | Description |
|------|-------------|
| `ensureNonSensitiveExtras` | Defensive validator for potentially sensitive extra key/value patterns |
| `normalizeProvisioningExtrasInput` | Sanitises and normalises provisioning extras input (locale, timezone, Wi-Fi config, enrollment flags) |
| `getEnvironmentContext` | Fetches environment + workspace context (enterprise_name, gcp_project_id) via JOIN |
| `createEnrollmentTokenForZeroTouch` | Creates an AMAPI enrollment token, stores it locally, applies provisioning extras, audit logs |

## Key Logic

### GET (read zero-touch options)

1. Requires `environment_id` query param.
2. RBAC: environment `read` permission.
3. Returns `{ environment, groups, active_tokens }` — environment metadata, available groups, and non-expired enrollment tokens.

### POST actions

All POST actions require `environment_id`, `action`, and RBAC `environment:manage_settings` permission. The environment must be bound to an enterprise with a GCP project configured.

#### `create_iframe_token`

Creates an AMAPI web token with `ZERO_TOUCH_CUSTOMER_MANAGEMENT` feature enabled. Returns `{ iframe_token, iframe_url }` where the URL points to `https://enterprise.google.com/android/zero-touch/embedded/companyhome`.

#### `create_enrollment_token_for_zt`

Creates a reusable, non-expiring enrollment token via AMAPI for zero-touch binding. Supports optional group assignment, personal usage setting, and provisioning extras. Always persists as `one_time_use = false` and `expires_at = null`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/environments/zero-touch` | Session / API key (environment read) | Get zero-touch options (groups, tokens) |
| `POST` | `/api/environments/zero-touch` | Session (environment:manage_settings) | Execute zero-touch actions (iframe token, enrollment token) |
