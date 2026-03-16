# `netlify/functions/_lib/platform-settings.ts`

> Reads and writes global platform settings from the `platform_settings` singleton row, with multi-level fallback for schema migrations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PlatformSettings` | `interface` | Shape: `{ invite_only_registration: boolean, licensing_enabled: boolean, default_free_enabled: boolean, default_free_seat_limit: number }` |
| `getPlatformSettings` | `() => Promise<PlatformSettings>` | Reads platform settings from row id=1; falls back to defaults on missing columns or missing table |
| `setPlatformSettings` | `(updates: Partial<PlatformSettings>, updatedByUserId?: string) => Promise<void>` | Upserts platform settings with partial updates, merging with current values |
| `setInviteOnlyRegistration` | `(enabled: boolean, updatedByUserId?: string) => Promise<void>` | Convenience wrapper to update only `invite_only_registration` |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isMissingColumnError` | 18-25 | Detects Postgres error code 42703 (undefined column) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `queryOne` | `_lib/db.ts` | Database read/write for `platform_settings` table |
| `isMissingRelationError` | `_lib/db-errors.ts` | Detecting when the `platform_settings` table does not exist yet |

## Key Logic

The module manages a singleton row (`id = 1`) in the `platform_settings` table. Default values are:

| Setting | Default |
|---------|---------|
| `invite_only_registration` | `false` |
| `licensing_enabled` | `true` |
| `default_free_enabled` | `true` |
| `default_free_seat_limit` | `10` |

Both `getPlatformSettings` and `setPlatformSettings` implement a three-tier fallback strategy for backward compatibility during rolling migrations:

1. **Full schema**: Queries/writes all four columns.
2. **Missing `licensing_enabled`**: Falls back to three columns (`invite_only_registration`, `default_free_enabled`, `default_free_seat_limit`), using the default for `licensing_enabled`.
3. **Legacy schema**: Falls back to `invite_only_registration` only, using defaults for all other fields.

If the `platform_settings` table itself does not exist (`isMissingRelationError`), `getPlatformSettings` returns all defaults. `setPlatformSettings` uses `INSERT ... ON CONFLICT DO UPDATE` for atomic upsert semantics.
