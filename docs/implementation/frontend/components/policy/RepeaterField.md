# `src/components/policy/fields/RepeaterField.tsx`

> Dynamic list field for adding, removing, and editing repeated items with a custom render function.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `RepeaterField` | `React.FC<RepeaterFieldProps>` (default) | Renders a dynamic list of items with add/remove controls and delegated item rendering |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Field label text |
| `description` | `string` | No | Helper text displayed below the label |
| `value` | `any[]` | Yes | Current array of items |
| `onChange` | `(value: any[]) => void` | Yes | Callback with the updated array |
| `renderItem` | `(item: any, index: number, onChange: (item: any) => void) => ReactNode` | Yes | Render function for each item; receives the item, its index, and an item-level change handler |
| `defaultItem` | `any` | Yes | Template value used when adding a new item (shallow-cloned if object) |
| `maxItems` | `number` | No | Maximum number of items allowed; disables the add button when reached |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleAdd` | 23-26 | Appends a shallow clone of `defaultItem` to the array (respects `maxItems`) |
| `handleRemove` | 28-30 | Removes an item at the given index |
| `handleItemChange` | 32-36 | Replaces an item at the given index with an updated value |

## Key Logic

Renders each item in a bordered card with a grip handle icon (visual only, no drag-and-drop), the custom-rendered item content via `renderItem`, and a trash button to remove the item. When the array is empty, shows a dashed placeholder. An "Add item" button at the bottom appends new items using a shallow clone of `defaultItem`. When `maxItems` is reached, the button is disabled and shows "Limit reached".
