# `netlify/functions/signin-config.ts`

> Manages the sign-in enrollment configuration for an environment, including AMAPI `signinDetails` synchronization on the enterprise resource.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |
| `syncSigninDetailsToAmapi` | `(environmentId: string) => Promise<void>` | Syncs the local sign-in config to the AMAPI enterprise's `signinDetails` field via PATCH; stores the returned enrollment token and QR code locally |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireEnvironmentPermission`, `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Enforce read and `manage_settings` permissions |
| `amapiCall` | `_lib/amapi.js` | PATCH enterprise signinDetails on AMAPI |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp` | `_lib/helpers.js` | HTTP utilities |

## Key Logic

**`syncSigninDetailsToAmapi`** (exported helper, also used by `signin-enroll.ts`):
- Loads environment and workspace context. If enabled, builds a `signinDetails` array with the sign-in URL (`{baseUrl}/signin/enroll`), personal usage setting, and optional `tokenTag`.
- PATCHes the enterprise resource with `updateMask=signinDetails`.
- Stores the AMAPI-returned `signinEnrollmentToken` and `qrCode` locally. Clears them if sign-in is disabled.

**GET**: Returns the sign-in config for the environment, or a default disabled config if none exists.

**PUT**: Creates or updates (upsert) the sign-in configuration:
- Validates the environment is bound to an enterprise (required to enable).
- Validates `allowed_domains` are present (at least one required when enabling) and well-formed.
- Validates `default_group_id` exists in the environment if provided.
- Normalizes `allow_personal_usage` to allowed/disallowed.
- Syncs to AMAPI if enterprise is bound (non-blocking -- config is saved locally even if AMAPI sync fails).

**DELETE**: Disables the config first (syncing empty `signinDetails` to AMAPI), then deletes the local row.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/signin-config?environment_id=...` | `read` | Get sign-in enrollment configuration |
| `PUT` | `/api/signin-config` | `manage_settings` | Create or update sign-in enrollment configuration |
| `DELETE` | `/api/signin-config?environment_id=...` | `manage_settings` | Delete sign-in enrollment configuration |
