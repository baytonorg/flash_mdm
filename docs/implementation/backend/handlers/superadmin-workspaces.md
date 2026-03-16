# `netlify/functions/superadmin-workspaces.ts`

> Superadmin workspace listing and detail view, including environments, users, license info, and support/impersonation session history.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getWorkspaceDetail` | 101-223 | Returns detailed workspace info: environments, users, license, active/historical support impersonation sessions, and support audit trail |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireSuperadmin` | `_lib/auth` | Superadmin authentication gate |
| `query`, `queryOne` | `_lib/db` | Database queries |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers` | Response utilities |

## Key Logic

GET-only endpoint with two modes determined by URL path:

**List mode** (no ID in path): Paginated workspace listing (`page`, `per_page` up to 100, `search` by name). Each workspace includes aggregated device count (via environments), user count, latest license plan name, and license status. Uses `LEFT JOIN LATERAL` for the most recent license.

**Detail mode** (ID in path): Returns a rich object containing:
- Workspace metadata (including `disabled` flag, with schema fallback)
- All environments with enterprise names
- All workspace members with roles
- Latest license with plan details, Stripe subscription ID, and period end
- Last 20 support impersonation sessions (with active/expired status computed from `expires_at`)
- Last 20 superadmin impersonation audit log entries

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/superadmin-workspaces` | Superadmin | List workspaces with pagination and search |
| `GET` | `/.netlify/functions/superadmin-workspaces/:id` | Superadmin | Get detailed workspace info including environments, users, license, and support history |
