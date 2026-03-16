# `src/components/workflows/TriggerSelector.tsx`

> Grid-based selector for choosing a workflow trigger type with inline configuration panels for trigger-specific settings.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `TriggerSelector` | `default function` | Trigger type picker with contextual config forms |
| `TriggerValue` | `interface` | Shape: `{ trigger_type: string; trigger_config: Record<string, unknown> }` |
| `TRIGGER_OPTIONS` | `const array` | Definitions for the eight available trigger types with labels, icons, and colours |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `TriggerValue` | Yes | Currently selected trigger type and its configuration |
| `onChange` | `(value: TriggerValue) => void` | Yes | Callback when trigger type or config changes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleTypeChange` | 110-116 | Switches trigger type; sets default config (e.g., `interval_minutes: 60` for scheduled) |
| `handleConfigChange` | 118-123 | Merges a single key/value into the current `trigger_config` |

## Dependencies (imports from project)

None (only external: `lucide-react`, `clsx`).

## Key Logic

Renders a 2-column grid of trigger cards. Eight trigger types are supported:

| Trigger | Config Panel |
|---------|-------------|
| `device.enrolled` | None |
| `device.state_changed` | From/To state dropdowns (ACTIVE, DISABLED, DELETED, PROVISIONING) |
| `compliance.changed` | None |
| `app.installed` | Package name text input (optional) |
| `app.removed` | Package name text input (optional) |
| `location.fence_entered` | Geofence ID text input |
| `location.fence_exited` | Geofence ID text input |
| `scheduled` | Interval dropdown with presets (15m, 30m, 1h, 6h, 12h, 24h) |

The selected trigger is highlighted with an accent ring. A summary line at the bottom shows the selected trigger icon and label. The `INTERVAL_PRESETS` constant defines the schedule dropdown options, and `STATE_OPTIONS` provides the device state enum values.
