# `netlify/functions/app-list.ts`

> Lists all legacy app deployments for an environment with resolved scope names and parsed managed configs.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `safeParseJson` | 80-86 | Safely parses a JSON string, returning a typed fallback on failure |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne` | `_lib/db.js` | Database queries |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers.js` | HTTP response builders and query param extraction |

## Key Logic

The handler lists app deployments from the legacy `app_deployments` table:

1. Requires `environment_id` query parameter. Verifies the environment exists.
2. Executes a JOIN query across `app_deployments`, `environments`, `groups`, and `devices` to resolve human-readable `scope_name` values:
   - For `environment` scope: the environment name
   - For `group` scope: the group name
   - For `device` scope: serial number, AMAPI name, manufacturer+model, or device ID as fallback
3. Parses `managed_config` from JSON string if needed, defaulting to `{}`.
4. Returns results ordered by `created_at DESC`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /.netlify/functions/app-list?environment_id= | Session (read) | List all legacy app deployments for an environment |
