# `netlify/functions/app-feedback.ts`

> Read-only app feedback handler. Feedback items are synced from AMAPI device status reports (`applicationReports[].keyedAppStates[]`) and exposed for filtered retrieval.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireEnvironmentPermission` | `_lib/rbac` | Environment-scoped permission checks |
| `query`, `queryOne` | `_lib/db` | Database operations |

## Key Logic

### GET `/api/app-feedback` (list items)

1. Requires `environment_id` query param.
2. RBAC: environment `read` permission.
3. Returns `{ items }`.
4. Items support optional filters: `package_name`, `device_id` (must be valid UUID), `severity`, `status`, `limit`.
5. Includes LEFT JOIN to `devices` for `device_name`.
6. Ordered by `last_reported_at DESC`, capped at `limit` (default 100, max 500).

### GET `/api/app-feedback/:id` (single item)

1. Fetches feedback item by UUID.
2. RBAC: environment `read` permission (checked against the item's `environment_id`).
3. Returns `{ item }`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/app-feedback` | Session / API key (environment read) | List feedback items |
| `GET` | `/api/app-feedback/:id` | Session / API key (environment read) | Get single feedback item |
