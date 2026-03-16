# `netlify/functions/stripe-webhook.ts`

> Handles incoming Stripe webhook events to synchronize subscription state, process payments, and send billing notification emails.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getWorkspaceIdForEvent` | 15-55 | Extracts the workspace ID from a Stripe event by inspecting metadata or looking up the licence by subscription ID |
| `handleCheckoutCompleted` | 160-277 | Processes `checkout.session.completed`: upserts licence, creates grant, handles gift-seat offset invoice records (within a transaction) |
| `handleSubscriptionUpdated` | 279-325 | Processes `customer.subscription.updated`: maps Stripe status, updates licence status, period end, and optionally plan ID |
| `handleSubscriptionDeleted` | 327-367 | Processes `customer.subscription.deleted`: cancels licence and related grants (within a transaction) |
| `handlePaymentFailed` | 369-409 | Processes `invoice.payment_failed`: marks licence as `past_due`, sends payment-failed email |
| `handleInvoicePaid` | 411-446 | Processes `invoice.paid`: sends renewal confirmation email |
| `findPlanBySubscription` | 448-459 | Retrieves the subscription from Stripe, extracts the price ID, and looks up the matching licence plan |
| `mapStripeStatus` | 461-477 | Maps Stripe subscription statuses to internal status strings (`active`, `past_due`, `cancelled`, `inactive`) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute`, `transaction` | `_lib/db` | Database operations including transactional writes |
| `jsonResponse`, `errorResponse` | `_lib/helpers` | HTTP response helpers |
| `verifyWebhookSignature` | `_lib/stripe` | Verify the Stripe webhook signature |
| `logAudit` | `_lib/audit` | Audit trail logging |
| `getWorkspaceLicensingSettings`, `isPlatformLicensingEnabled` | `_lib/licensing` | Check platform and workspace licensing state |
| `buildPaymentFailedEmail`, `buildRenewalEmail`, `getWorkspaceScopeNames`, `queueAndSendBillingEmail` | `_lib/billing-notifications` | Build and send billing notification emails |

## Key Logic

1. Only accepts `POST` requests.
2. Verifies the `stripe-signature` header against `STRIPE_WEBHOOK_SECRET`.
3. **Idempotency**: Checks `workspace_billing_events` for a duplicate `event_id` before processing. Also uses `ON CONFLICT DO NOTHING` on insert for race-condition safety.
4. Skips processing if platform licensing or workspace licensing is disabled.
5. Dispatches to handler functions based on `event.type`:
   - **`checkout.session.completed`**: Uses a serialized transaction (locks the workspace row with `FOR UPDATE`) to upsert the licence, create a `license_grants` row (with `NOT EXISTS` guard), and optionally create gift-offset invoice records.
   - **`customer.subscription.updated`**: Updates licence status, `current_period_end`, and plan ID (if the price changed).
   - **`customer.subscription.deleted`**: Cancels the licence and all related active Stripe grants in a transaction.
   - **`invoice.payment_failed`**: Marks the licence `past_due` and queues a payment-failed email to workspace billing contacts.
   - **`invoice.paid`**: Queues a renewal confirmation email.
6. All handler functions log system-level audit events with `actor_type: 'system'` and `visibility_scope: 'privileged'`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/stripe-webhook` | Stripe signature (`stripe-signature` header) | Receive and process Stripe webhook events |
