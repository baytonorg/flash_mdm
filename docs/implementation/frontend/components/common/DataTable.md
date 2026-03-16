# `src/components/common/DataTable.tsx`

> Generic data table with column sorting, row selection, click handling, and loading/empty states.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DataTable` | `<T extends object>(props: DataTableProps<T>) => JSX.Element` (default) | Renders a full-featured HTML table from column definitions and data |
| `ColumnDef<T>` | `interface` | Column definition: `key`, `label`, optional `sortable`, `render`, `className` |
| `DataTableProps<T>` | `interface` | Props for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `columns` | `ColumnDef<T>[]` | Yes | Column definitions controlling header labels, sort behavior, and cell rendering |
| `data` | `T[]` | Yes | Array of row objects |
| `loading` | `boolean` | No | Shows a skeleton loading table via `TableLoadingState`. Default `false` |
| `emptyMessage` | `string` | No | Text shown when `data` is empty. Default `'No data found'` |
| `selectable` | `boolean` | No | Enables checkbox selection column. Default `false` |
| `onSelectionChange` | `(selectedRows: T[]) => void` | No | Called with the updated selection array when checkboxes change |
| `sortColumn` | `string` | No | Currently sorted column key (controlled) |
| `sortDirection` | `'asc' \| 'desc'` | No | Current sort direction (controlled) |
| `onSort` | `(column: string, direction: 'asc' \| 'desc') => void` | No | Called when a sortable column header is clicked |
| `onRowClick` | `(row: T) => void` | No | Called when a row is clicked (excluding the checkbox cell) |
| `selectedRows` | `T[]` | No | Controlled array of currently selected rows. Default `[]` |
| `rowKey` | `(row: T) => string` | No | Custom function to derive a unique key per row; falls back to `row.id` then index |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getRowKey` | 43-50 | Memoized callback that resolves a unique string key for a row |
| `handleSelectAll` | 58-61 | Toggles between selecting all rows and clearing selection |
| `handleSelectRow` | 63-71 | Toggles selection for an individual row |
| `handleSort` | 73-78 | Computes next sort direction and calls `onSort` |
| `renderSortIcon` | 80-90 | Returns the appropriate sort direction icon for a column header |
| `getValue` | 92-94 | Extracts a value from a row object by column key |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `TableLoadingState` | `@/components/common/TableLoadingState` | Skeleton loading table shown when `loading` is `true` |
| `clsx` | `clsx` | Conditional class name merging |
| `ArrowUp`, `ArrowDown`, `ArrowUpDown` | `lucide-react` | Sort direction indicator icons |

## Key Logic

- Selection state is tracked via a `Set` of row keys (`selectedKeySet`) built with `useMemo` for efficient lookup.
- The "select all" checkbox in the header toggles between selecting all visible rows and clearing all.
- Sort is controlled externally: clicking a sortable header toggles between `asc` and `desc`, calling the parent's `onSort`.
- Column headers for sortable columns have `role="button"`, `tabIndex={0}`, keyboard support (`Enter`/`Space`), and `aria-sort` attributes for accessibility.
- Individual row checkbox clicks call `stopPropagation()` so they don't also trigger `onRowClick`.
- Custom cell rendering is supported via `ColumnDef.render`; otherwise the raw value is stringified.
