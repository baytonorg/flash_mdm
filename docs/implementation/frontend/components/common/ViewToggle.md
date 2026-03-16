# `src/components/common/ViewToggle.tsx`

> Toggle button group for switching between table and card view modes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ViewToggle` | `React.FC<ViewToggleProps>` (default) | Renders a two-button toggle for table/card view selection |
| `ViewToggleProps` | `interface` | Props for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `'table' \| 'card'` | Yes | Currently active view mode |
| `onChange` | `(value: 'table' \| 'card') => void` | Yes | Called when a view mode button is clicked |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `clsx` | `clsx` | Conditional class names for active/inactive button states |
| `LayoutGrid`, `List` | `lucide-react` | Icons for card view and table view buttons respectively |

## Key Logic

- Stateless controlled component; the parent owns the `value` state.
- The active button gets a white background with shadow (`bg-surface text-gray-900 shadow-sm`); the inactive button is muted.
- Wrapped in a pill-shaped container with a secondary surface background.
