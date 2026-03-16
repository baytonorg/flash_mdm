# `netlify/functions/superadmin-billing.ts`

> Superadmin billing management: list/filter invoices, mark invoices as paid (with automatic license grant creation), and create manual or gift seat grants.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getRoute` | 23-39 | Parses the URL pathname tail to determine the sub-resource (`invoices`, `invoices/:id/mark-paid`, or `grants/manual`) |
| `applyGiftOffsetsToPendingInvoices` | 41-126 | Applies available gift seat credits to pending invoice items, reducing their billable quantity and auto-marking zero-subtotal invoices as paid |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne`, `transaction` | `_lib/db` | Database operations |
| `requireSuperadmin` | `_lib/auth` | Superadmin authentication gate |
| `jsonResponse`, `errorResponse`, `getSearchParams`, `parseJsonBody`, `isValidUuid`, `getClientIp` | `_lib/helpers` | Request/response utilities |
| `logAudit` | `_lib/audit` | Audit logging |
| `getWorkspaceAvailableGiftSeats`, `getWorkspaceLicensingSettings`, `isPlatformLicensingEnabled` | `_lib/licensing` | Licensing feature checks and gift seat availability |

## Key Logic

All routes are gated behind `requireSuperadmin` and `isPlatformLicensingEnabled`. If licensing is disabled platform-wide, GET returns an empty list and POST returns 409.

**Invoice listing (GET /invoices):** Supports optional `status` (pending/paid/cancelled) and `workspace_id` filters. Returns up to 500 invoices ordered by creation date descending, joined with workspace names.

**Mark invoice paid (POST /invoices/:id/mark-paid):** Runs inside a transaction with `FOR UPDATE` row lock. Updates invoice status to paid, then iterates invoice items to create `license_grants` with source `invoice`. Each grant's seat count and duration are derived from item metadata.

**Manual/gift grant (POST /grants/manual):** Validates workspace exists and licensing is enabled. Creates a `license_grant` with source `manual` or `gift`. Gift grants automatically trigger `applyGiftOffsetsToPendingInvoices` to offset pending invoices. Supports `duration_months`, `expires_at`, or `starts_at` for flexible grant periods. Caps at 1,000,000 seats and 120 months.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/.netlify/functions/superadmin-billing/invoices` | Superadmin | List invoices with optional status/workspace filters |
| `POST` | `/.netlify/functions/superadmin-billing/invoices/:id/mark-paid` | Superadmin | Mark an invoice as paid and create license grants |
| `POST` | `/.netlify/functions/superadmin-billing/grants/manual` | Superadmin | Create a manual or gift license grant for a workspace |
