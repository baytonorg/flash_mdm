# `src/components/workflows/ActionSelector.tsx`

> Grid-based selector for choosing a workflow action type with inline configuration panels for each action.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ActionSelector` | `default function` | Action type picker with contextual config forms |
| `ActionValue` | `interface` | Shape: `{ action_type: string; action_config: Record<string, unknown> }` |
| `ACTION_OPTIONS` | `const array` | Definitions for the six available action types with labels, icons, and colours |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `ActionValue` | Yes | Currently selected action type and its configuration |
| `onChange` | `(value: ActionValue) => void` | Yes | Callback when action type or config changes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleTypeChange` | 91-93 | Resets `action_config` to `{}` when switching action type |
| `handleConfigChange` | 95-100 | Merges a single key/value into the current `action_config` |

## Dependencies (imports from project)

None (only external: `lucide-react`, `clsx`).

## Key Logic

Renders a 2-column grid of action cards. Six action types are supported:

- **device.command** -- dropdown for AMAPI command type (LOCK, RESET_PASSWORD, REBOOT, WIPE, etc.), plus conditional sub-fields for password reset and eSIM wipe flags.
- **device.move_group** -- text input for target group UUID.
- **device.assign_policy** -- text input for target policy UUID.
- **notification.email** -- fields for recipient email, subject, and custom message template.
- **notification.webhook** -- URL input plus optional secret header field.
- **audit.log** -- text input for a custom action name.

The selected action is highlighted with an accent ring. A summary line at the bottom shows the selected action icon and label.
