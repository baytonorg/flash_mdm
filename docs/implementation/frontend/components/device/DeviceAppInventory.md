# `src/components/device/DeviceAppInventory.tsx`

> Searchable table displaying all applications installed on a device with icon, package name, version, and state.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceAppInventory` | `default function` | Renders the filterable app inventory table |
| `DeviceAppInventoryProps` | `interface` | Props type for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `applications` | `Application[]` | Yes | Array of application objects to display |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `AppIcon` | 18-34 | Renders an app icon image with fallback to a Package icon placeholder |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `StatusBadge` | `@/components/common/StatusBadge` | Rendering the app state as a colored badge |

## Key Logic

The component provides a text search input that filters the applications list by display name or package name using `useMemo`. The filtered results are rendered in a table with columns for app name (with icon), package name, version, and state. An empty state distinguishes between "no applications reported" (zero total) and "no matching applications" (search returned nothing). A count footer shows filtered vs. total applications.
