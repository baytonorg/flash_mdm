# `netlify/functions/license-grants.ts`

> Lists licence grants and billing invoices for a workspace, and allows workspace users to submit invoice-based licence purchase requests.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `normalizePlanIntervalMonths` | 22-26 | Parses and clamps a plan interval value to a positive integer, defaulting to 1 |
| `resolvePlanBilling` | 28-65 | Resolves unit price and currency from Stripe or plan features; throws a 409 Response if unconfigured |
| `resolveActionPath` | 67-73 | Maps the request pathname to an action: `list`, `invoice_request`, or `unknown` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne` | `_lib/db` | Database operations |
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireEnvironmentPermission`, `requireWorkspaceResourcePermission` | `_lib/rbac` | Permission checks |
| `getSearchParams`, `jsonResponse`, `errorResponse`, `parseJsonBody`, `isValidUuid`, `getClientIp` | `_lib/helpers` | Request/response utilities |
| `logAudit` | `_lib/audit` | Audit trail logging |
| `getWorkspaceAvailableGiftSeats`, `getWorkspaceLicensingSettings` | `_lib/licensing` | Licensing state and gift-seat calculation |
| `getStripe` | `_lib/stripe` | Stripe API client for price lookups |

## Key Logic

### GET (list)
1. Resolves `workspace_id` from query params or auth context.
2. Falls back to environment-level read permission if workspace-level permission fails.
3. Returns early with empty arrays if licensing is disabled.
4. Requires `billing.license_view` permission.
5. Returns all `license_grants` and `billing_invoices` for the workspace.

### POST (invoice request)
1. API keys are forbidden from creating invoice requests.
2. Validates `workspace_id`, `plan_id`, `seat_count`, and `duration_months` with upper-bound guards (`MAX_INVOICE_SEAT_COUNT = 1,000,000`, `MAX_INVOICE_DURATION_MONTHS = 120`).
3. Requires `billing.billing_manage` permission.
4. Rejects hidden plans.
5. Resolves unit pricing from Stripe or plan features via `resolvePlanBilling`.
6. Subtracts available gift seats from the billable seat count.
7. Calculates `billingIntervals` as `ceil(duration_months / plan_interval_months)`.
8. Computes subtotal with integer overflow guard (`INT32_MAX`).
9. Creates a `billing_invoices` row (status `paid` if subtotal is 0, otherwise `pending` with a due date).
10. Creates a corresponding `billing_invoice_items` row.
11. Logs an audit event and returns the invoice ID plus gift-seat breakdown.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/license-grants` | Session / API key | List licence grants and invoices for a workspace |
| `POST` | `/.netlify/functions/license-grants/invoice-request` | Session only | Submit an invoice-based licence purchase request |
