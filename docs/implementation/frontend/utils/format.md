# `src/utils/format.ts`

> Date formatting utility for displaying ISO timestamps in a localized short format.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `formatDate` | `(iso: string) => string` | Formats an ISO date string as a localized short date (e.g. `"Mar 2, 2026"`) |

## Key Logic

- Uses `Date.toLocaleDateString` with `undefined` locale (browser default) and options `{ year: 'numeric', month: 'short', day: 'numeric' }`.
