# `src/components/dashboard/RecentEventsWidget.tsx`

> Scrollable list widget displaying up to 10 recent audit events with action names, resource types, and relative timestamps.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `RecentEventsWidget` | `default function` | Renders the recent events list |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `events` | `RecentEvent[]` | Yes | Array of recent audit event objects |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `relativeTime` | 14-28 | Converts an ISO date string to a human-readable relative time |
| `formatAction` | 30-35 | Converts snake_case action strings to Title Case |
| `formatResourceType` | 37-42 | Converts snake_case resource type strings to Title Case |

## Key Logic

The widget displays the first 10 events from the provided array in a scrollable container (max height 320px). Each event is rendered as a row with an Activity icon, the formatted action name, and a secondary line showing the resource type and relative timestamp separated by a middle dot. The widget spans 2 grid columns at the `xl` breakpoint. An empty state message is shown when there are no events.
