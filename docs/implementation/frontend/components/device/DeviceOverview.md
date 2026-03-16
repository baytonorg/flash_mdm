# `src/components/device/DeviceOverview.tsx`

> Overview dashboard for a single device showing identity, management status, activity timeline, enrolment details, and a summary of installed apps.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceOverview` | `default function` | Renders the device overview grid |
| `DeviceOverviewProps` | `interface` | Props type for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `device` | `Device` | Yes | Device object with identity, state, and management fields |
| `applications` | `AppSummary[]` | No | Optional list of installed apps (defaults to empty array) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatRelativeTime` | 33-46 | Converts a nullable ISO date string to relative time or "Never" |
| `formatDate` | 48-57 | Formats a nullable ISO date string to a locale-aware date/time or "Unknown" |
| `InfoItem` | 59-66 | Renders a vertical label-value pair |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `StatusBadge` | `@/components/common/StatusBadge` | Rendering state, ownership, and compliance badges |

## Key Logic

The component renders a responsive two-column grid with four card sections: Device Identity (serial, IMEI, manufacturer, model, OS, security patch), Management Status (state, ownership, group, management mode, compliance), Activity (last seen and enrolment times with both relative and absolute display), and Enrolment Details. A fifth full-width card conditionally appears showing the first 20 installed applications as icon+name chips, with a "+N more" overflow indicator.
