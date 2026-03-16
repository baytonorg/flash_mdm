# `netlify/functions/stripe-checkout.ts`

> Creates a Stripe Checkout session for purchasing a licence plan, including gift-seat offset logic and seat/duration normalization.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| (none) | | All logic is inline within the handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `query`, `queryOne` | `_lib/db` | Database lookups and updates |
| `requireWorkspaceResourcePermission` | `_lib/rbac` | Permission checks |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `isValidUuid` | `_lib/helpers` | Request/response utilities |
| `getStripe`, `createCheckoutSession` | `_lib/stripe` | Stripe API client and checkout session creation |
| `logAudit` | `_lib/audit` | Audit trail logging |
| `getWorkspaceAvailableGiftSeats`, `getWorkspaceLicensingSettings` | `_lib/licensing` | Licensing state and gift-seat calculation |

## Key Logic

1. Only accepts `POST` requests.
2. Requires `STRIPE_SECRET_KEY` to be set; returns 503 otherwise.
3. API keys are forbidden from creating checkout sessions.
4. Requires `workspace.read` and `billing.billing_manage` permissions.
5. Validates the plan exists, is not hidden, and has a `stripe_price_id`.
6. Gets or creates a Stripe customer for the workspace (stores `stripe_customer_id` on the workspace row).
7. Normalizes `seat_count` (clamped 1-100,000) and `duration_months` (clamped 1-60).
8. Calculates available gift seats and subtracts them from the billable count.
9. If all seats are covered by gifts (`billableSeatCount <= 0`), rejects with 409 since no Stripe payment is needed.
10. Calls `createCheckoutSession` with quantity, metadata (seat counts, gift offsets, duration, plan ID), and a return URL of `/licenses`.
11. Logs an audit event and returns the `checkout_url`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/stripe-checkout` | Session only | Create a Stripe Checkout session for licence purchase |
