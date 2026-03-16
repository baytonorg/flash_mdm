# `src/constants/billing.ts`

> Billing duration options and normalization for subscription/license duration fields.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DURATION_MONTH_OPTIONS` | `readonly [1, 12, 24, 36]` | Allowed billing duration values in months |
| `normalizeBillingDurationMonths` | `(value: unknown) => number` | Coerces an arbitrary value to a valid duration; defaults to `1` if invalid |

## Key Logic

- `normalizeBillingDurationMonths` converts the input to a `Number`, checks it is an integer, and verifies it exists in `DURATION_MONTH_OPTIONS`.
- Returns the first option (`1`) for any non-integer or unlisted value.
