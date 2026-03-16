# `src/components/policy/fields/EnumField.tsx`

> Enum selector that renders as radio cards (5 or fewer options) or a dropdown select (more than 5).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnumField` | `React.FC<EnumFieldProps>` (default) | Renders radio buttons or a `<select>` depending on option count |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Field label text |
| `description` | `string` | No | Helper text displayed below the label |
| `value` | `string` | Yes | Currently selected enum value |
| `onChange` | `(value: string) => void` | Yes | Callback with the selected value |
| `options` | `EnumOption[]` | Yes | Array of `{ value, label, description? }` objects |

## Key Logic

Adaptively renders based on option count. When `options.length <= 5`, renders styled radio card buttons with optional per-option descriptions and an accent-colored border for the selected option. When there are more than 5 options, falls back to a standard `<select>` dropdown. This keeps compact enums visually scannable while avoiding an unwieldy radio list for larger enum sets.
