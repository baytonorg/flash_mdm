import type { Context } from '@netlify/functions';
import { execute, query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission, requireWorkspaceResourcePermission } from './_lib/rbac.js';
import { getSearchParams, jsonResponse, errorResponse, parseJsonBody, isValidUuid, getClientIp } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { getWorkspaceAvailableGiftSeats, getWorkspaceLicensingSettings } from './_lib/licensing.js';
import { getStripe } from './_lib/stripe.js';

interface InvoiceRequestBody {
  workspace_id: string;
  plan_id: string;
  seat_count: number;
  duration_months: number;
  due_days?: number;
}

const INT32_MAX = 2_147_483_647;
const MAX_INVOICE_SEAT_COUNT = 1_000_000;
const MAX_INVOICE_DURATION_MONTHS = 120;

function normalizePlanIntervalMonths(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 1;
  return parsed;
}

async function resolvePlanBilling(plan: {
  id: string;
  name: string;
  stripe_price_id: string | null;
  features: Record<string, unknown> | null;
}): Promise<{ unitAmountCents: number; currency: string }> {
  if (plan.stripe_price_id) {
    try {
      const price = await getStripe().prices.retrieve(plan.stripe_price_id);
      const unitAmount = price.unit_amount ?? null;
      if (Number.isInteger(unitAmount) && unitAmount >= 0) {
        const currency = (price.currency ?? 'usd').toLowerCase();
        return { unitAmountCents: unitAmount, currency };
      }
    } catch (err) {
      console.warn('Failed to resolve Stripe unit price for plan invoice fallback', {
        plan_id: plan.id,
        stripe_price_id: plan.stripe_price_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const featureUnitAmount = Number(plan.features?.invoice_unit_amount_cents);
  if (Number.isInteger(featureUnitAmount) && featureUnitAmount >= 0) {
    const featureCurrencyRaw = String(plan.features?.currency ?? 'usd').trim();
    const currency = (featureCurrencyRaw || 'usd').toLowerCase();
    return { unitAmountCents: featureUnitAmount, currency };
  }

  throw new Response(
    JSON.stringify({ error: 'Plan invoice pricing is not configured for this platform plan' }),
    {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function resolveActionPath(pathname: string): 'list' | 'invoice_request' | 'unknown' {
  if (pathname.endsWith('/grants')) return 'list';
  if (pathname.endsWith('/grants/invoice-request')) return 'invoice_request';
  if (pathname.endsWith('/license-grants')) return 'list';
  if (pathname.endsWith('/license-grants/invoice-request')) return 'invoice_request';
  return 'unknown';
}

export default async function handler(request: Request, _context: Context) {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const action = resolveActionPath(url.pathname);

    if (request.method === 'GET' && action === 'list') {
      const params = getSearchParams(request);
      const workspaceId = params.get('workspace_id')
        ?? (auth.authType === 'api_key' ? auth.apiKey?.workspace_id ?? null : auth.user.workspace_id);
      if (!workspaceId) return errorResponse('workspace_id is required');
      if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');

      try {
        await requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', 'read');
      } catch (err) {
        if (!(err instanceof Response) || err.status !== 403 || auth.authType !== 'session') throw err;
        const activeEnvironmentId = auth.user.environment_id;
        if (!activeEnvironmentId) throw err;
        const matchingEnvironment = await queryOne<{ id: string }>(
          'SELECT id FROM environments WHERE id = $1 AND workspace_id = $2',
          [activeEnvironmentId, workspaceId]
        );
        if (!matchingEnvironment) throw err;
        await requireEnvironmentPermission(auth, activeEnvironmentId, 'read');
      }
      const settings = await getWorkspaceLicensingSettings(workspaceId);
      if (!settings.effective_licensing_enabled) {
        return jsonResponse({ grants: [], invoices: [], licensing_enabled: false });
      }
      await requireWorkspaceResourcePermission(auth, workspaceId, 'billing', 'license_view');

      const [grants, invoices] = await Promise.all([
        query<{
          id: string;
          source: string;
          seat_count: number;
          starts_at: string;
          ends_at: string | null;
          status: string;
          external_ref: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        }>(
          `SELECT id, source, seat_count, starts_at, ends_at, status, external_ref, metadata, created_at
           FROM license_grants
           WHERE workspace_id = $1
           ORDER BY starts_at DESC, created_at DESC`,
          [workspaceId]
        ),
        query<{
          id: string;
          invoice_type: string;
          status: string;
          subtotal_cents: number;
          currency: string;
          due_at: string | null;
          paid_at: string | null;
          source: string | null;
          created_at: string;
        }>(
          `SELECT id, invoice_type, status, subtotal_cents, currency, due_at, paid_at, source, created_at
           FROM billing_invoices
           WHERE workspace_id = $1
           ORDER BY created_at DESC`,
          [workspaceId]
        ),
      ]);

      return jsonResponse({ grants, invoices });
    }

    if (request.method === 'POST' && action === 'invoice_request') {
      if (auth.authType === 'api_key') {
        return errorResponse('API keys cannot create invoice requests', 403);
      }

      const body = await parseJsonBody<InvoiceRequestBody>(request);
      if (!body.workspace_id || !isValidUuid(body.workspace_id)) {
        return errorResponse('workspace_id must be a valid UUID');
      }
      if (!body.plan_id || !isValidUuid(body.plan_id)) {
        return errorResponse('plan_id must be a valid UUID');
      }
      if (!Number.isInteger(body.seat_count) || body.seat_count <= 0) {
        return errorResponse('seat_count must be a positive integer');
      }
      if (!Number.isInteger(body.duration_months) || body.duration_months <= 0) {
        return errorResponse('duration_months must be a positive integer');
      }
      if (body.seat_count > MAX_INVOICE_SEAT_COUNT) {
        return errorResponse('seat_count is too large');
      }
      if (body.duration_months > MAX_INVOICE_DURATION_MONTHS) {
        return errorResponse(`duration_months must be <= ${MAX_INVOICE_DURATION_MONTHS}`);
      }

      await requireWorkspaceResourcePermission(auth, body.workspace_id, 'workspace', 'read');
      const settings = await getWorkspaceLicensingSettings(body.workspace_id);
      if (!settings.effective_licensing_enabled) {
        return errorResponse('Licensing is disabled for this workspace', 409);
      }
      await requireWorkspaceResourcePermission(auth, body.workspace_id, 'billing', 'billing_manage');

      const workspace = await queryOne<{ id: string }>('SELECT id FROM workspaces WHERE id = $1', [body.workspace_id]);
      if (!workspace) return errorResponse('Workspace not found', 404);
      const plan = await queryOne<{
        id: string;
        name: string;
        stripe_price_id: string | null;
        features: Record<string, unknown> | null;
      }>(
        `SELECT id, name, stripe_price_id, features
         FROM license_plans
         WHERE id = $1`,
        [body.plan_id]
      );
      if (!plan) return errorResponse('Plan not found', 404);
      if (plan.features?.hidden === true) {
        return errorResponse('Plan is hidden and unavailable for new invoice requests', 409);
      }

      const { unitAmountCents, currency } = await resolvePlanBilling(plan);

      const invoiceId = crypto.randomUUID();
      const availableGiftSeats = await getWorkspaceAvailableGiftSeats(body.workspace_id);
      const giftOffsetSeats = Math.min(body.seat_count, availableGiftSeats);
      const billableSeats = Math.max(0, body.seat_count - giftOffsetSeats);
      const planIntervalMonths = normalizePlanIntervalMonths(plan.features?.stripe_interval_months);
      const billingIntervals = Math.max(1, Math.ceil(body.duration_months / planIntervalMonths));
      const subtotal = billableSeats * unitAmountCents * billingIntervals;
      if (!Number.isSafeInteger(subtotal) || subtotal > INT32_MAX) {
        return errorResponse('invoice subtotal exceeds maximum supported value');
      }
      const dueDays = Math.max(1, Math.min(90, body.due_days ?? 30));
      const dueAt = new Date(Date.now() + dueDays * 86_400_000).toISOString();
      const invoiceStatus = subtotal === 0 ? 'paid' : 'pending';

      await execute(
        `INSERT INTO billing_invoices
           (id, workspace_id, invoice_type, status, subtotal_cents, currency, due_at, paid_at, source, metadata, created_by)
         VALUES ($1, $2, 'workspace_to_superadmin', $3, $4, $5, $6, $7, 'workspace_request', $8::jsonb, $9)`,
        [
          invoiceId,
          body.workspace_id,
          invoiceStatus,
          subtotal,
          currency,
          invoiceStatus === 'paid' ? null : dueAt,
          invoiceStatus === 'paid' ? new Date().toISOString() : null,
          JSON.stringify({
            seat_count: body.seat_count,
            billable_seat_count: billableSeats,
            gift_offset_seats: giftOffsetSeats,
            plan_id: plan.id,
            plan_name: plan.name,
            duration_months: body.duration_months,
            billing_intervals: billingIntervals,
            plan_interval_months: planIntervalMonths,
            unit_amount_cents: unitAmountCents,
          }),
          auth.user.id,
        ]
      );

      await execute(
        `INSERT INTO billing_invoice_items
           (id, invoice_id, description, quantity, unit_amount_cents, period_start, period_end, metadata)
         VALUES ($1, $2, $3, $4, $5, now(), now() + ($6 || ' months')::interval, $7::jsonb)`,
        [
          crypto.randomUUID(),
          invoiceId,
          `${plan.name}: ${body.seat_count} seats for ${body.duration_months} month(s)`,
          billableSeats * billingIntervals,
          unitAmountCents,
          String(body.duration_months),
          JSON.stringify({
            seat_count: body.seat_count,
            billable_seat_count: billableSeats,
            gift_offset_seats: giftOffsetSeats,
            plan_id: plan.id,
            plan_name: plan.name,
            duration_months: body.duration_months,
            billing_intervals: billingIntervals,
            plan_interval_months: planIntervalMonths,
          }),
        ]
      );

      await logAudit({
        workspace_id: body.workspace_id,
        user_id: auth.user.id,
        action: 'license.invoice.requested',
        resource_type: 'invoice',
        resource_id: invoiceId,
        details: {
          seat_count: body.seat_count,
          billable_seat_count: billableSeats,
          gift_offset_seats: giftOffsetSeats,
          plan_id: plan.id,
          plan_name: plan.name,
          duration_months: body.duration_months,
          billing_intervals: billingIntervals,
          plan_interval_months: planIntervalMonths,
          subtotal_cents: subtotal,
          unit_amount_cents: unitAmountCents,
          currency,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        message: 'Invoice request submitted',
        invoice_id: invoiceId,
        status: invoiceStatus,
        gift_offset_seats: giftOffsetSeats,
        billable_seat_count: billableSeats,
      }, 201);
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('license-grants error:', err);
    return errorResponse('Internal server error', 500);
  }
}
