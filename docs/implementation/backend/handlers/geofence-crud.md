# `netlify/functions/geofence-crud.ts`

> Full CRUD handler for geofences including list (with device-inside counts), get (with per-device state), create, update, delete, and toggle enable/disable.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `validateGeofenceScopeForEnvironment` | 61-87 | Validates that `scope_type` is valid and that `scope_id` exists in the target environment (checks `groups` or `devices` table) |
| `validateGeofenceActionWebhookConfig` | 89-103 | For webhook-type actions, validates the URL is safe for outbound requests (SSRF protection) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Authenticate the caller |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Enforce resource-level geofence permissions (read/write/delete) |
| `logAudit` | `_lib/audit.js` | Audit logging for all geofence mutations |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams` | `_lib/helpers.js` | HTTP utilities |
| `validateWebhookUrlForOutbound` | `_lib/webhook-ssrf.js` | SSRF protection for webhook URLs in action configs |

## Key Logic

- **List**: Returns all geofences for an environment ordered by name, with a `devices_inside` count from `device_geofence_state`.
- **Get**: Returns a single geofence plus all `device_geofence_state` rows joined with device name and serial number.
- **Create**: Validates required fields (`environment_id`, `name`, `latitude`, `longitude`, `radius_meters`, `scope_type`), validates scope ownership, validates webhook URLs in `action_on_enter`/`action_on_exit`, then inserts. Supports optional `polygon` (array of lat/lng points).
- **Update**: Dynamic field update -- only modifies supplied fields. Re-validates scope and webhook configs against effective (merged) values.
- **Delete**: Cleans up `device_geofence_state` records before deleting the geofence.
- **Toggle**: Flips the `enabled` flag.

Geofences support three scope types: `environment` (all devices), `group` (devices in a group), and `device` (single device). Actions on enter/exit support types: `lock`, `notification`, `move_group`, `webhook`, or `none`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/geofences/list?environment_id=...` | `geofence:read` | List all geofences for an environment |
| `GET` | `/api/geofences/:id` | `geofence:read` | Get a single geofence with device states |
| `POST` | `/api/geofences/create` | `geofence:write` | Create a new geofence |
| `PUT` | `/api/geofences/update` | `geofence:write` | Update an existing geofence |
| `DELETE` | `/api/geofences/:id` | `geofence:delete` | Delete a geofence and its device state records |
| `POST` | `/api/geofences/:id/toggle` | `geofence:write` | Toggle geofence enabled/disabled |
