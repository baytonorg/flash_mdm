# `src/components/dashboard/OemBreakdownWidget.tsx`

> Doughnut chart widget showing the distribution of devices by manufacturer (OEM).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `OemBreakdownWidget` | `default function` | Renders the OEM breakdown doughnut chart |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `data` | `Record<string, number>` | Yes | Map of manufacturer names to device counts |

## Key Logic

The widget renders a Chart.js Doughnut chart with a 60% cutout and a right-positioned legend. Up to 10 distinct colors are cycled through for the segments. The chart spans 2 grid columns at the `xl` breakpoint. An empty state message is shown when no data is available. Hover offset is set to 4px for visual feedback.
