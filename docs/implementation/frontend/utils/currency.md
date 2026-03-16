# `src/utils/currency.ts`

> Utility for converting major-unit currency input strings to minor units (cents).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `parseMajorInputToMinorUnits` | `(input: string) => number` | Parses a decimal string (e.g. `"12.50"`) and returns integer minor units (e.g. `1250`). Returns `0` for non-finite or negative values. |

## Key Logic

- Parses the input with `Number.parseFloat`.
- Guards against `NaN`, `Infinity`, and negative numbers by returning `0`.
- Multiplies by 100 and rounds to the nearest integer to avoid floating-point drift.
