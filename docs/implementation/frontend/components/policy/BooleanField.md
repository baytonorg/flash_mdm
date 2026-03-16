# `src/components/policy/fields/BooleanField.tsx`

> Toggle switch field for boolean policy settings.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `BooleanField` | `React.FC<BooleanFieldProps>` (default) | Renders a toggle switch with label and optional description |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | Yes | Field label text |
| `description` | `string` | No | Helper text displayed below the label |
| `value` | `boolean` | Yes | Current toggle state |
| `onChange` | `(value: boolean) => void` | Yes | Callback with the new boolean value when toggled |

## Key Logic

Renders an accessible toggle switch using a `<button>` with `role="switch"` and `aria-checked`. Clicking inverts the value via `onChange(!value)`. The switch uses accent color when on and gray when off, with a sliding white circle indicator. Label and description are displayed to the right of the toggle.
