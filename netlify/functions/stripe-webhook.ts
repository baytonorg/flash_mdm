import type { Context } from '@netlify/functions';
import { queryOne, execute, transaction } from './_lib/db.js';
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
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;
    if (!subscriptionId) return null;

    const license = await queryOne<{ workspace_id: string }>(
      `SELECT workspace_id FROM licenses WHERE stripe_subscription_id = $1`,
      [subscriptionId]
    );
    return license?.workspace_id ?? null;
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;
    if (!subscriptionId) return null;

    const license = await queryOne<{ workspace_id: string }>(
      `SELECT workspace_id FROM licenses WHERE stripe_subscription_id = $1`,
      [subscriptionId]
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

    const existingEvent = await queryOne<{ id: string }>(
      `SELECT id
       FROM workspace_billing_events
       WHERE source = 'platform_stripe'
         AND event_id = $1`,
      [event.id]
    );
    if (existingEvent) {
      return jsonResponse({ received: true, duplicate: true });
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

    if (workspaceId) {
      const dedupeResult = await execute(
        `INSERT INTO workspace_billing_events
           (id, workspace_id, source, event_id, event_type, payload, created_at)
         VALUES ($1, $2, 'platform_stripe', $3, $4, $5::jsonb, now())
         ON CONFLICT (source, event_id) DO NOTHING`,
        [crypto.randomUUID(), workspaceId, event.id, event.type, JSON.stringify(event)]
      );

      if (typeof dedupeResult.rowCount === 'number' && dedupeResult.rowCount === 0) {
        return jsonResponse({ received: true, duplicate: true });
      }
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }
      default:
        // Unhandled event type — acknowledge receipt
        break;
    }

    return jsonResponse({ received: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Stripe webhook error:', err);
    return errorResponse('Internal server error', 500);
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const workspaceId = session.metadata?.workspace_id;
  if (!workspaceId || !session.subscription) return;

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
    // Serialize writes per workspace to avoid duplicate rows when Stripe retries.
    await transaction(async (client) => {
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
    });

    await logAudit({
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
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId = subscription.metadata?.workspace_id;
  if (!workspaceId) return;

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
  await execute(
    `UPDATE licenses SET ${updateFields.join(', ')} WHERE workspace_id = $${params.length}`,
    params
  );

  await logAudit({
    workspace_id: workspaceId,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'license.updated',
    resource_type: 'license',
    details: { status, subscription_id: subscription.id },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId = subscription.metadata?.workspace_id;
  if (!workspaceId) return;

  await transaction(async (client) => {
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
  });

  await logAudit({
    workspace_id: workspaceId,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'license.cancelled',
    resource_type: 'license',
    details: { subscription_id: subscription.id },
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;

  if (!subscriptionId) return;

  const license = await queryOne<{ workspace_id: string }>(
    `SELECT workspace_id FROM licenses WHERE stripe_subscription_id = $1`,
    [subscriptionId]
  );
  if (!license) return;

  await execute(
    `UPDATE licenses SET status = 'past_due', updated_at = now() WHERE stripe_subscription_id = $1`,
    [subscriptionId]
  );

  await logAudit({
    workspace_id: license.workspace_id,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'license.payment_failed',
    resource_type: 'license',
    details: { subscription_id: subscriptionId, invoice_id: invoice.id },
  });

  const names = await getWorkspaceScopeNames(license.workspace_id);
  const { subject, html } = buildPaymentFailedEmail(names, invoice.id ?? null, subscriptionId);
  await queueAndSendBillingEmail({
    workspaceId: license.workspace_id,
    notificationType: 'platform_payment_failed',
    dedupeKey: `platform:payment_failed:${invoice.id ?? subscriptionId}`,
    subject,
    html,
    payload: {
      invoice_id: invoice.id ?? null,
      subscription_id: subscriptionId,
    },
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subscriptionId) return;

  const license = await queryOne<{ workspace_id: string }>(
    `SELECT workspace_id FROM licenses WHERE stripe_subscription_id = $1`,
    [subscriptionId]
  );
  if (!license) return;

  const item = invoice.lines?.data?.[0];
  const seatCount = Math.max(1, Number.parseInt(String(item?.quantity ?? 1), 10) || 1);
  const durationMonths = 1;
  const names = await getWorkspaceScopeNames(license.workspace_id);
  const { subject, html } = buildRenewalEmail(
    names,
    seatCount,
    durationMonths,
    invoice.id ?? null
  );
  await queueAndSendBillingEmail({
    workspaceId: license.workspace_id,
    notificationType: 'platform_renewal',
    dedupeKey: `platform:renewal:${invoice.id ?? subscriptionId}`,
    subject,
    html,
    payload: {
      invoice_id: invoice.id ?? null,
      subscription_id: subscriptionId,
      seat_count: seatCount,
      duration_months: durationMonths,
    },
  });
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
