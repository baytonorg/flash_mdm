# `netlify/functions/geofence-check-scheduled.ts`

> Scheduled function (every 10 minutes) that evaluates all enabled geofences against device locations, detects enter/exit state changes, and enqueues configured actions (lock, notification, group move, webhook).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<void>` | Netlify function handler |
| `config` | `{ schedule: '*/10 * * * *' }` | Netlify scheduled function config -- runs every 10 minutes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isDeviceInScope` | 41-53 | Checks if a device matches the geofence's scope (`environment` = all, `group` = matching group_id, `device` = matching device_id) |
| `isDeviceInsideFence` | 58-71 | Determines if a device is inside a geofence, preferring polygon check (if >= 3 points) and falling back to circle/radius check |
| `executeGeofenceAction` | 76-173 | Executes the configured action for a geofence event by enqueuing jobs or updating device state directly. Supports: `lock` (enqueues device command), `notification` (enqueues notification command), `move_group` (direct DB update with scope validation), `webhook` (enqueues webhook job with SSRF validation) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database queries, upserts, and job queue inserts |
| `logAudit` | `_lib/audit.js` | Audit logging for geofence state change events |
| `isInsideCircle`, `isInsidePolygon` | `_lib/haversine.js` | Geospatial calculations for circle and polygon containment |
| `validateWebhookUrlForOutbound` | `_lib/webhook-ssrf.js` | SSRF protection for outbound webhook URLs |

## Key Logic

1. **No auth required** -- Netlify scheduled function.
2. Finds all distinct environments that have at least one enabled geofence.
3. For each environment:
   - Loads all enabled geofences (with coordinates, polygon, scope, and action configs).
   - Loads all `ACTIVE` devices with location data (prefers `device_locations` table, falls back to `snapshot.location`).
4. For each geofence-device pair:
   - Checks scope membership via `isDeviceInScope`.
   - Determines containment via `isDeviceInsideFence` (polygon if defined, otherwise haversine circle).
   - Upserts `device_geofence_state` with current inside/outside status.
   - On state change (enter or exit):
     - Logs an audit event with coordinates.
     - Executes the configured action (`action_on_enter` or `action_on_exit`).
5. Action types: `lock` and `notification` enqueue device commands to `job_queue`; `move_group` directly updates the device's group (with environment validation); `webhook` enqueues a webhook job with SSRF-validated URL.
6. Logs completion stats: environments, geofences, and devices checked; state changes; errors.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| N/A | `/.netlify/functions/geofence-check-scheduled` | None (scheduled) | Cron-triggered geofence evaluation |
