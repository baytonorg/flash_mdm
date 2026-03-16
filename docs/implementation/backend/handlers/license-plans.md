# `netlify/functions/license-plans.ts`

> CRUD operations for licence plans: list plans (with Stripe price enrichment), create/update plans (superadmin), and delete plans (superadmin).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getStripePriceCached` | 29-43 | Retrieves a Stripe price object with a 5-minute in-memory TTL cache |
| `normalizeStripeIntervalMonths` | 45-50 | Clamps a value to the allowed set `[1, 12, 24, 36]`, defaulting to 1 |
| `normalizeStripePriceIdInput` | 52-57 | Normalizes a stripe_price_id input to `string | null | undefined` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne` | `_lib/db` | Database operations |
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `getSearchParams`, `jsonResponse`, `errorResponse`, `isValidUuid`, `getClientIp`, `parseJsonBody` | `_lib/helpers` | Request/response utilities |
| `requireEnvironmentPermission`, `requireWorkspaceResourcePermission` | `_lib/rbac` | Permission checks |
| `getWorkspaceLicensingSettings` | `_lib/licensing` | Check licensing enablement |
| `getStripe` | `_lib/stripe` | Stripe API client |
| `logAudit` | `_lib/audit` | Audit trail logging |

## Key Logic

### GET (list plans)
1. Superadmins without a `workspace_id` filter see all plans (including hidden ones).
2. Non-superadmins require workspace-level or environment-level read permission.
3. Returns early with empty array if licensing is disabled for the workspace.
4. Enriches each plan with resolved `unit_amount_cents`, `currency`, and `stripe_interval_months` from Stripe prices (cached) or plan `features` JSON.
5. Filters out hidden plans unless the caller is a superadmin viewing globally.

### PUT (create or update plan)
1. Restricted to superadmin session users.
2. Validates `name`, `max_devices`, `unit_amount_cents`, and `currency` (3-letter ISO).
3. If `stripe_price_id` is provided, verifies it exists in Stripe.
4. If `create_stripe_price` is true, creates a Stripe product (if needed) and a recurring price, then stores the resulting IDs.
5. Merges incoming `features` with existing features, always setting `invoice_unit_amount_cents` and `currency`.
6. Uses INSERT or UPDATE depending on whether the plan already exists.
7. Logs an audit event.

### DELETE (delete plan)
1. Restricted to superadmin session users.
2. Prevents deletion of plans linked to a Stripe price (must hide instead).
3. Prevents deletion of plans in use by active workspace licences.
4. Hard-deletes the plan row and logs an audit event.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/license-plans` | Session / API key | List licence plans with pricing |
| `PUT` | `/.netlify/functions/license-plans` | Superadmin session | Create or update a licence plan |
| `DELETE` | `/.netlify/functions/license-plans?id={uuid}` | Superadmin session | Delete an unused licence plan |
