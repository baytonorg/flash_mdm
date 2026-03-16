# `src/components/policy/fields/SelectField.tsx`

> Dropdown select field with a custom chevron icon.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SelectField` | `React.FC<SelectFieldProps>` (default) | Renders a styled `<select>` dropdown with label and description |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Field label text |
| `description` | `string` | No | Helper text displayed below the label |
| `value` | `string` | Yes | Currently selected value |
| `onChange` | `(value: string) => void` | Yes | Callback with the selected value |
| `options` | `Array<{ value: string; label: string }>` | Yes | Array of option objects |

## Key Logic

Renders a standard HTML `<select>` element with `appearance-none` styling and a positioned `ChevronDown` icon from lucide-react as the custom dropdown indicator. Maps the `options` array to `<option>` elements. Calls `onChange` with `e.target.value` on selection change.
