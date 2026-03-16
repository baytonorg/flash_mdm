# `netlify/functions/device-list.ts`

> Lists devices for an environment with pagination, search, filtering, sorting, and group-scoped RBAC.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isResponseLike` | 138-144 | Type guard that checks if a caught error is a Response object (duck-typed for broader compatibility) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne` | `_lib/db.js` | Database reads |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentAccessScopeForResourcePermission` | `_lib/rbac.js` | Environment-level RBAC with group-scoped access narrowing |
| `jsonResponse`, `errorResponse`, `getSearchParams`, `isValidUuid` | `_lib/helpers.js` | HTTP response helpers, query param extraction, UUID validation |

## Key Logic

1. Requires `environment_id` query parameter. Calls `requireEnvironmentAccessScopeForResourcePermission` which returns an access scope that may restrict visibility to specific groups.
2. Supports the following query parameters:
   - `page` (default 1), `per_page` (default 50, max 200) for pagination
   - `search` -- ILIKE match against name, serial number, model, manufacturer, and IMEI
   - `state` -- exact match filter on device state
   - `ownership` -- exact match filter on ownership type
   - `group_id` -- filters to devices in the given group and all its descendants (via `group_closures`)
   - `sort_by` -- one of: `serial_number`, `manufacturer`, `model`, `os_version`, `state`, `ownership`, `last_status_report_at`, `updated_at`, `enrollment_time`
   - `sort_dir` -- `asc` or `desc` (default `desc`)
3. When the user has group-scoped access (not full environment access), the query is automatically filtered to only their accessible group IDs.
4. Resolves the effective policy for each device using lateral joins through the policy assignment hierarchy: device-level -> group-level (via `group_closures`) -> environment-level -> legacy `devices.policy_id`.
5. Returns a `devices` array and a `pagination` object with `page`, `per_page`, `total`, and `total_pages`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/device-list` | Session/API key | List devices for an environment with filtering and pagination |
