# `netlify/functions/workspace-billing.ts`

> Workspace-level billing management: configure Stripe integration, manage a pricing catalog, view per-environment billing state, create Stripe Checkout sessions, open Stripe Billing Portal, and grant manual/free entitlements.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (named `handler`) | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `normalizeDurationMonths` | 27-29 | Clamps a duration value to one of the allowed months (1, 12, 24, 36) |
| `asRecord` | 31-34 | Safely coerces an unknown value to `Record<string, unknown>` |
| `syncWorkspacePricingToStripe` | 36-147 | Creates or updates a Stripe Product and Price to match a workspace pricing entry; returns updated metadata with Stripe IDs |
| `parseRoute` | 149-162 | Parses the URL pathname into a typed route enum and optional `environmentId` |
| `handlePostManualGrant` | 164-251 | Creates a manual or free entitlement for an environment |
| `requireWorkspaceBillingOrEnvironmentPermission` | 253-275 | Two-tier auth: tries workspace billing permission first, falls back to environment-level permission |
| `requireLicensingEnabled` | 277-285 | Throws 409 if licensing is disabled for the workspace |
| `getWorkspaceBillingSettings` | 287-295 | Fetches `workspace_billing_settings` row |
| `resolveCheckoutReturnUrl` | 297-325 | Validates and normalises checkout success/cancel URLs; enforces same-origin |
| `handleGetConfig` | 327-372 | Returns billing config (mode, publishable key, currency, etc.); returns `licensing_enabled: false` when disabled |
| `handlePutConfig` | 374-474 | Upserts billing config; validates Stripe secret key by calling `stripe.balance.retrieve()` |
| `handleGetPricing` | 476-527 | Lists all pricing catalog entries for the workspace |
| `handlePutPricing` | 529-670 | Creates, updates, or deletes a pricing catalog entry; syncs to Stripe on save |
| `handleGetEnvironment` | 672-747 | Returns billing state for an environment: customer, effective pricing, entitlement history |
| `handlePutEnvironment` | 749-816 | Upserts workspace_customers mapping for an environment (name, email, pricing, status) |
| `handlePostCheckout` | 818-1010 | Creates a Stripe Checkout session for subscription billing; auto-creates Stripe customer if needed |
| `handlePostPortal` | 1012-1054 | Opens a Stripe Billing Portal session for an environment's customer |

## Internal Types

| Name | Lines | Description |
|------|-------|-------------|
| `BillingRoute` | 11 | Union type for route matching: `'config' \| 'pricing' \| 'environment' \| 'checkout' \| 'portal' \| 'manual_grant' \| 'unknown'` |
| `WorkspaceBillingSettings` | 15-25 | Shape of a `workspace_billing_settings` row |

## Constants

| Name | Value | Description |
|------|-------|-------------|
| `ALLOWED_DURATION_MONTHS` | `[1, 12, 24, 36]` | Valid subscription duration options |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne` | `_lib/db.js` | Database access |
| `requireAuth` | `_lib/auth.js` | Authentication |
| `requireEnvironmentPermission`, `requireWorkspaceResourcePermission` | `_lib/rbac.js` | RBAC enforcement |
| `encrypt` | `_lib/crypto.js` | Encrypting Stripe secret keys |
| `createWorkspaceStripeClient`, `getWorkspaceStripeCredentials` | `_lib/workspace-stripe.js` | Initialising per-workspace Stripe SDK instances |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `getWorkspaceLicensingSettings` | `_lib/licensing.js` | Checking if licensing is enabled |
| `getSearchParams`, `jsonResponse`, `errorResponse`, `parseJsonBody`, `isValidUuid`, `getClientIp` | `_lib/helpers.js` | HTTP helpers and validation |

## Key Logic

The handler uses a route table (`routeHandlers`) mapping `METHOD:route` strings to handler functions. Route parsing extracts sub-paths like `config`, `pricing`, `environments/:id`, `checkout`, `portal`, and `grants/manual`.

**Stripe sync flow**: When a pricing entry is created or updated, `syncWorkspacePricingToStripe` ensures a matching Stripe Product and Price exist. If the price attributes have changed, a new Price is created and the old one is archived. The resulting Stripe IDs are stored in the pricing entry's `metadata` JSONB column.

**Checkout flow**: Resolves the effective pricing (customer override > workspace default), ensures a Stripe Price is synced, creates or reuses a Stripe Customer, then creates a Checkout Session in `subscription` mode. Metadata propagated to the subscription enables the webhook handler to match payments back to environments.

**Manual grants**: Directly inserts an `environment_entitlements` row with source `workspace_manual` or `workspace_free`, optionally with no expiry.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/workspace-billing/config?workspace_id=` | Session / API key | Get workspace billing configuration |
| PUT | `/.netlify/functions/workspace-billing/config` | Session only | Update workspace billing configuration (Stripe keys, mode, currency) |
| GET | `/.netlify/functions/workspace-billing/pricing?workspace_id=` | Session / API key | List pricing catalog entries |
| PUT | `/.netlify/functions/workspace-billing/pricing` | Session / API key | Create, update, or delete a pricing catalog entry |
| GET | `/.netlify/functions/workspace-billing/environments/:id` | Session / API key | Get billing state for an environment (customer, pricing, entitlements) |
| PUT | `/.netlify/functions/workspace-billing/environments/:id` | Session / API key | Update environment billing mapping (customer, pricing, status) |
| POST | `/.netlify/functions/workspace-billing/checkout` | Session only | Create a Stripe Checkout session |
| POST | `/.netlify/functions/workspace-billing/portal` | Session / API key | Create a Stripe Billing Portal session |
| POST | `/.netlify/functions/workspace-billing/grants/manual` | Session / API key | Create a manual or free entitlement grant |
