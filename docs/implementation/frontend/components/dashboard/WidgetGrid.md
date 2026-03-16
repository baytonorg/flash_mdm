# `src/components/dashboard/WidgetGrid.tsx`

> Responsive CSS grid layout container for dashboard widgets.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WidgetGrid` | `default function` | Renders a responsive grid wrapper |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `children` | `ReactNode` | Yes | Widget components to arrange in the grid |

## Key Logic

The component renders a CSS grid container with responsive breakpoints: 1 column on mobile, 2 columns on `md` screens, and 4 columns on `xl` screens, with a 24px (1.5rem) gap between items. Child widgets that need to span multiple columns use `col-span` utilities on themselves (e.g., `xl:col-span-2`).
