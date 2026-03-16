# `netlify/functions/signup-link-crud.ts`

> Full CRUD handler for signup links (invite links) scoped to workspaces or environments, with slug validation, domain restrictions, role/access defaults, and token generation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `validateDomainList` | 14-21 | Validates each domain in a list against `DOMAIN_REGEX`; returns the first invalid domain or null |
| `normalizePurpose` | 23-29 | Normalizes a purpose string to `'standard'` or `'customer'`; defaults to `'standard'` |
| `parseSignupLinkPathSegments` | 31-38 | Safely extracts path segments after `/api/signup-links`, handling trailing slashes and the base path without a trailing segment |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireWorkspaceResourcePermission`, `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Enforce scope-appropriate permissions (`invite:read/write/delete` or `environment:manage_users`) |
| `generateToken`, `hashToken` | `_lib/crypto.js` | Generate and hash signup link tokens |
| `logAudit` | `_lib/audit.js` | Audit logging for all signup link mutations |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP utilities |

## Key Logic

**Path handling**: URL path segments are parsed via `parseSignupLinkPathSegments()`, which safely handles the base path (`/api/signup-links`), trailing slashes, and nested segments. PATCH and DELETE routes validate that the link ID segment is a valid UUID before proceeding.

**Slug validation**: Slugs must be 3-100 characters, lowercase alphanumeric with hyphens, starting with a letter or number. Uniqueness is enforced across all signup links.

**GET**: Returns the signup link for a given `scope_type` + `scope_id` pair. Auth varies by scope type (workspace `invite:read` vs environment `manage_users`).

**POST** (create/regenerate):
- Validates scope type (`workspace` or `environment`), slug uniqueness, role (`viewer`/`member`/`admin`), and access scope (`workspace`/`scoped`).
- Environment-scoped links force `default_access_scope = 'scoped'`.
- Scoped workspace links without environment creation require at least one auto-assign environment.
- Generates a new cryptographic token, hashes it, and upserts into `signup_links`.
- Returns both the link metadata and the raw token (only time the raw token is exposed).

**PATCH** (`/api/signup-links/:id`):
- Partial update with field-by-field validation. Supports updating slug, enabled, role, access scope, auto-assign lists, allowed domains, environment creation flag, and display fields.
- Re-validates slug uniqueness excluding the current link.

**DELETE** (`/api/signup-links/:id`):
- Looks up the link, checks scope-appropriate permissions, deletes the row.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/signup-links?scope_type=...&scope_id=...` | `invite:read` or `manage_users` | Get the signup link for a scope |
| `POST` | `/api/signup-links` | `invite:write` or `manage_users` | Create or regenerate a signup link |
| `PATCH` | `/api/signup-links/:id` | `invite:write` or `manage_users` | Update a signup link |
| `DELETE` | `/api/signup-links/:id` | `invite:delete` or `manage_users` | Delete a signup link |
