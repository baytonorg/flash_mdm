# `src/components/device/DeviceAuditLog.tsx`

> Timeline-style display of audit log entries for a device, showing actions, resource types, timestamps, and JSON details.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceAuditLog` | `default function` | Renders the audit log timeline |
| `DeviceAuditLogProps` | `interface` | Props type for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `entries` | `AuditEntry[]` | Yes | Array of audit log entries to display |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatRelativeTime` | 14-26 | Converts an ISO date string to a human-readable relative time (e.g., "5m ago", "2d ago") |
| `formatDate` | 28-36 | Formats an ISO date string to a locale-aware absolute date/time string |
| `formatAction` | 38-43 | Converts snake_case action strings to Title Case |

## Key Logic

The component renders a vertical timeline with connected dots and lines. Each entry shows the formatted action name, resource type, relative and absolute timestamps, and optionally a collapsible JSON detail block. If the details field is a string it is shown as-is; if it is an object it is pretty-printed with `JSON.stringify`. An empty state placeholder is shown when there are no entries.
