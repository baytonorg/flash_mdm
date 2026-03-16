# `netlify/functions/_lib/brand.ts`

> Centralized brand/product name constants used across the backend.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `BRAND` | `{ name: 'Flash MDM'; shortName: 'Flash'; domain: 'flash-mdm.netlify.app'; emailFrom: string; totpIssuer: 'FlashMDM'; defaultEnterpriseName: 'Flash MDM Enterprise' }` | Read-only object containing all product branding strings (full name, short name, domain, email sender, TOTP issuer, default enterprise display name) |

## Key Logic

This file is a single `as const` object literal. Changing these values updates the product name across all backend email templates, TOTP registration, enterprise provisioning, and anywhere else the brand is referenced. No runtime logic; purely configuration.
