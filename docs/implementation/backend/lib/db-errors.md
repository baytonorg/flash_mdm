# `netlify/functions/_lib/db-errors.ts`

> Postgres error code detection utility for identifying missing table/relation errors.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `isMissingRelationError` | `(err: unknown) => boolean` | Returns true if the error is a Postgres `42P01` (undefined_table) error |

## Key Logic

Checks if an unknown error object has a `code` property equal to `'42P01'`, which is the Postgres SQLSTATE for "undefined table". Used to gracefully handle queries against tables that may not yet exist during incremental migrations.
