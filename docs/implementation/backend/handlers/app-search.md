# `netlify/functions/app-search.ts`

> Searches for apps via AMAPI exact package name lookup, or signals that a managed Play iframe web token is required for free-text search.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `looksLikePackageName` | 14-16 | Regex check to determine if a query string matches Android package name format (e.g. `com.example.app`) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.js` | Database queries for environment and workspace lookup |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Google AMAPI HTTP calls and error status extraction |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers.js` | HTTP response builders and query param extraction |

## Key Logic

Since AMAPI does not provide a server-side application search/list endpoint, this handler implements a two-mode strategy:

1. **Exact package lookup** (`search_mode: "exact_package_lookup"`): If the query string matches the Android package name pattern (e.g. `com.google.chrome`), the handler calls `applications.get` on AMAPI. Returns a single-item array with `package_name`, `title`, and `icon_url`, or an empty array if the app is not found (404 from AMAPI).

2. **Web token required** (`search_mode: "web_token_required"`): If the query is free-text (not a package name), returns an empty array with a message directing the UI to use the managed Google Play iframe web token flow instead.

The handler requires both `environment_id` and `query` as query parameters.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /.netlify/functions/app-search?environment_id=&query= | Session (read) | Search for an app by exact package name or signal web token requirement |
