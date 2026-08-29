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
| `buildAndroidDevicePolicyDpcExtras` | Builds Google's documented Android Device Policy component, checksum, and enrollment-token admin extras bundle |
| `normalizeProvisioningExtrasInput` | Sanitises and normalises provisioning extras input (locale, timezone, Wi-Fi config, enrollment flags) |
| `getEnvironmentContext` | Fetches environment + workspace context (enterprise_name, gcp_project_id) via JOIN |
| `createEnrollmentTokenForZeroTouch` | Creates an AMAPI enrollment token, stores it locally, applies provisioning extras, audit logs |

## Key Logic

### GET (read zero-touch options)

1. Requires `environment_id` query param.
2. RBAC: environment `read` permission.
3. Returns `{ environment, groups, active_tokens }` — environment metadata, available groups, and reusable enrollment tokens with a stored AMAPI value and known future expiry. Legacy null-expiry and one-time tokens are excluded because they are unsuitable for persistent zero-touch profiles.

### POST actions

All POST actions require `environment_id`, `action`, and RBAC `environment:manage_settings` permission. The environment must be bound to an enterprise with a GCP project configured.

#### `create_iframe_token`

Requires an active `token_id`, creates an AMAPI web token with `ZERO_TOUCH_CUSTOMER_MANAGEMENT` enabled, and returns `{ iframe_token, iframe_url }`. The iframe URL includes the selected enrollment token inside URL-encoded, Google-documented Android Device Policy `dpcExtras`.

#### `create_enrollment_token_for_zt`

Creates a reusable, effectively long-lived enrollment token via AMAPI for zero-touch binding. It explicitly requests Google's maximum supported duration and persists the exact `expirationTimestamp` returned by AMAPI. Optional group assignment, personal usage, and provisioning extras remain supported; `one_time_use` is always false.

#### `build_zt_dpc_extras`

Resolves an active existing token or creates a new one, then returns the documented Android Device Policy component, signature checksum, and `PROVISIONING_ADMIN_EXTRAS_BUNDLE` containing the enrollment token.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/environments/zero-touch` | Session / API key (environment read) | Get zero-touch options (groups, tokens) |
| `POST` | `/api/environments/zero-touch` | Session (environment:manage_settings) | Execute zero-touch actions (iframe token, enrollment token) |
