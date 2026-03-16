# `netlify/functions/environment-renew.ts`

> Renews an environment's Android Enterprise signup URL by creating a fresh AMAPI signup URL, allowing the admin to re-complete the enterprise bind callback.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (named `handler`) | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Interfaces

| Name | Lines | Description |
|------|-------|-------------|
| `RenewBody` | 9-11 | Request body shape: `{ environment_id: string }` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database access |
| `requireAuth` | `_lib/auth.js` | Authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | RBAC enforcement (`manage_settings`) |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Calling the Android Management API |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |

## Key Logic

1. Validates that the environment exists and is bound to an enterprise.
2. Fetches the workspace's `gcp_project_id`.
3. Calls AMAPI `signupUrls.create` with the same callback URL pattern used during initial binding (`/settings/enterprise/callback?environment_id=...`), passing the existing `enterpriseName` for context.
4. Persists the new `signup_url_name` on the environment record so the bind step-2 callback can complete.
5. Returns the new signup URL to the caller.

This is useful when a previously generated signup URL has expired or needs to be regenerated without going through a full unbind/rebind cycle.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/environment-renew` | Session / API key | Renew the enterprise signup URL for an environment |
