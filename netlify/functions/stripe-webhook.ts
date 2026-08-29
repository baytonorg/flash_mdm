import type { Context } from '@netlify/functions';
import { queryOne, transaction } from './_lib/db.js';
import { jsonResponse, errorResponse } from './_lib/helpers.js';
import { verifyWebhookSignature } from './_lib/stripe.js';
import { logAudit } from './_lib/audit.js';
import { getWorkspaceLicensingSettings, isPlatformLicensingEnabled } from './_lib/licensing.js';
import {
  buildPaymentFailedEmail,
  buildRenewalEmail,
  getWorkspaceScopeNames,
  queueAndSendBillingEmail,
} from './_lib/billing-notifications.js';
import type Stripe from 'stripe';
import type { PoolClient } from 'pg';

type StripeEventClient = Pick<PoolClient, 'query'>;
type AfterCommit = () => Promise<void>;

type LegacyInvoice = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

type LegacyInvoiceLine = Stripe.InvoiceLineItem & {
  proration?: boolean;
  price?: string | Stripe.Price | null;
};

interface InvoiceRenewalPeriod {
  seatCount: number;
  startsAt: string;
  endsAt: string;
  invoiceCreated: number;
  durationMonths: number;
  stripePriceId: string | null;
}

function subscriptionId(value: string | Stripe.Subscription | null | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.id ?? null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacySubscription = subscriptionId((invoice as LegacyInvoice).subscription);
  if (legacySubscription) return legacySubscription;
  return subscriptionId(invoice.parent?.subscription_details?.subscription);
}

function getInvoiceRenewalPeriod(
  invoice: Stripe.Invoice,
  expectedSubscriptionId: string,
  expectedStripePriceId: string | null
): InvoiceRenewalPeriod | null {
  const lines = invoice.lines?.data ?? [];
  const validLines = lines.filter((line) => {
    const lineSubscriptionId = subscriptionId(line.subscription);
    if (lineSubscriptionId && lineSubscriptionId !== expectedSubscriptionId) return false;

    const parent = line.parent;
    const isProration = (line as LegacyInvoiceLine).proration
      ?? parent?.subscription_item_details?.proration
      ?? parent?.invoice_item_details?.proration
      ?? false;
    return !isProration
      && Number.isFinite(line.quantity)
      && Number(line.quantity) > 0
      && Number.isFinite(line.period?.start)
      && Number.isFinite(line.period?.end)
      && line.period.end > line.period.start;
  });

  const recurringLines = validLines.filter(
    (line) => line.parent?.type === 'subscription_item_details'
  );
  const subscriptionCandidates = recurringLines.length > 0 ? recurringLines : validLines;
  const candidates = expectedStripePriceId
    ? subscriptionCandidates.filter((line) => getInvoiceLinePriceId(line) === expectedStripePriceId)
    : subscriptionCandidates;
  if (expectedStripePriceId && candidates.length === 0) return null;

  const candidatePriceIds = new Set(candidates.map(getInvoiceLinePriceId).filter(Boolean));
  if (!expectedStripePriceId && candidatePriceIds.size > 1) return null;
  const line = [...candidates].sort(
    (a, b) => b.period.end - a.period.end || b.period.start - a.period.start
  )[0];
  if (!line) return null;

  const seatCount = Math.max(1, Math.trunc(Number(line.quantity)));
  const startsAt = new Date(line.period.start * 1000).toISOString();
  const endsAt = new Date(line.period.end * 1000).toISOString();
  const durationMonths = Math.max(
    1,
    Math.round((line.period.end - line.period.start) / (30.4375 * 24 * 60 * 60))
  );

  return {
    seatCount,
    startsAt,
    endsAt,
    invoiceCreated: Number.isFinite(invoice.created) ? invoice.created : 0,
    durationMonths,
    stripePriceId: getInvoiceLinePriceId(line),
  };
}

function getInvoiceLinePriceId(line: Stripe.InvoiceLineItem): string | null {
  const legacyPrice = (line as LegacyInvoiceLine).price;
  if (typeof legacyPrice === 'string') return legacyPrice;
  if (legacyPrice?.id) return legacyPrice.id;

  const price = line.pricing?.price_details?.price;
  if (typeof price === 'string') return price;
  return price?.id ?? null;
}

async function getWorkspaceIdForEvent(event: Stripe.Event): Promise<string | null> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    return session.metadata?.workspace_id ?? null;
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    return subscription.metadata?.workspace_id ?? null;
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceSubscriptionId = getInvoiceSubscriptionId(invoice);
    if (!invoiceSubscriptionId) return null;

    const license = await queryOne<{ workspace_id: string }>(
      `SELECT workspace_id FROM licenses WHERE stripe_subscription_id = $1`,
      [invoiceSubscriptionId]
    );
    return license?.workspace_id ?? null;
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceSubscriptionId = getInvoiceSubscriptionId(invoice);
    if (!invoiceSubscriptionId) return null;

    const license = await queryOne<{ workspace_id: string }>(
      `SELECT workspace_id FROM licenses WHERE stripe_subscription_id = $1`,
      [invoiceSubscriptionId]
    );
    return license?.workspace_id ?? null;
  }

  return null;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return errorResponse('Missing stripe-signature header', 400);
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return errorResponse('Webhook not configured', 500);
    }

    const body = await request.text();
    let event: Stripe.Event;

    try {
      event = verifyWebhookSignature(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return errorResponse('Invalid signature', 400);
    }

    const workspaceId = await getWorkspaceIdForEvent(event);
    const platformLicensingEnabled = await isPlatformLicensingEnabled();
    if (!platformLicensingEnabled) {
      return jsonResponse({ received: true, ignored: 'platform_licensing_disabled' });
    }
    if (workspaceId) {
      const settings = await getWorkspaceLicensingSettings(workspaceId);
      if (!settings.effective_licensing_enabled) {
        return jsonResponse({ received: true, ignored: 'workspace_licensing_disabled' });
      }
    }

    const processing = await transaction(async (client) => {
      if (workspaceId) {
        const claim = await client.query<{ id: string }>(
          `INSERT INTO workspace_billing_events
             (id, workspace_id, source, event_id, event_type, payload, created_at)
           VALUES ($1, $2, 'platform_stripe', $3, $4, $5::jsonb, now())
           ON CONFLICT (source, event_id) DO UPDATE
           SET workspace_id = EXCLUDED.workspace_id,
               event_type = EXCLUDED.event_type,
               payload = EXCLUDED.payload
           WHERE workspace_billing_events.processed_at IS NULL
           RETURNING id`,
          [crypto.randomUUID(), workspaceId, event.id, event.type, JSON.stringify(event)]
        );

        // PostgreSQL waits for a concurrent claimant before evaluating the conflict.
        // No returned row therefore means the other transaction completed the event.
        if ((claim.rowCount ?? 0) === 0) {
          return { duplicate: true, afterCommit: null as AfterCommit | null };
        }
      }

      const afterCommit = await processStripeEvent(event, workspaceId, client);

      if (workspaceId) {
        await client.query(
          `UPDATE workspace_billing_events
           SET processed_at = now()
           WHERE source = 'platform_stripe' AND event_id = $1`,
          [event.id]
        );
      }

      return { duplicate: false, afterCommit };
    });

    if (processing.duplicate) {
      return jsonResponse({ received: true, duplicate: true });
    }

    if (processing.afterCommit) {
      try {
        await processing.afterCommit();
      } catch (err) {
        // Core billing state has committed. A provider retry must not replay it merely
        // because optional audit/notification follow-up encountered an error.
        console.error('Stripe webhook post-processing error:', err);
      }
    }

    return jsonResponse({ received: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Stripe webhook error:', err);
    return errorResponse('Internal server error', 500);
  }
}

async function processStripeEvent(
  event: Stripe.Event,
  workspaceId: string | null,
  client: StripeEventClient
): Promise<AfterCommit | null> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, client);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(event.data.object as Stripe.Subscription, client);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event.data.object as Stripe.Subscription, client);
    case 'invoice.payment_failed':
      return handlePaymentFailed(event.data.object as Stripe.Invoice, workspaceId, client);
    case 'invoice.paid':
      return handleInvoicePaid(event.data.object as Stripe.Invoice, client);
    default:
      return null;
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  client: StripeEventClient
): Promise<AfterCommit | null> {
  const workspaceId = session.metadata?.workspace_id;
  if (!workspaceId || !session.subscription) return null;

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription.id;

  // Find the plan by stripe_price_id from line items (use subscription metadata)
  // We stored workspace_id in subscription metadata during checkout
  const plan = await findPlanBySubscription(subscriptionId);
  const seatCountRaw = session.metadata?.seat_count;
  const giftOffsetSeatsRaw = session.metadata?.gift_offset_seats;
  const durationMonthsRaw = session.metadata?.duration_months;
  const seatCount = Number.isFinite(Number(seatCountRaw)) ? Math.max(1, Math.trunc(Number(seatCountRaw))) : 1;
  const giftOffsetSeats = Number.isFinite(Number(giftOffsetSeatsRaw))
    ? Math.max(0, Math.trunc(Number(giftOffsetSeatsRaw)))
    : 0;
  const durationMonths = Number.isFinite(Number(durationMonthsRaw))
    ? Math.max(1, Math.min(60, Math.trunc(Number(durationMonthsRaw))))
    : 1;

  if (plan) {
    await client.query(
      `SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE`,
      [workspaceId]
    );

    const updated = await client.query(
      `UPDATE licenses
       SET plan_id = $1, stripe_subscription_id = $2, status = 'active', updated_at = now()
       WHERE workspace_id = $3`,
      [plan.id, subscriptionId, workspaceId]
    );

    if ((updated.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO licenses (workspace_id, plan_id, stripe_subscription_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [workspaceId, plan.id, subscriptionId]
      );
    }

    await client.query(
      `INSERT INTO license_grants
         (id, workspace_id, source, seat_count, starts_at, ends_at, status, external_ref, metadata)
       SELECT $1, $2, 'stripe', $3, now(), now() + ($4 || ' months')::interval, 'active', $5, $6::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM license_grants WHERE workspace_id = $2 AND source = 'stripe' AND external_ref = $5
       )`,
      [
        crypto.randomUUID(),
        workspaceId,
        seatCount,
        String(durationMonths),
        `subscription:${subscriptionId}`,
        JSON.stringify({
          checkout_session_id: session.id,
          subscription_id: subscriptionId,
          plan_id: plan.id,
          plan_name: plan.name,
        }),
      ]
    );

    if (giftOffsetSeats > 0) {
      const giftInvoiceId = crypto.randomUUID();
      await client.query(
        `INSERT INTO billing_invoices
           (id, workspace_id, invoice_type, status, subtotal_cents, currency, paid_at, source, metadata, created_at, updated_at)
         VALUES ($1, $2, 'workspace_to_superadmin', 'paid', 0, $3, now(), 'stripe_gift_offset', $4::jsonb, now(), now())`,
        [
          giftInvoiceId,
          workspaceId,
          (session.currency ?? 'usd').toLowerCase(),
          JSON.stringify({
            checkout_session_id: session.id,
            gift_offset_seats: giftOffsetSeats,
          }),
        ]
      );
      await client.query(
        `INSERT INTO billing_invoice_items
           (id, invoice_id, description, quantity, unit_amount_cents, period_start, period_end, metadata, created_at)
         VALUES ($1, $2, $3, $4, 0, now(), now() + ($5 || ' months')::interval, $6::jsonb, now())`,
        [
          crypto.randomUUID(),
          giftInvoiceId,
          `Gift offset applied to Stripe checkout ${session.id}`,
          giftOffsetSeats,
          String(durationMonths),
          JSON.stringify({
            gift_offset_seats: giftOffsetSeats,
            checkout_session_id: session.id,
          }),
        ]
      );
    }

    return () => logAudit({
      workspace_id: workspaceId,
      actor_type: 'system',
      visibility_scope: 'privileged',
      action: 'license.activated',
      resource_type: 'license',
      details: {
        plan_name: plan.name,
        subscription_id: subscriptionId,
        seat_count: seatCount,
        gift_offset_seats: giftOffsetSeats,
        duration_months: durationMonths,
      },
    });
  }

  return null;
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  client: StripeEventClient
): Promise<AfterCommit | null> {
  const workspaceId = subscription.metadata?.workspace_id;
  if (!workspaceId) return null;

  const status = mapStripeStatus(subscription.status);
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  // Try to find the plan from subscription items
  const priceId = subscription.items?.data?.[0]?.price?.id;
  let planId: string | null = null;
  if (priceId) {
    const plan = await queryOne<{ id: string }>(
      `SELECT id FROM license_plans WHERE stripe_price_id = $1`,
      [priceId]
    );
    planId = plan?.id ?? null;
  }

  const updateFields: string[] = [
    `status = $1`,
    `current_period_end = $2`,
    `updated_at = now()`,
  ];
  const params: unknown[] = [status, periodEnd];

  if (planId) {
    updateFields.push(`plan_id = $${params.length + 1}`);
    params.push(planId);
  }

  params.push(workspaceId);
  await client.query(
    `UPDATE licenses SET ${updateFields.join(', ')} WHERE workspace_id = $${params.length}`,
    params
  );

  return () => logAudit({
    workspace_id: workspaceId,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'license.updated',
    resource_type: 'license',
    details: { status, subscription_id: subscription.id },
  });
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  client: StripeEventClient
): Promise<AfterCommit | null> {
  const workspaceId = subscription.metadata?.workspace_id;
  if (!workspaceId) return null;

  await client.query(
    `UPDATE licenses
     SET status = 'cancelled', updated_at = now()
     WHERE workspace_id = $1 AND stripe_subscription_id = $2`,
    [workspaceId, subscription.id]
  );

  await client.query(
    `UPDATE license_grants
     SET status = 'cancelled',
         ends_at = CASE
           WHEN ends_at IS NULL THEN now()
           ELSE LEAST(ends_at, now())
         END,
         updated_at = now()
     WHERE workspace_id = $1
       AND status = 'active'
       AND source = 'stripe'
       AND (
         external_ref = $2
         OR external_ref = $3
         OR metadata ->> 'subscription_id' = $2
       )`,
    [workspaceId, subscription.id, `subscription:${subscription.id}`]
  );

  return () => logAudit({
    workspace_id: workspaceId,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'license.cancelled',
    resource_type: 'license',
    details: { subscription_id: subscription.id },
  });
}

async function handlePaymentFailed(
  invoice: Stripe.Invoice,
  workspaceId: string | null,
  client: StripeEventClient
): Promise<AfterCommit | null> {
  const invoiceSubscriptionId = getInvoiceSubscriptionId(invoice);

  if (!invoiceSubscriptionId || !workspaceId) return null;

  await client.query(
    `UPDATE licenses SET status = 'past_due', updated_at = now() WHERE stripe_subscription_id = $1`,
    [invoiceSubscriptionId]
  );

  return async () => {
    await logAudit({
      workspace_id: workspaceId,
      actor_type: 'system',
      visibility_scope: 'privileged',
      action: 'license.payment_failed',
      resource_type: 'license',
      details: { subscription_id: invoiceSubscriptionId, invoice_id: invoice.id },
    });

    const names = await getWorkspaceScopeNames(workspaceId);
    const { subject, html } = buildPaymentFailedEmail(names, invoice.id ?? null, invoiceSubscriptionId);
    await queueAndSendBillingEmail({
      workspaceId,
      notificationType: 'platform_payment_failed',
      dedupeKey: `platform:payment_failed:${invoice.id ?? invoiceSubscriptionId}`,
      subject,
      html,
      payload: {
        invoice_id: invoice.id ?? null,
        subscription_id: invoiceSubscriptionId,
      },
    });
  };
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  client: StripeEventClient
): Promise<AfterCommit | null> {
  const invoiceSubscriptionId = getInvoiceSubscriptionId(invoice);
  if (!invoiceSubscriptionId) return null;

  const licenseResult = await client.query<{
    workspace_id: string;
    status: string;
    stripe_price_id: string | null;
  }>(
    `SELECT l.workspace_id, l.status, lp.stripe_price_id
     FROM licenses l
     JOIN license_plans lp ON lp.id = l.plan_id
     WHERE l.stripe_subscription_id = $1
     FOR UPDATE`,
    [invoiceSubscriptionId]
  );
  const license = licenseResult.rows[0];
  if (!license) {
    throw new Error(`Stripe license not ready for paid invoice ${invoice.id}`);
  }
  if (license.status === 'cancelled') return null;

  const renewal = getInvoiceRenewalPeriod(
    invoice,
    invoiceSubscriptionId,
    license.stripe_price_id
  );
  if (!renewal) {
    throw new Error(`No unambiguous subscription line for paid invoice ${invoice.id}`);
  }

  const grantResult = await client.query<{
    id: string;
    ends_at: string | null;
    status: string;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, ends_at, status, metadata
     FROM license_grants
     WHERE workspace_id = $1
       AND source = 'stripe'
       AND (
         external_ref = $2
         OR external_ref = $3
         OR metadata ->> 'subscription_id' = $2
       )
     ORDER BY ends_at DESC NULLS FIRST, created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [license.workspace_id, invoiceSubscriptionId, `subscription:${invoiceSubscriptionId}`]
  );
  const grant = grantResult.rows[0];

  if (grant) {
    const existingEnd = grant.ends_at ? Date.parse(grant.ends_at) : Number.POSITIVE_INFINITY;
    const renewalEnd = Date.parse(renewal.endsAt);
    const previousInvoiceCreated = Number(grant.metadata?.last_invoice_created ?? 0);
    const isOlderPeriod = renewalEnd < existingEnd;
    const isOlderInvoiceForSamePeriod = renewalEnd === existingEnd
      && renewal.invoiceCreated < previousInvoiceCreated;
    if (grant.status === 'cancelled' || isOlderPeriod || isOlderInvoiceForSamePeriod) {
      return null;
    }
  }

  await client.query(
    `UPDATE licenses
     SET status = 'active', current_period_end = $2, updated_at = now()
     WHERE stripe_subscription_id = $1`,
    [invoiceSubscriptionId, renewal.endsAt]
  );

  const metadata = JSON.stringify({
    invoice_id: invoice.id ?? null,
    subscription_id: invoiceSubscriptionId,
    last_invoice_created: renewal.invoiceCreated,
  });

  if (grant) {
    await client.query(
      `UPDATE license_grants
       SET seat_count = $2,
           starts_at = $3,
           ends_at = $4,
           status = 'active',
           metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [grant.id, renewal.seatCount, renewal.startsAt, renewal.endsAt, metadata]
    );
  } else {
    await client.query(
      `INSERT INTO license_grants
         (id, workspace_id, source, seat_count, starts_at, ends_at, status, external_ref, metadata)
       VALUES ($1, $2, 'stripe', $3, $4, $5, 'active', $6, $7::jsonb)`,
      [
        crypto.randomUUID(),
        license.workspace_id,
        renewal.seatCount,
        renewal.startsAt,
        renewal.endsAt,
        `subscription:${invoiceSubscriptionId}`,
        metadata,
      ]
    );
  }

  return async () => {
    const names = await getWorkspaceScopeNames(license.workspace_id);
    const { subject, html } = buildRenewalEmail(
      names,
      renewal.seatCount,
      renewal.durationMonths,
      invoice.id ?? null
    );
    await queueAndSendBillingEmail({
      workspaceId: license.workspace_id,
      notificationType: 'platform_renewal',
      dedupeKey: `platform:renewal:${invoice.id ?? invoiceSubscriptionId}`,
      subject,
      html,
      payload: {
        invoice_id: invoice.id ?? null,
        subscription_id: invoiceSubscriptionId,
        seat_count: renewal.seatCount,
        duration_months: renewal.durationMonths,
        period_start: renewal.startsAt,
        period_end: renewal.endsAt,
        stripe_price_id: renewal.stripePriceId,
      },
    });
  };
}

async function findPlanBySubscription(subscriptionId: string): Promise<{ id: string; name: string } | null> {
  const { getStripe } = await import('./_lib/stripe.js');
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (!priceId) return null;

  return queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM license_plans WHERE stripe_price_id = $1`,
    [priceId]
  );
}

function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'unpaid':
      return 'cancelled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'inactive';
    default:
      return stripeStatus;
  }
}
