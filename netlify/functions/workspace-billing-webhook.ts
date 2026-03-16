import type { Context } from '@netlify/functions';
import type Stripe from 'stripe';
import { transaction } from './_lib/db.js';
import { getSearchParams, jsonResponse, errorResponse, isValidUuid } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { createWorkspaceStripeClient, getWorkspaceStripeCredentials } from './_lib/workspace-stripe.js';
import { getWorkspaceLicensingSettings } from './_lib/licensing.js';
import {
  buildPaymentFailedEmail,
  buildRenewalEmail,
  getWorkspaceScopeNames,
  queueAndSendBillingEmail,
} from './_lib/billing-notifications.js';

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getWorkspaceIdFromEventMetadata(event: Stripe.Event): string | null {
  const object = event.data.object as Stripe.Event.Data.Object & {
    metadata?: Record<string, string>;
    subscription_details?: { metadata?: Record<string, string> };
    parent?: { subscription_details?: { metadata?: Record<string, string> } };
  };

  const direct = object.metadata?.workspace_id;
  if (direct) return direct;

  const fromSubscriptionDetails = object.subscription_details?.metadata?.workspace_id;
  if (fromSubscriptionDetails) return fromSubscriptionDetails;

  const fromParentSubscriptionDetails = object.parent?.subscription_details?.metadata?.workspace_id;
  if (fromParentSubscriptionDetails) return fromParentSubscriptionDetails;

  return null;
}

async function markWorkspaceEventProcessed(workspaceId: string, eventId: string): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `UPDATE workspace_billing_events
       SET processed_at = now()
       WHERE workspace_id = $1
         AND source = 'workspace_stripe'
         AND event_id = $2`,
      [workspaceId, eventId]
    );
  });
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const params = getSearchParams(request);
    const workspaceId = params.get('workspace_id');
    if (!workspaceId) return errorResponse('workspace_id is required in query string');
    if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');
    const licensing = await getWorkspaceLicensingSettings(workspaceId);
    if (!licensing.effective_licensing_enabled) {
      return jsonResponse({ received: true, ignored: 'licensing_disabled' });
    }

    const signature = request.headers.get('stripe-signature');
    if (!signature) return errorResponse('Missing stripe-signature header', 400);

    const creds = await getWorkspaceStripeCredentials(workspaceId);
    if (creds.mode !== 'stripe' || !creds.secretKey || !creds.webhookSecret) {
      return errorResponse('Workspace Stripe webhook is not configured', 400);
    }
    const stripe = createWorkspaceStripeClient(creds.secretKey);

    const rawBody = await request.text();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, creds.webhookSecret);
    } catch {
      return errorResponse('Invalid signature', 400);
    }

    const metadataWorkspaceId = getWorkspaceIdFromEventMetadata(event);
    if (!metadataWorkspaceId || metadataWorkspaceId !== workspaceId) {
      return errorResponse('workspace_id does not match signed event metadata', 403);
    }

    const inserted = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO workspace_billing_events
           (id, workspace_id, source, event_id, event_type, payload, created_at)
         VALUES ($1, $2, 'workspace_stripe', $3, $4, $5::jsonb, now())
         ON CONFLICT (source, event_id) DO NOTHING`,
        [crypto.randomUUID(), workspaceId, event.id, event.type, JSON.stringify(event)]
      );
      return (result.rowCount ?? 0) > 0;
    });

    if (!inserted) {
      return jsonResponse({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata ?? {};
      const environmentId = metadata.environment_id;
      if (!environmentId) {
        await markWorkspaceEventProcessed(workspaceId, event.id);
        return jsonResponse({ received: true, ignored: 'missing environment_id metadata' });
      }

      const seatCount = toPositiveInt(metadata.seat_count, 1);
      const durationMonths = toPositiveInt(metadata.duration_months, 1);
      const billingMode = String(metadata.billing_mode ?? '').toLowerCase();

      // For recurring subscription mode, entitlements are granted on invoice.paid renewals.
      // Keep legacy one-time checkout entitlement grants for pre-existing payment-mode sessions.
      if (billingMode === 'subscription') {
        await markWorkspaceEventProcessed(workspaceId, event.id);
        return jsonResponse({ received: true, deferred: 'awaiting_invoice_paid' });
      }

      const granted = await transaction(async (client) => {
        const envResult = await client.query<{ workspace_id: string }>(
          `SELECT workspace_id
           FROM environments
           WHERE id = $1`,
          [environmentId]
        );
        const env = envResult.rows[0];
        if (!env || env.workspace_id !== workspaceId) {
          await client.query(
            `UPDATE workspace_billing_events
             SET processed_at = now()
             WHERE source = 'workspace_stripe' AND event_id = $1`,
            [event.id]
          );
          return false;
        }

        await client.query(
          `INSERT INTO environment_entitlements
             (id, workspace_id, environment_id, source, seat_count, starts_at, ends_at, status, external_ref, metadata)
           VALUES ($1, $2, $3, 'workspace_customer_payment', $4, now(), now() + ($5 || ' months')::interval, 'active', $6, $7::jsonb)`,
          [
            crypto.randomUUID(),
            workspaceId,
            environmentId,
            seatCount,
            String(durationMonths),
            session.id,
            JSON.stringify({
              event_id: event.id,
              workspace_customer_id: metadata.workspace_customer_id ?? null,
              pricing_id: metadata.pricing_id ?? null,
            }),
          ]
        );

        await client.query(
          `UPDATE workspace_billing_events
           SET processed_at = now()
           WHERE source = 'workspace_stripe' AND event_id = $1`,
          [event.id]
        );
        return true;
      });

      if (!granted) {
        return jsonResponse({ received: true, ignored: 'environment is not in workspace scope' });
      }

      await logAudit({
        workspace_id: workspaceId,
        environment_id: environmentId,
        actor_type: 'system',
        visibility_scope: 'privileged',
        action: 'workspace_billing.entitlement.granted',
        resource_type: 'environment_entitlement',
        details: {
          event_id: event.id,
          seat_count: seatCount,
          duration_months: durationMonths,
          checkout_session_id: session.id,
        },
      });
    } else if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;
      if (!subscriptionId) {
        await markWorkspaceEventProcessed(workspaceId, event.id);
        return jsonResponse({ received: true, ignored: 'missing subscription on invoice' });
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const metadata = subscription.metadata ?? {};
      const environmentId = metadata.environment_id;
      if (!environmentId) {
        await markWorkspaceEventProcessed(workspaceId, event.id);
        return jsonResponse({ received: true, ignored: 'missing environment_id metadata' });
      }

      const seatCount = toPositiveInt(metadata.seat_count, 1);
      const durationMonths = toPositiveInt(metadata.duration_months, 1);

      const granted = await transaction(async (client) => {
        const envResult = await client.query<{ workspace_id: string }>(
          `SELECT workspace_id
           FROM environments
           WHERE id = $1`,
          [environmentId]
        );
        const env = envResult.rows[0];
        if (!env || env.workspace_id !== workspaceId) {
          await client.query(
            `UPDATE workspace_billing_events
             SET processed_at = now()
             WHERE source = 'workspace_stripe' AND event_id = $1`,
            [event.id]
          );
          return false;
        }

        await client.query(
          `INSERT INTO environment_entitlements
             (id, workspace_id, environment_id, source, seat_count, starts_at, ends_at, status, external_ref, metadata)
           VALUES ($1, $2, $3, 'workspace_customer_payment', $4, now(), now() + ($5 || ' months')::interval, 'active', $6, $7::jsonb)`,
          [
            crypto.randomUUID(),
            workspaceId,
            environmentId,
            seatCount,
            String(durationMonths),
            invoice.id,
            JSON.stringify({
              event_id: event.id,
              invoice_id: invoice.id,
              subscription_id: subscriptionId,
              workspace_customer_id: metadata.workspace_customer_id ?? null,
              pricing_id: metadata.pricing_id ?? null,
              billing_mode: metadata.billing_mode ?? null,
            }),
          ]
        );

        await client.query(
          `UPDATE workspace_billing_events
           SET processed_at = now()
           WHERE source = 'workspace_stripe' AND event_id = $1`,
          [event.id]
        );
        return true;
      });

      if (!granted) {
        return jsonResponse({ received: true, ignored: 'environment is not in workspace scope' });
      }

      await logAudit({
        workspace_id: workspaceId,
        environment_id: environmentId,
        actor_type: 'system',
        visibility_scope: 'privileged',
        action: 'workspace_billing.entitlement.renewed',
        resource_type: 'environment_entitlement',
        details: {
          event_id: event.id,
          seat_count: seatCount,
          duration_months: durationMonths,
          invoice_id: invoice.id,
          subscription_id: subscriptionId,
        },
      });
      const names = await getWorkspaceScopeNames(workspaceId, environmentId);
      const { subject, html } = buildRenewalEmail(names, seatCount, durationMonths, invoice.id ?? null);
      await queueAndSendBillingEmail({
        workspaceId,
        environmentId,
        notificationType: 'workspace_renewal',
        dedupeKey: `workspace:renewal:${event.id}`,
        subject,
        html,
        payload: {
          event_id: event.id,
          invoice_id: invoice.id ?? null,
          subscription_id: subscriptionId,
          seat_count: seatCount,
          duration_months: durationMonths,
        },
        includeEnvironmentCustomer: true,
      });
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;
      if (!subscriptionId) {
        await markWorkspaceEventProcessed(workspaceId, event.id);
        return jsonResponse({ received: true, ignored: 'missing subscription on invoice' });
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const metadata = subscription.metadata ?? {};
      const environmentId = metadata.environment_id ?? null;

      await markWorkspaceEventProcessed(workspaceId, event.id);
      const names = await getWorkspaceScopeNames(workspaceId, environmentId);
      const { subject, html } = buildPaymentFailedEmail(
        names,
        invoice.id ?? null,
        subscriptionId
      );
      await queueAndSendBillingEmail({
        workspaceId,
        environmentId,
        notificationType: 'workspace_payment_failed',
        dedupeKey: `workspace:payment_failed:${event.id}`,
        subject,
        html,
        payload: {
          event_id: event.id,
          invoice_id: invoice.id ?? null,
          subscription_id: subscriptionId,
        },
        includeEnvironmentCustomer: Boolean(environmentId),
      });
    } else {
      await transaction(async (client) => {
        await client.query(
          `UPDATE workspace_billing_events
           SET processed_at = now()
           WHERE source = 'workspace_stripe' AND event_id = $1`,
          [event.id]
        );
      });
    }

    return jsonResponse({ received: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('workspace-billing-webhook error:', err);
    return errorResponse('Internal server error', 500);
  }
}
