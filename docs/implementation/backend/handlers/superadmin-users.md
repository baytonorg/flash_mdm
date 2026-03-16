# `netlify/functions/superadmin-users.ts`

> Superadmin user listing with search, pagination, and nested workspace membership details including access scopes and group counts.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireSuperadmin` | `_lib/auth` | Superadmin authentication gate |
| `query`, `queryOne` | `_lib/db` | Database queries |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers` | Response utilities and query parameter parsing |

## Key Logic

GET-only endpoint. Supports pagination (`page`, `per_page` up to 100) and case-insensitive `search` across email, first name, and last name.

The main query uses correlated subqueries to embed each user's workspace memberships as a JSON array, including:
- Workspace id, name, and role
- `access_scope` (workspace or scoped)
- Per-workspace `environment_count` and `group_count` for the user

Results are sorted with superadmins first, then alphabetically by email.

**Schema compatibility:** Falls back to a simplified query if the `access_scope` column does not exist on `workspace_memberships` (pre-migration schema).

Response shape: `{ users, total, page, per_page }`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/superadmin-users` | Superadmin | List all users with workspace membership details |
