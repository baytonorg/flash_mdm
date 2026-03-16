# `src/lib/brand.ts`

> Centralized brand/product name constants used across the application for consistent naming.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `BRAND` | `{ name, shortName, tagline, domain, emailFrom, totpIssuer } as const` | Immutable object of brand strings |

## Key Logic

- Single source of truth for product naming. Changing values here renames the product everywhere.
- `name`: `'Flash MDM'` -- full product name.
- `shortName`: `'Flash'` -- abbreviated name.
- `tagline`: `'Android Device Management'`.
- `domain`: `'flash-mdm.netlify.app'`.
- `emailFrom`: `'Flash MDM <noreply@flash-mdm.netlify.app>'` -- sender address for transactional emails.
- `totpIssuer`: `'FlashMDM'` -- used in TOTP QR code generation.
