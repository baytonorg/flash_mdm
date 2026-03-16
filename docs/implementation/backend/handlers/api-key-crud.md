# `netlify/functions/api-key-crud.ts`

> CRUD operations for API keys: list, create, and revoke keys scoped to workspaces or environments with role-based access control.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `normalizeName` | 41-44 | Trims and truncates API key name to 120 characters |
| `resolveEnvironmentScope` | 46-51 | Looks up an environment and returns its workspace_id |
| `serializeKeyRow` | 53-56 | Strips the token secret from list responses (secrets only returned at creation) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db` | Database operations |
| `requireAuth` | `_lib/auth` | Authentication (session or API key) |
| `requireEnvironmentResourcePermission`, `requireWorkspacePermission`, `requireWorkspaceResourcePermission` | `_lib/rbac` | Permission checks |
| `encrypt`, `generateToken`, `hashToken` | `_lib/crypto` | Token generation, hashing, and encryption |
| `logAudit` | `_lib/audit` | Audit logging |
| `errorResponse`, `getClientIp`, `getSearchParams`, `isValidUuid`, `jsonResponse`, `parseJsonBody` | `_lib/helpers` | Request/response utilities |

## Key Logic

**Self-management restriction:** API keys cannot manage other API keys (POST requests from API key auth return 403).

**List (GET /list):** Requires either `workspace_id` or `environment_id`. For environment-scoped listing, requires `environment:write` permission. For workspace-scoped listing, requires workspace `write` permission. Returns metadata and token prefix only (never the full secret).

**Create (POST /create):** Accepts `scope_type` (workspace or environment), `name`, `role`, and optional `expires_in_days` (1-3650). If `role` is omitted, it defaults to the creator's own role. If the requested role is higher than the creator's role, the request is rejected with 403 Forbidden (the role is **not** silently capped). Generates a token prefixed with `flash_workspace_` or `flash_environment_`, stores a hash and encrypted copy in `api_keys`, and returns the full plaintext token only once. The frontend role picker in Settings.tsx constrains available roles to those at or below the caller's effective role.

**Revoke (POST /revoke):** Sets `revoked_at` and `revoked_by_user_id`. Requires `manage_settings` permission on the key's scope. Already-revoked keys return a success message without error.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/api-key-crud/list` | Session or API key | List API keys for a workspace or environment |
| `POST` | `/.netlify/functions/api-key-crud/create` | Session only | Create a new API key |
| `POST` | `/.netlify/functions/api-key-crud/revoke` | Session only | Revoke an existing API key |
