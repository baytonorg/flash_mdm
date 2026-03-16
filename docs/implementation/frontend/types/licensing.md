# `src/types/licensing.ts`

> TypeScript interface for the workspace license settings API response.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkspaceLicenseSettingsResponse` | `interface` | Shape of the response from the workspace license settings endpoint |

## Key Logic

The `settings` object within the response contains:

- **Platform vs. workspace licensing**: `platform_licensing_enabled`, `workspace_licensing_enabled`, and the computed `effective_licensing_enabled`.
- **Free tier**: `inherit_platform_free_tier`, `free_enabled`/`free_seat_limit` (effective), `workspace_free_enabled`/`workspace_free_seat_limit` (workspace-level override), and `platform_default_free_enabled`/`platform_default_free_seat_limit` (platform defaults).
- **Billing**: `billing_method` is one of `'stripe'`, `'invoice'`, or `'disabled'`.
- **Customer ownership**: `customer_owner_enabled` controls whether workspace owners can manage their own licenses.
- **Grace periods**: `grace_day_block`, `grace_day_disable`, `grace_day_wipe` define escalating enforcement actions (in days) after license expiry.
