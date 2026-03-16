# `netlify/functions/enrollment-list.ts`

> Lists enrollment tokens for a given environment, joining group and resolved policy metadata, with optional inclusion of expired tokens.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query` | `_lib/db.js` | Query enrollment tokens with joins |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Enforce `read` permission on the environment |
| `jsonResponse`, `errorResponse`, `getSearchParams` | `_lib/helpers.js` | HTTP response utilities and query param parsing |

## Key Logic

1. Requires `GET` method; reads `environment_id` and optional `include_expired=true` from query parameters.
2. Enforces `read` permission on the specified environment.
3. Executes a single query that joins `enrollment_tokens` with:
   - `groups` for group name
   - A lateral subquery walking `group_closures` + `policy_assignments` to resolve the nearest group-level policy
   - A lateral subquery for environment-level policy assignment as fallback
   - `policies` to get the resolved policy name (using `COALESCE` across group, environment, and stored policy_id)
4. Filters out expired tokens by default (unless `include_expired` is true).
5. Maps results to a frontend-friendly shape including `group_name`, `policy_name`, and all token fields.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/enrollment-list?environment_id=...&include_expired=true` | Authenticated user with `read` permission | List enrollment tokens for an environment |
