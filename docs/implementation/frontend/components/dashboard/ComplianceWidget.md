# `src/components/dashboard/ComplianceWidget.tsx`

> Doughnut chart widget displaying the fleet compliance rate as a percentage with color-coded thresholds.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ComplianceWidget` | `default function` | Renders the compliance rate doughnut chart |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `rate` | `number` | Yes | Compliance percentage (0-100) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getColor` | 14-18 | Returns green (>=80%), yellow (>=50%), or red (<50%) based on rate |

## Key Logic

The widget renders a Chart.js Doughnut chart with a 78% cutout, showing the compliance rate as a filled arc and the remainder in gray. The percentage is overlaid in the center of the doughnut using absolute positioning. The color dynamically changes based on the rate threshold: green for healthy (>=80), yellow for warning (>=50), red for critical (<50). Legend and tooltip are disabled for a clean presentation.
