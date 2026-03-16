# `src/components/device/DeviceLocationHistory.tsx`

> Table displaying a device's location history records with coordinates, accuracy, and timestamps.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceLocationHistory` | `default function` | Renders the location history table |
| `DeviceLocationHistoryProps` | `interface` | Props type for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `locations` | `LocationRecord[]` | Yes | Array of location records with lat, lon, accuracy, and timestamp |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatDate` | 14-23 | Formats an ISO date string to a locale-aware absolute date/time |
| `formatRelativeTime` | 25-37 | Converts an ISO date string to human-readable relative time |

## Key Logic

The component renders a simple data table with columns for latitude, longitude, accuracy (in meters), and recorded time (showing both relative and absolute). Coordinates are displayed to 6 decimal places, accuracy to 1 decimal place. An empty state with a MapPin icon is shown when no locations are available. A note indicates that Google Maps integration is planned for Phase 4. A footer shows the total count of location records.
