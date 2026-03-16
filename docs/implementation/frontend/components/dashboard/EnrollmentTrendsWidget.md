# `src/components/dashboard/EnrollmentTrendsWidget.tsx`

> Area line chart widget showing device enrolment trends over the last 30 days.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnrollmentTrendsWidget` | `default function` | Renders the enrolment trends line chart |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `data` | `Array<{ date: string; count: number }>` | Yes | Time series of daily enrolment counts |

## Key Logic

The widget renders a Chart.js Line chart with a filled area under the curve (blue with 10% opacity fill). Dates are formatted to short month/day labels on the x-axis. The chart spans the full width of a 2-column grid cell (`xl:col-span-2`). Configuration includes smooth tension (0.3), small point radii, and a maximum of 8 x-axis tick labels. Legend is hidden; the title "Enrolment Trends (30 days)" serves as the label.
