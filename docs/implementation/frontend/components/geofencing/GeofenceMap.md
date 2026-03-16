# `src/components/geofencing/GeofenceMap.tsx`

> Google Maps component that renders geofence circles, device markers, and an optional preview circle, with click-to-place support.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `GeofenceMap` | `default function` | Map wrapper with API key check, auto-centering, and overlay rendering |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `geofences` | `Geofence[]` | Yes | Array of geofences to render as circles |
| `selectedId` | `string \| null` | No | ID of the currently selected geofence (highlighted) |
| `onGeofenceClick` | `(id: string) => void` | No | Callback when a geofence circle is clicked |
| `onMapClick` | `(lat: number, lng: number) => void` | No | Callback when the map background is clicked |
| `devices` | `DeviceLocation[]` | No | Array of device locations to render as markers |
| `previewCircle` | `{ lat, lng, radius } \| null` | No | Amber-colored preview circle (used during editing) |
| `className` | `string` | No | Additional CSS classes for the outer container |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `GeofenceCircle` | 7-44 | Renders a `google.maps.Circle` overlay for a single geofence; color varies by enabled/selected state |
| `DeviceMarker` | 47-62 | Renders an `AdvancedMarker` with a green dot and hover tooltip |
| `MapContent` | 81-132 | Inner component that draws the preview circle and maps over geofences/devices |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `Geofence` | `@/api/queries/geofences` | Type definition for geofence data |

## Key Logic

The component reads `VITE_GOOGLE_MAPS_API_KEY` from `import.meta.env`. If missing, it renders a fallback placeholder with instructions. When present, it wraps content in `<APIProvider>` and `<Map>` from `@vis.gl/react-google-maps`. Map centering is computed via `useMemo`: it prioritises the preview circle, then the selected geofence, then the average of all geofences, defaulting to `{lat: 20, lng: 0}`. Geofence circles are drawn directly via the `google.maps.Circle` constructor inside `useMemo` (with cleanup to remove from map). Selected circles get a thicker stroke and higher fill opacity. The preview circle uses amber colouring to distinguish it from saved geofences. Device markers use `AdvancedMarker` with a green dot and a CSS-based hover tooltip.
