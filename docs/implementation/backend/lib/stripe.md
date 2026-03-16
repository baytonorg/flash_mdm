# `netlify/functions/_lib/stripe.ts`

> Platform-level Stripe client for creating checkout sessions, billing portal sessions, and verifying webhook signatures.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `getStripe` | `() => Stripe` | Returns a lazily-initialized singleton Stripe client using `STRIPE_SECRET_KEY` env var; throws if not configured |
| `createCheckoutSession` | `(workspaceId: string, priceId: string, customerId: string, returnUrl: string, options?: { quantity?: number; metadata?: Record<string, string> }) => Promise<string>` | Creates a Stripe Checkout session in subscription mode; returns the checkout URL |
| `createPortalSession` | `(customerId: string, returnUrl: string) => Promise<string>` | Creates a Stripe Billing Portal session for self-service subscription management; returns the portal URL |
| `verifyWebhookSignature` | `(body: string, signature: string, secret: string) => Stripe.Event` | Verifies and constructs a Stripe webhook event from raw body, signature header, and endpoint secret |

## Key Logic

The Stripe client is a lazy singleton initialized on first call to `getStripe()` using API version `2024-12-18.acacia`.

`createCheckoutSession` creates subscription-mode checkout sessions with:
- Quantity floored to minimum 1 and truncated to integer
- `workspace_id` injected into both session and subscription metadata
- Success/cancel URLs appended with `?checkout=success` / `?checkout=cancelled` query parameters

`verifyWebhookSignature` delegates directly to Stripe's `webhooks.constructEvent` for signature verification, which throws on invalid signatures.
