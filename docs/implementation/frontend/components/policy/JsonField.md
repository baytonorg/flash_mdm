# `src/components/policy/fields/JsonField.tsx`

> Textarea-based JSON editor field with live parsing, kind validation, and external sync.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `JsonField` | `React.FC<JsonFieldProps>` (default) | Renders a textarea for editing JSON with real-time validation feedback |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Field label text |
| `description` | `string` | No | Helper text displayed below the label |
| `value` | `any` | Yes | Current JSON value (object, array, or any) |
| `onChange` | `(value: any) => void` | Yes | Callback with the parsed value on valid input |
| `kind` | `'object' \| 'array' \| 'any'` | No | Expected JSON structure type (default: `'any'`) |
| `placeholder` | `string` | No | Placeholder text for the textarea |
| `rows` | `number` | No | Number of textarea rows (default: `6`) |
| `validate` | `(value: any) => string \| null` | No | Custom validation function returning an error message or null |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isKind` | 16-20 | Checks if a parsed value matches the expected `kind` (object, array, or any) |
| `pretty` | 22-30 | Pretty-prints a value to JSON string with fallback for undefined/null |

## Key Logic

Maintains internal `text` state synchronized with the serialized prop value via a `useEffect` that tracks prop changes through a ref. On every keystroke, attempts to parse the text as JSON. If parsing succeeds and the value matches the expected `kind`, runs optional custom validation, then calls `onChange` with the parsed result. Empty input is treated as the empty value for the kind (`[]`, `{}`, or `null`). Parse errors and kind mismatches are shown as red error text below the textarea. A gray hint below shows the expected format.
