# `src/components/common/FilterBar.tsx`

> Composable toolbar with a search input, optional filter dropdowns, and a leading accessory slot.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `FilterBar` | `React.FC<FilterBarProps>` (default) | Renders a search input and filter dropdowns in a responsive flex layout |
| `FilterBarProps` | `interface` | Props for the component |
| `FilterDef` | `interface` | Definition for a single filter dropdown: `key`, `label`, `options`, `value`, `onChange` |
| `FilterOption` | `interface` | Individual option within a filter: `value` and `label` |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `searchValue` | `string` | Yes | Controlled value of the search input |
| `onSearchChange` | `(value: string) => void` | Yes | Called on every keystroke in the search input |
| `searchPlaceholder` | `string` | No | Placeholder text for the search input. Default `'Search...'` |
| `filters` | `FilterDef[]` | No | Array of filter dropdown definitions. Default `[]` |
| `leadingAccessory` | `ReactNode` | No | Optional element rendered before the search input (e.g., a ViewToggle) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `Search` | `lucide-react` | Search icon inside the input |

## Key Logic

- Layout is responsive: stacks vertically on small screens, horizontal on `sm:` and up.
- The search input has a left-positioned search icon and standard focus ring styling.
- Each filter is rendered as a native `<select>` element with the filter's `label` as the default (empty-value) option.
- The `leadingAccessory` slot allows composing other controls (like `ViewToggle`) inline with the search bar.
