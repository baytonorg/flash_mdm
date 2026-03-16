# `src/pages/Geofencing.tsx`

> Geofence management page with a two-panel layout showing a data table and an interactive map.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Geofencing` | `React.FC` (default) | Geofencing page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Accessing active environment |
| `useGeofences`, `useGeofence`, `useCreateGeofence`, `useUpdateGeofence`, `useDeleteGeofence`, `useToggleGeofence` | `@/api/queries/geofences` | Geofence CRUD operations and queries |
| `Geofence`, `CreateGeofenceParams`, `UpdateGeofenceParams` | `@/api/queries/geofences` | TypeScript types |
| `DataTable`, `ColumnDef` | `@/components/common/DataTable` | Geofence list table |
| `ConfirmModal` | `@/components/common/ConfirmModal` | Delete confirmation dialog |
| `GeofenceMap` | `@/components/geofencing/GeofenceMap` | Interactive map showing geofence circles |
| `GeofenceEditor` | `@/components/geofencing/GeofenceEditor` | Modal form for creating/editing geofences |

## Key Logic

The page displays a two-panel layout on larger screens. The left panel contains a DataTable listing all geofences for the active environment with columns for name, radius (formatted in meters or kilometers), scope type, an enabled/disabled toggle, devices-inside count, and edit/delete action buttons. The right panel shows an interactive `GeofenceMap` with all geofences plotted; clicking a geofence on the map or in the table opens a detail panel below the map showing centre coordinates, radius, scope, active status, and a list of device states (inside/outside). The `GeofenceEditor` modal handles both creating new geofences and editing existing ones. Geofences can be toggled on/off inline via `useToggleGeofence`. Deletion requires confirmation through `ConfirmModal`.
