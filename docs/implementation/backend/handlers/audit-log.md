# `netlify/functions/audit-log.ts`

> Paginated audit log viewer for an environment, with filtering by visibility scope, actor type, action, resource type, user, and date range.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne` | `_lib/db` | Database queries |
| `requireAuth` | `_lib/auth` | Authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac` | Permission checks (audit:read and audit:read_privileged) |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers` | Response utilities |

## Key Logic

GET-only endpoint scoped to a single environment. Requires `environment_id` query parameter.

**Permission model:** The handler checks for `audit:read` permission, then probes for `audit:read_privileged`. If the caller lacks privileged access, only `standard` visibility entries are returned. The `include_privileged` query parameter defaults to the caller's capability but can be explicitly set.

**Filtering:** Builds a dynamic WHERE clause supporting:
- `visibility_scope` (standard or privileged)
- `actor_type` (user, system, or api_key)
- `action` (exact match)
- `resource_type` (exact match)
- `user_id` (exact match)
- `date_from` / `date_to` (timestamp range)

**Response enrichment:** JOINs with `users` and `api_keys` tables to provide `user_email`, `user_name`, `api_key_name`, a computed `actor` field (choosing the most descriptive display name), and a `target` field combining resource_type and resource_id.

**Pagination:** Supports `page` and `per_page` (max 100). Returns `{ entries, total, page, per_page, total_pages }`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/audit-log` | Session or API key | Query paginated, filtered audit log entries for an environment |
