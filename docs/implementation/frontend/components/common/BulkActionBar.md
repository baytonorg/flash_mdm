# `src/components/common/BulkActionBar.tsx`

> Fixed bottom bar that displays contextual bulk actions when rows are selected.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `BulkActionBar` | `React.FC<BulkActionBarProps>` (default) | Renders a floating action bar at the bottom of the viewport showing selected count, action buttons, and a clear button |
| `BulkAction` | `interface` | Shape for an individual action: `key`, `label`, optional `variant` and `icon` |
| `BulkActionBarProps` | `interface` | Props for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `selectedCount` | `number` | Yes | Number of currently selected items; bar is hidden when `0` |
| `actions` | `BulkAction[]` | Yes | Array of actions to render as buttons |
| `onAction` | `(key: string) => void` | Yes | Callback fired with the action `key` when an action button is clicked |
| `onClear` | `() => void` | Yes | Callback fired when the clear (X) button is clicked |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `clsx` | `clsx` | Conditional class name merging for button variant styles |
| `X` | `lucide-react` | Icon for the clear-selection button |

## Key Logic

- Returns `null` when `selectedCount` is `0`, so it only renders when there is an active selection.
- Positioned as a fixed, centered bar at the bottom of the viewport with a slide-up animation.
- Each action button is styled by its `variant` prop: `danger` (red), `warning` (amber), or `default` (gray).
- Actions are identified by their `key` string, which is passed back through `onAction`.
