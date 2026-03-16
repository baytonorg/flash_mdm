# `netlify/functions/license-settings.ts`

> Reads and updates per-workspace licensing settings including free tier, billing method, and grace period configuration.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| (none) | | All logic is inline within the handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `queryOne` | `_lib/db` | Database operations |
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireEnvironmentPermission`, `requireWorkspaceResourcePermission`, `requireWorkspaceRole` | `_lib/rbac` | Permission and role checks |
| `getSearchParams`, `jsonResponse`, `errorResponse`, `parseJsonBody`, `isValidUuid`, `getClientIp` | `_lib/helpers` | Request/response utilities |
| `getWorkspaceLicensingSettings` | `_lib/licensing` | Resolve effective licensing settings |
| `logAudit` | `_lib/audit` | Audit trail logging |

## Key Logic

### GET (read settings)
1. Resolves `workspace_id` from query params or auth context.
2. Falls back to environment-level read permission if workspace-level fails.
3. Returns the resolved licensing settings (platform + workspace merged).

### PUT (update settings)
1. API keys are forbidden.
2. Requires `admin` role on the workspace.
3. Reads existing `workspace_licensing_settings` row with progressive column fallbacks (handles schema migrations gracefully by catching `42703` undefined-column errors and retrying with fewer columns).
4. Merges incoming fields with existing values, using defaults:
   - `billing_method`: `'stripe'`
   - `grace_day_block`: 10, `grace_day_disable`: 30, `grace_day_wipe`: 45
5. Validates `free_seat_limit` (0-1,000,000) and grace day ordering (`block < disable < wipe`).
6. Upserts into `workspace_licensing_settings` with `ON CONFLICT (workspace_id) DO UPDATE`.
7. Re-fetches the effective settings and logs an audit event with the full resolved state.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/license-settings` | Session / API key | Get licensing settings for a workspace |
| `PUT` | `/.netlify/functions/license-settings` | Session (workspace admin) | Update licensing settings for a workspace |
