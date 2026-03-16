import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripeInstance = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  }
  return stripeInstance;
}

export async function createCheckoutSession(
  workspaceId: string,
  priceId: string,
  customerId: string,
  returnUrl: string,
  options?: {
    quantity?: number;
    metadata?: Record<string, string>;
  }
): Promise<string> {
  const stripe = getStripe();
  const quantity = Math.max(1, Math.trunc(options?.quantity ?? 1));
  const metadata = {
    workspace_id: workspaceId,
    ...(options?.metadata ?? {}),
  };
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity }],
    success_url: `${returnUrl}?checkout=success`,
    cancel_url: `${returnUrl}?checkout=cancelled`,
    metadata,
    subscription_data: {
      metadata,
    },
  });
  if (!session.url) throw new Error('Failed to create checkout session');
  return session.url;
}

export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(body, signature, secret);
}
