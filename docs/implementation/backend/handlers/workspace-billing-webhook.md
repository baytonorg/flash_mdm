# `netlify/functions/workspace-billing-webhook.ts`

> Receives Stripe webhook events for workspace-level billing, verifies signatures, deduplicates events, and provisions or manages environment entitlements based on checkout completions, invoice payments, and payment failures.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (named `handler`) | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `toPositiveInt` | 15-19 | Parses a string to a positive integer with a fallback default |
| `getWorkspaceIdFromEventMetadata` | 21-38 | Extracts `workspace_id` from Stripe event metadata, checking direct metadata, subscription_details, and parent subscription_details |
| `markWorkspaceEventProcessed` | 40-51 | Updates `workspace_billing_events.processed_at` for a given event |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `transaction` | `_lib/db.js` | Transactional database operations |
| `getSearchParams`, `jsonResponse`, `errorResponse`, `isValidUuid` | `_lib/helpers.js` | HTTP helpers and validation |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `createWorkspaceStripeClient`, `getWorkspaceStripeCredentials` | `_lib/workspace-stripe.js` | Per-workspace Stripe SDK and credential retrieval |
| `getWorkspaceLicensingSettings` | `_lib/licensing.js` | Checking if licensing is enabled |
| `buildPaymentFailedEmail`, `buildRenewalEmail`, `getWorkspaceScopeNames`, `queueAndSendBillingEmail` | `_lib/billing-notifications.js` | Composing and sending billing notification emails |

## Key Logic

1. **Authentication**: The handler does not use `requireAuth`. Instead it validates the `stripe-signature` header against the workspace's stored webhook secret via `stripe.webhooks.constructEvent()`. The `workspace_id` is provided as a query parameter and cross-checked against the event's metadata to prevent cross-workspace replay attacks.

2. **Idempotency**: Every event is inserted into `workspace_billing_events` with `ON CONFLICT (source, event_id) DO NOTHING`. If the insert returns 0 rows, the event is a duplicate and the handler returns early with `{ received: true, duplicate: true }`.

3. **Event handling**:

   - **`checkout.session.completed`**: For subscription-mode checkouts, the handler defers entitlement creation to `invoice.paid` (returns `deferred: 'awaiting_invoice_paid'`). For legacy one-time payment checkouts, it directly inserts an `environment_entitlements` row.

   - **`invoice.paid`**: Retrieves the subscription to get metadata (`environment_id`, `seat_count`, `duration_months`). Creates an active entitlement with an expiry based on the duration. Sends a renewal notification email to workspace billing contacts and the environment customer.

   - **`invoice.payment_failed`**: Marks the event as processed and sends a payment failure notification email.

   - **All other events**: Marked as processed with no further action.

4. **Entitlement creation**: Done inside a transaction that also verifies the environment belongs to the claimed workspace. Entitlements are created with source `workspace_customer_payment`, an `external_ref` pointing to the Stripe session/invoice ID, and metadata containing the event chain.

5. **Licensing gate**: If licensing is disabled for the workspace, the webhook returns `{ received: true, ignored: 'licensing_disabled' }` without processing.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/workspace-billing-webhook?workspace_id=` | Stripe signature | Receive and process Stripe webhook events |
