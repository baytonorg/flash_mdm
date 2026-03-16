# `netlify/functions/app-details.ts`

> Fetches detailed application metadata from the Google AMAPI for a given package name and environment.

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
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers.js` | HTTP response builders and query param extraction |

## Key Logic

The handler serves as a proxy to the Google AMAPI `applications.get` endpoint:

1. Extracts the `package_name` from the last URL path segment and `environment_id` from query params.
2. Looks up the environment's `enterprise_name` and `workspace_id`, then the workspace's `gcp_project_id`. Returns 400 if either is not configured.
3. Calls `amapiCall` against `{enterprise}/applications/{packageName}?languageCode=en` to retrieve full app metadata.
4. Returns a normalized response with `package_name`, `title`, `description`, `icon_url`, `permissions`, `managed_properties`, `app_tracks`, `min_android_sdk`, and `update_time`.

On AMAPI errors, the handler returns the upstream HTTP status or falls back to 502.

This handler is also called internally by `app-crud.ts` when a non-UUID path segment (interpreted as a package name) is accessed via GET.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /api/apps/:packageName?environment_id= | Session (read) | Get detailed app metadata from Google AMAPI |
