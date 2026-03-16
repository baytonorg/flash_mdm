# `src/pages/Licenses.tsx`

> License and billing management page with workspace-level and environment-level tabs for plans, grants, invoices, and Stripe integration.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Licenses` | `React.FC` (default) | Licenses page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `hasRoleAtLeast` | 149-152 | Checks if a user's workspace role meets a minimum threshold |
| `getErrorMessage` | 155-160 | Extracts an error message string from an unknown error |
| `formatCurrency` | 162-172 | Formats cents to a locale currency string (e.g. 1500 -> "$15.00") |
| `UsageRing` | 174-207 | SVG ring chart showing seat usage (used vs total) |
| `StatCard` | 209-217 | Small stat display card with label, value, and optional alert styling |
| `PhaseBadge` | 219-235 | Coloured badge for license phase (active, trial, grace, suspended, expired) |
| `SourceBadge` | 237-257 | Coloured badge for license grant source (manual, stripe, trial, signup_link) |
| `StatusDot` | 259-266 | Small coloured dot for invoice status |
| `Collapsible` | 268-289 | Expandable section with chevron toggle |
| `WorkspaceTab` | 291-293 | Container wrapper for the workspace tab content |
| `EnvironmentTab` | 295-301 | Container wrapper for the environment tab content |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Accessing active environment and workspace |
| `useAuthStore` | `@/stores/auth` | Accessing current user and workspace role |
| `apiClient` | `@/api/client` | Direct API calls for billing config, pricing, grants |
| `useLicenseStatus`, `useCreateCheckout` | `@/api/queries/licenses` | License status query and Stripe checkout mutation |
| `LicenseStatusResponse` | `@/api/queries/licenses` | TypeScript type for license status |
| `parseMajorInputToMinorUnits` | `@/utils/currency` | Converting user-entered dollar amounts to cents |
| `formatDate` | `@/utils/format` | Date formatting utility |
| `DURATION_MONTH_OPTIONS`, `normalizeBillingDurationMonths` | `@/constants/billing` | Billing duration dropdown options |
| `WorkspaceLicenseSettingsResponse` | `@/types/licensing` | TypeScript type for workspace license settings |

## Key Logic

The page is split into two tabs: Workspace and Environment. The **Workspace tab** (admin/owner only) shows the overall license status (phase badge, usage ring, seat counts), license grants with source/status, invoices with payment status, and billing configuration. Admins can manage workspace-level Stripe billing config (publishable key, secret key, webhook secret), custom pricing tiers (seat price, duration), and workspace license settings (trial days, grace period, max devices, self-service toggle). The **Environment tab** shows environment-specific license status, available plans (fetched from `/api/licenses/plans`), and a Stripe checkout flow via `useCreateCheckout`. Both tabs use collapsible sections for organization. Role-based access control restricts billing configuration to admins and owners via `hasRoleAtLeast`.
