# `src/components/common/TableLoadingState.tsx`

> Skeleton loading placeholder that mimics a data table structure with animated pulse rows.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `TableLoadingState` | `React.FC<TableLoadingStateProps>` (default) | Renders a table skeleton with pulse-animated placeholder cells |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `columnCount` | `number` | Yes | Number of columns to render in the skeleton |
| `rowCount` | `number` | No | Number of skeleton body rows. Default `5` |
| `selectable` | `boolean` | No | When `true`, adds an extra narrow checkbox-placeholder column. Default `false` |

## Key Logic

- Renders a full `<table>` structure with `<thead>` and `<tbody>` containing `animate-pulse` divs to simulate loading content.
- Used internally by `DataTable` when its `loading` prop is `true`.
- The header and body both include the optional selectable checkbox column for visual consistency with the loaded table.
