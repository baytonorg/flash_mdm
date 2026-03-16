# `netlify/functions/license-status.ts`

> Returns a comprehensive licensing status snapshot for a workspace or environment, including plan details, device counts, entitlement totals, and per-environment breakdowns.

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
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `queryOne` | `_lib/db` | Database lookups |
| `requireEnvironmentPermission`, `requireWorkspaceResourcePermission` | `_lib/rbac` | Permission checks |
| `jsonResponse`, `errorResponse`, `getSearchParams`, `isValidUuid` | `_lib/helpers` | Request/response utilities |
| `getEnvironmentLicensingSnapshot`, `getWorkspaceEnvironmentLicensingSnapshots`, `getWorkspaceLicensingSettings`, `getWorkspacePlatformEntitledSeats` | `_lib/licensing` | Licensing state, snapshots, and entitlement calculations |

## Key Logic

1. Only accepts `GET` requests.
2. Accepts optional `environment_id` or `workspace_id` query params.
   - If `environment_id` is provided, resolves its workspace and scopes the snapshot to that environment.
   - Otherwise, resolves workspace from params or auth context with fallback to environment-level read permission.
3. Fetches the most recent active licence joined with its plan.
4. Counts non-deleted devices in qualifying states (`ACTIVE`, `DISABLED`, `PROVISIONING`).
5. Checks `STRIPE_SECRET_KEY` presence to report `stripe_enabled`.
6. When licensing is enabled, resolves:
   - `platform_entitled_seats` via grant aggregation.
   - Per-environment licensing snapshots.
   - `platform_overage_count` as `max(0, device_count - entitled_seats)`.
7. If no licence exists, falls back to the Free plan with the workspace's effective free seat limit.
8. Returns a unified response with licence, plan, device count, limits, usage percentage, entitlements, environment snapshots, and workspace licensing settings.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/license-status` | Session / API key | Get licensing status for a workspace or environment |
