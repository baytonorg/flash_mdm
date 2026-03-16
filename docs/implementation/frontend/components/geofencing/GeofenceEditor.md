# `src/components/geofencing/GeofenceEditor.tsx`

> Full-screen modal form for creating or editing a geofence, including map preview, scope selection, and enter/exit action configuration.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `GeofenceEditor` | `default function` | Modal dialog with a two-column layout: form fields on the left, map on the right |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `geofence` | `Geofence \| null` | No | Existing geofence to edit; `null`/`undefined` for create mode |
| `environmentId` | `string` | Yes | Environment ID used when creating a new geofence |
| `onSave` | `(data: CreateGeofenceParams \| UpdateGeofenceParams) => void` | Yes | Callback with serialized form data |
| `onClose` | `() => void` | Yes | Callback to close the editor modal |
| `isSaving` | `boolean` | No | Disables the submit button while saving (default `false`) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseAction` | 34-46 | Deserializes a raw action object into a typed `ActionConfig` |
| `serializeAction` | 48-61 | Converts an `ActionConfig` back to a plain object for API submission |
| `ActionEditor` | 63-137 | Sub-component rendering action type selector and type-specific config (notification, move_group, webhook) |
| `handleMapClick` | 179-182 | Updates latitude/longitude from a map click event |
| `handleSubmit` | 184-216 | Prevents default, builds create or update params, calls `onSave` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `FenceScopeSelector` | `./FenceScopeSelector` | Scope selection sub-component |
| `GeofenceMap` | `./GeofenceMap` | Map preview with click-to-set-coordinates |
| `Geofence`, `CreateGeofenceParams`, `UpdateGeofenceParams` | `@/api/queries/geofences` | Type definitions |

## Key Logic

The editor is a fixed full-screen modal (`z-50`) with a two-column grid on large screens. The left column contains form fields: name, latitude/longitude (settable by clicking the map), a radius slider (50--50,000 meters) with numeric input, scope via `FenceScopeSelector`, enter/exit actions via `ActionEditor`, and an enabled toggle. The right column renders a `GeofenceMap` with a preview circle. A `useEffect` syncs all form state when the `geofence` prop changes. The `ActionEditor` supports four action types beyond "none": lock, notification (title + message), move_group (target group ID), and webhook (URL + HTTP method).
