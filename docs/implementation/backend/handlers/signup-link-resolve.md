# `netlify/functions/signup-link-resolve.ts`

> Public-facing endpoint that resolves a signup link by slug or token, returning display metadata and scope information for the signup page.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.js` | Database lookups |
| `hashToken` | `_lib/crypto.js` | Hash the token for lookup when slug match fails |
| `consumeToken` | `_lib/rate-limiter.js` | Rate limiting (30 req/min per IP) |
| `jsonResponse`, `errorResponse`, `getClientIp` | `_lib/helpers.js` | HTTP utilities |

## Key Logic

1. **Rate limiting**: 30 requests per minute per IP via token bucket (`consumeToken`).
2. Extracts the slug-or-token from the URL path: `/api/signup-links/resolve/{slugOrToken}`.
3. **Resolution strategy**:
   - First tries a slug lookup (`WHERE slug = $1 AND enabled = true`).
   - If not found, hashes the input and tries a token hash lookup (`WHERE token_hash = $1 AND enabled = true`).
4. If found, resolves human-readable scope names:
   - Workspace-scoped: looks up `workspaces.name`.
   - Environment-scoped: looks up `environments.name` and the parent `workspaces.name`.
5. Returns only public-safe metadata: `scope_type`, `display_name`, `display_description`, `workspace_name`, `environment_name`, `default_role`, `allow_environment_creation`, and `allowed_domains`. Does **not** return the link ID, token, or scope_id.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/signup-links/resolve/:slugOrToken` | None (public, rate-limited) | Resolve a signup link and return display metadata |
