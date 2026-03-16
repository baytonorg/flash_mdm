# `src/components/dashboard/StatCard.tsx`

> Reusable stat card component displaying a label, numeric value, icon, and optional trend indicator.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `StatCard` | `default function` | Renders a single statistic card |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Descriptive label for the stat |
| `value` | `string \| number` | Yes | The stat value to display |
| `icon` | `ReactNode` | Yes | Icon element rendered in a blue circle |
| `trend` | `{ value: number; direction: 'up' \| 'down' }` | No | Optional trend indicator with percentage and direction |
| `className` | `string` | No | Additional CSS classes |

## Key Logic

The component renders a card with a blue-tinted icon container on the left and the label/value on the right. When a `trend` prop is provided, a colored trend indicator appears below the value: green with an up arrow for positive trends, red with a down arrow for negative trends. The percentage value is displayed alongside the arrow icon.
