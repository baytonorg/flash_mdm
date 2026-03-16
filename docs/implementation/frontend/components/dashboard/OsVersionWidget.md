# `src/components/dashboard/OsVersionWidget.tsx`

> Horizontal bar chart widget showing the distribution of devices by Android OS version, sorted descending.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `OsVersionWidget` | `default function` | Renders the OS version distribution bar chart |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `data` | `Record<string, number>` | Yes | Map of OS version strings to device counts |

## Key Logic

The widget sorts OS versions in descending order (numeric comparison when possible, lexicographic fallback) and prepends "Android " to each label. It renders a horizontal Chart.js Bar chart with blue bars. The chart height scales dynamically based on the number of versions (minimum 160px, 36px per version). The widget spans 2 grid columns at the `xl` breakpoint. An empty state message is shown when no data is available.
