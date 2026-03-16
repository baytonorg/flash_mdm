# `netlify/functions/app-web-token.ts`

> Creates a managed Google Play web token for embedding the Play Store iframe in the UI.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.js` | Database queries for environment and workspace lookup |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Google AMAPI HTTP calls and error status extraction |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response builders, body parsing, IP extraction |

## Key Logic

The handler creates a Google managed Play web token via AMAPI:

1. Requires `environment_id` in the POST body. Enforces write permission on the environment.
2. Looks up the environment's `enterprise_name` and the workspace's `gcp_project_id`.
3. Calls `POST {enterprise}/webTokens` on AMAPI with:
   - `parentFrameUrl` set to the deployment URL (from `process.env.URL` or `https://localhost:8888`)
   - `enabledFeatures`: `PLAY_SEARCH`, `PRIVATE_APPS`, `WEB_APPS`, `STORE_BUILDER`, `MANAGED_CONFIGURATIONS`
4. Returns the token value and a pre-built `iframeUrl` for the managed Google Play embedded search page.
5. Logs an audit entry for web token creation.

Error handling includes a specific 503 response for database compute quota exceeded errors, and a generic 500 for other unhandled errors.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/apps/web-token | Session (write) | Create a managed Google Play web token for iframe embedding |
