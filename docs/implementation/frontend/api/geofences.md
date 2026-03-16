# `src/api/queries/geofences.ts`

> React Query hooks for creating, updating, deleting, and toggling geofences with circle or polygon boundaries and enter/exit actions.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Geofence` | `interface` | Geofence record: center point, radius, optional polygon, scope, enter/exit actions, enabled flag |
| `DeviceGeofenceState` | `interface` | Per-device state for a geofence (inside/outside, last checked) |
| `CreateGeofenceParams` | `interface` | Parameters for creating a geofence |
| `UpdateGeofenceParams` | `interface` | Parameters for updating a geofence |
| `geofenceKeys` | `object` | Query key factory: `all`, `list(envId)`, `detail(id)` |
| `useGeofences` | `(environmentId: string) => UseQueryResult<{geofences}>` | Lists geofences for an environment |
| `useGeofence` | `(id: string) => UseQueryResult<{geofence, device_states}>` | Fetches geofence detail with per-device states |
| `useCreateGeofence` | `() => UseMutationResult` | Creates a geofence; invalidates environment list |
| `useUpdateGeofence` | `() => UseMutationResult` | Updates a geofence; invalidates detail and all lists |
| `useDeleteGeofence` | `() => UseMutationResult` | Deletes a geofence; invalidates all queries |
| `useToggleGeofence` | `() => UseMutationResult` | Toggles a geofence enabled/disabled |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Geofences support both circle (lat/lng + radius_meters) and polygon boundaries.
- Scoping is flexible: `environment`, `group`, or `device` level.
- `action_on_enter` and `action_on_exit` are open JSON objects defining what happens when a device crosses the boundary.
- The detail endpoint returns `device_states` showing which devices are currently inside/outside the geofence.
