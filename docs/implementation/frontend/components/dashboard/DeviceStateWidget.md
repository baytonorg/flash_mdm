# `src/components/dashboard/DeviceStateWidget.tsx`

> Horizontal bar chart widget showing device counts grouped by management state (Active, Disabled, Deleted, Provisioning).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceStateWidget` | `default function` | Renders the device state bar chart |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `data` | `Record<string, number>` | Yes | Map of state names to device counts |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatLabel` | 24-29 | Converts UPPER_SNAKE_CASE state names to Title Case |

## Key Logic

The widget renders a horizontal Chart.js Bar chart with state-specific colors (green for ACTIVE, gray for DISABLED, red for DELETED, blue for PROVISIONING) and falls back to indigo for unknown states. The chart height scales dynamically based on the number of state entries (minimum 120px, 40px per entry). Legend is hidden. An empty state message is shown when no data is available.
