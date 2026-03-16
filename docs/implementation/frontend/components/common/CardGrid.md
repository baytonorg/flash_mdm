# `src/components/common/CardGrid.tsx`

> Generic responsive grid layout that renders items as cards with built-in loading and empty states.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `CardGrid` | `<T>(props: CardGridProps<T>) => JSX.Element` (default) | Generic grid component that maps items to cards via a render prop |
| `CardGridProps` | `interface` | Props for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `items` | `T[]` | Yes | Array of data items to render |
| `renderCard` | `(item: T, index: number) => ReactNode` | Yes | Render prop called for each item |
| `loading` | `boolean` | No | When `true`, shows 6 skeleton placeholder cards. Default `false` |
| `emptyMessage` | `string` | No | Message displayed when `items` is empty. Default `'No items found'` |
| `columns` | `2 \| 3 \| 4` | No | Number of grid columns at largest breakpoint. Default `3` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `clsx` | `clsx` | Merging grid column class names |

## Key Logic

- Uses a static `gridColsClass` map to translate the `columns` prop into responsive Tailwind grid classes (`grid-cols-1` up through `sm`, `lg`, `xl` breakpoints).
- Three render paths: loading skeleton (6 pulse-animated placeholder cards), empty state (centered message), or the mapped card grid.
- The component is generic over `T`, so it works with any data shape.
