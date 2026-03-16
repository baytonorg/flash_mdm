# `src/components/policy/fields/TextField.tsx`

> Text input field supporting single-line and multiline modes.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `TextField` | `React.FC<TextFieldProps>` (default) | Renders an `<input>` or `<textarea>` with label and description |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Field label text |
| `description` | `string` | No | Helper text displayed below the label |
| `value` | `string` | Yes | Current text value |
| `onChange` | `(value: string) => void` | Yes | Callback with the new string value |
| `placeholder` | `string` | No | Placeholder text |
| `multiline` | `boolean` | No | When true, renders a resizable `<textarea>` with 4 rows instead of an `<input>` |

## Key Logic

Conditionally renders either a `<textarea>` (when `multiline` is true) or a standard `<input type="text">`. Both share the same CSS class string for consistent styling. The textarea adds `resize-y` for vertical resizing. Calls `onChange` with `e.target.value` on every input event.
