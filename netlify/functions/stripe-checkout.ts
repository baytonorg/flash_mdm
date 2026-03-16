import type { Context } from '@netlify/functions';
import { requireAuth } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { requireWorkspaceResourcePermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, parseJsonBody, isValidUuid } from './_lib/helpers.js';
import { getStripe, createCheckoutSession } from './_lib/stripe.js';
import { logAudit } from './_lib/audit.js';
import { getWorkspaceAvailableGiftSeats, getWorkspaceLicensingSettings } from './_lib/licensing.js';

interface CheckoutBody {
  workspace_id: string;
  plan_id: string;
  seat_count?: number;
  duration_months?: number;
}

interface WorkspaceBillingCustomerDefaults {
  billing_contact_name: string | null;
  billing_business_name: string | null;
  billing_email: string | null;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return errorResponse('Stripe is not configured. Set STRIPE_SECRET_KEY to enable licensing.', 503);
    }

    const auth = await requireAuth(request);
    const body = await parseJsonBody<CheckoutBody>(request);

    if (!body.workspace_id || !body.plan_id) {
      return errorResponse('workspace_id and plan_id are required');
    }
    if (!isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');
    if (!isValidUuid(body.plan_id)) return errorResponse('plan_id must be a valid UUID');

    if (auth.authType === 'api_key') {
      return errorResponse('API keys cannot create Stripe checkout sessions', 403);
    }
    await requireWorkspaceResourcePermission(auth, body.workspace_id, 'workspace', 'read');
    const settings = await getWorkspaceLicensingSettings(body.workspace_id);
    if (!settings.effective_licensing_enabled) {
      return errorResponse('Licensing is disabled for this workspace', 409);
    }
    await requireWorkspaceResourcePermission(auth, body.workspace_id, 'billing', 'billing_manage');

    // Look up the plan
    const plan = await queryOne<{ id: string; name: string; stripe_price_id: string | null; features: Record<string, unknown> | null }>(
      `SELECT id, name, stripe_price_id, features FROM license_plans WHERE id = $1`,
      [body.plan_id]
    );
    if (!plan) {
      return errorResponse('Plan not found', 404);
    }
    if (plan.features?.hidden === true) {
      return errorResponse('Plan is hidden and unavailable for new purchases', 409);
    }
    if (!plan.stripe_price_id) {
      return errorResponse('This plan does not support online checkout');
    }

    // Get or create Stripe customer for workspace
    const workspace = await queryOne<{ id: string; name: string; stripe_customer_id: string | null }>(
      `SELECT id, name, stripe_customer_id FROM workspaces WHERE id = $1`,
      [body.workspace_id]
    );
    if (!workspace) {
      return errorResponse('Workspace not found', 404);
    }

    const customerDefaults = await queryOne<WorkspaceBillingCustomerDefaults>(
      `SELECT billing_contact_name, billing_business_name, billing_email
       FROM workspace_billing_settings
       WHERE workspace_id = $1`,
      [body.workspace_id]
    );
    const resolvedCustomerName = customerDefaults?.billing_business_name?.trim()
      || customerDefaults?.billing_contact_name?.trim()
      || workspace.name;
    const resolvedCustomerEmail = customerDefaults?.billing_email?.trim() || undefined;

    let customerId = workspace.stripe_customer_id;
    const stripe = getStripe();
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: resolvedCustomerName,
        email: resolvedCustomerEmail,
        metadata: {
          workspace_id: workspace.id,
          billing_contact_name: customerDefaults?.billing_contact_name ?? '',
          billing_business_name: customerDefaults?.billing_business_name ?? '',
          billing_email: customerDefaults?.billing_email ?? '',
        },
      });
      customerId = customer.id;
      await query(
        `UPDATE workspaces SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, workspace.id]
      );
    } else if (resolvedCustomerName || resolvedCustomerEmail) {
      await stripe.customers.update(customerId, {
        name: resolvedCustomerName || undefined,
        email: resolvedCustomerEmail,
      });
    }

    // Create checkout session
    const origin = new URL(request.url).origin;
    const returnUrl = `${origin}/licenses`;
    const rawSeatCount = Number(body.seat_count);
    const normalizedSeatCount = Number.isFinite(rawSeatCount) ? rawSeatCount : 1;
    const seatCount = Math.max(1, Math.min(100_000, Math.trunc(normalizedSeatCount)));
    const availableGiftSeats = await getWorkspaceAvailableGiftSeats(body.workspace_id);
    const giftedOffsetSeats = Math.min(seatCount, availableGiftSeats);
    const billableSeatCount = Math.max(0, seatCount - giftedOffsetSeats);
    if (billableSeatCount <= 0) {
      return errorResponse('Requested seats are fully covered by gifted seats. No Stripe payment is required.', 409);
    }
    const rawDurationMonths = Number(body.duration_months);
    const normalizedDurationMonths = Number.isFinite(rawDurationMonths) ? rawDurationMonths : 1;
    const durationMonths = Math.max(1, Math.min(60, Math.trunc(normalizedDurationMonths)));
    const checkoutUrl = await createCheckoutSession(
      body.workspace_id,
      plan.stripe_price_id,
      customerId,
      returnUrl,
      {
        quantity: billableSeatCount,
        metadata: {
          seat_count: String(billableSeatCount),
          requested_seat_count: String(seatCount),
          gift_offset_seats: String(giftedOffsetSeats),
          duration_months: String(durationMonths),
          plan_id: plan.id,
        },
      }
    );

    await logAudit({
      workspace_id: body.workspace_id,
      user_id: auth.user.id,
      action: 'stripe.checkout.created',
      resource_type: 'license',
      details: {
        plan_id: body.plan_id,
        plan_name: plan.name,
        seat_count: billableSeatCount,
        requested_seat_count: seatCount,
        gift_offset_seats: giftedOffsetSeats,
        duration_months: durationMonths,
      },
    });

    return jsonResponse({ checkout_url: checkoutUrl });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Stripe checkout error:', err);
    return errorResponse('Internal server error', 500);
  }
}
