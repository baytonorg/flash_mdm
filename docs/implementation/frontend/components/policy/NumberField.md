# `src/components/policy/fields/NumberField.tsx`

> Numeric input field with optional min/max range display.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `NumberField` | `React.FC<NumberFieldProps>` (default) | Renders a number input with label, description, and range hint |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Field label text |
| `description` | `string` | No | Helper text displayed below the label |
| `value` | `number` | Yes | Current numeric value |
| `onChange` | `(value: number) => void` | Yes | Callback with the new number on valid input |
| `min` | `number` | No | Minimum allowed value (sets HTML `min` attribute) |
| `max` | `number` | No | Maximum allowed value (sets HTML `max` attribute) |

## Key Logic

Renders a standard `<input type="number">` with the provided min/max constraints. On change, parses the input string via `Number()` and only calls `onChange` if the result is not `NaN`. When min and/or max are provided, a gray hint line displays the valid range below the input.
