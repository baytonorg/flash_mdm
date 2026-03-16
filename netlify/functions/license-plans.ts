import type { Context } from '@netlify/functions';
import { execute, query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { getSearchParams, jsonResponse, errorResponse, isValidUuid, getClientIp, parseJsonBody } from './_lib/helpers.js';
import { requireEnvironmentPermission, requireWorkspaceResourcePermission } from './_lib/rbac.js';
import { getWorkspaceLicensingSettings } from './_lib/licensing.js';
import { getStripe } from './_lib/stripe.js';
import { logAudit } from './_lib/audit.js';

interface UpsertLicensePlanBody {
  id?: string;
  name: string;
  max_devices: number;
  stripe_price_id?: string | null;
  unit_amount_cents: number;
  currency: string;
  create_stripe_price?: boolean;
  stripe_interval_months?: number;
  features?: Record<string, unknown>;
}

const ALLOWED_STRIPE_INTERVAL_MONTHS = [1, 12, 24, 36] as const;
const STRIPE_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

type StripePrice = Awaited<ReturnType<ReturnType<typeof getStripe>['prices']['retrieve']>>;

const stripePriceCache = new Map<string, { expiresAt: number; price: StripePrice }>();

async function getStripePriceCached(stripePriceId: string): Promise<StripePrice> {
  const now = Date.now();
  const cached = stripePriceCache.get(stripePriceId);
  if (cached) {
    if (cached.expiresAt > now) return cached.price;
    stripePriceCache.delete(stripePriceId);
  }

  const price = await getStripe().prices.retrieve(stripePriceId);
  stripePriceCache.set(stripePriceId, {
    price,
    expiresAt: Date.now() + STRIPE_PRICE_CACHE_TTL_MS,
  });
  return price;
}

function normalizeStripeIntervalMonths(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return ALLOWED_STRIPE_INTERVAL_MONTHS[0];
  if ((ALLOWED_STRIPE_INTERVAL_MONTHS as readonly number[]).includes(parsed)) return parsed;
  return ALLOWED_STRIPE_INTERVAL_MONTHS[0];
}

function normalizeStripePriceIdInput(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

export default async function handler(request: Request, _context: Context) {
  try {
    const auth = await requireAuth(request);
    if (request.method === 'GET') {
      const isSuperadmin = auth.authType === 'session' && auth.user.is_superadmin;
      const params = getSearchParams(request);
      const requestedWorkspaceId = params.get('workspace_id');
      let workspaceId: string | null = null;
      if (!isSuperadmin || requestedWorkspaceId) {
        workspaceId = requestedWorkspaceId
          ?? (auth.authType === 'api_key' ? auth.apiKey?.workspace_id ?? null : auth.user.workspace_id);
        if (!workspaceId) return errorResponse('workspace_id is required');
        if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');

        if (!isSuperadmin) {
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
        }
        const settings = await getWorkspaceLicensingSettings(workspaceId);
        if (settings.effective_licensing_enabled) {
          if (!isSuperadmin) {
            await requireWorkspaceResourcePermission(auth, workspaceId, 'billing', 'license_view');
          }
        } else {
          return jsonResponse({ plans: [], licensing_enabled: false });
        }
      }

      const plans = await query<{
        id: string;
        name: string;
        max_devices: number;
        stripe_price_id: string | null;
        features: Record<string, unknown>;
        created_at: string;
      }>(
        `SELECT id, name, max_devices, stripe_price_id, features, created_at
         FROM license_plans
         ORDER BY CASE name WHEN 'Free' THEN 1 WHEN 'Pro' THEN 2 WHEN 'Enterprise' THEN 3 ELSE 99 END, created_at`
      );

      const plansWithPricing = await Promise.all(
        plans.map(async (plan) => {
          let unitAmountCents = Number(plan.features?.invoice_unit_amount_cents ?? plan.features?.unit_amount_cents);
          if (!Number.isInteger(unitAmountCents) || unitAmountCents < 0) {
            unitAmountCents = 0;
          }
          let currency = String(plan.features?.currency ?? 'usd').toLowerCase();
          let stripeIntervalMonths = normalizeStripeIntervalMonths(plan.features?.stripe_interval_months);

          if (plan.stripe_price_id) {
            try {
              const price = await getStripePriceCached(plan.stripe_price_id);
              if (Number.isInteger(price.unit_amount) && (price.unit_amount ?? 0) >= 0) {
                unitAmountCents = price.unit_amount as number;
              }
              if (price.currency) {
                currency = price.currency.toLowerCase();
              }
              if (price.recurring?.interval === 'month' && Number.isInteger(price.recurring?.interval_count)) {
                stripeIntervalMonths = normalizeStripeIntervalMonths(price.recurring.interval_count);
              }
            } catch (err) {
              console.warn('license-plans: failed to resolve Stripe price metadata', {
                plan_id: plan.id,
                stripe_price_id: plan.stripe_price_id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          return {
            ...plan,
            unit_amount_cents: unitAmountCents,
            currency,
            stripe_interval_months: stripeIntervalMonths,
          };
        })
      );

      const includeHiddenPlans = isSuperadmin && !workspaceId;
      const visiblePlans = includeHiddenPlans
        ? plansWithPricing
        : plansWithPricing.filter((plan) => plan.features?.hidden !== true);

      return jsonResponse({ plans: visiblePlans });
    }

    if (request.method === 'PUT') {
      if (auth.authType !== 'session' || !auth.user.is_superadmin) {
        return errorResponse('Only platform admins can update plans', 403);
      }

      const body = await parseJsonBody<UpsertLicensePlanBody>(request);
      const name = body.name?.trim();
      if (!name) return errorResponse('name is required');
      if (!Number.isInteger(body.max_devices)) return errorResponse('max_devices must be an integer');
      if (!Number.isInteger(body.unit_amount_cents) || body.unit_amount_cents < 0) {
        return errorResponse('unit_amount_cents must be a non-negative integer');
      }
      const currency = body.currency?.trim().toLowerCase();
      if (!currency || !/^[a-z]{3}$/.test(currency)) {
        return errorResponse('currency must be a 3-letter ISO code');
      }
      if (body.id && !isValidUuid(body.id)) return errorResponse('id must be a valid UUID');
      const requestedStripePriceId = normalizeStripePriceIdInput(body.stripe_price_id);
      if (requestedStripePriceId) {
        try {
          await getStripe().prices.retrieve(requestedStripePriceId);
        } catch {
          return errorResponse('stripe_price_id was not found in Stripe', 404);
        }
      }

      const planId = body.id ?? crypto.randomUUID();
      const existing = body.id
        ? await queryOne<{ id: string; stripe_price_id: string | null; features: Record<string, unknown> | null }>(
          'SELECT id, stripe_price_id, features FROM license_plans WHERE id = $1',
          [body.id]
        )
        : null;
      if (body.id && !existing) return errorResponse('plan not found', 404);
      if (
        body.create_stripe_price &&
        existing?.stripe_price_id &&
        requestedStripePriceId === undefined
      ) {
        return errorResponse(
          'This plan already has a Stripe price. Clear stripe_price_id before creating a new Stripe price.',
          409
        );
      }

      const mergedFeatures = {
        ...(existing?.features ?? {}),
        ...(body.features ?? {}),
        invoice_unit_amount_cents: body.unit_amount_cents,
        currency,
      };
      const stripe = getStripe();
      const stripeIntervalMonths = body.stripe_interval_months !== undefined
        ? normalizeStripeIntervalMonths(body.stripe_interval_months)
        : normalizeStripeIntervalMonths(mergedFeatures.stripe_interval_months);

      let resolvedStripePriceId = requestedStripePriceId ?? existing?.stripe_price_id?.trim() ?? null;
      if (body.create_stripe_price) {
        const existingProductId = typeof mergedFeatures.stripe_product_id === 'string'
          ? mergedFeatures.stripe_product_id.trim()
          : '';
        let stripeProductId = existingProductId || null;
        if (!stripeProductId) {
          const product = await stripe.products.create({
            name,
            metadata: {
              license_plan_id: planId,
            },
          });
          stripeProductId = product.id;
        }
        const price = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: body.unit_amount_cents,
          currency,
          recurring: {
            interval: 'month',
            interval_count: stripeIntervalMonths,
          },
          metadata: {
            license_plan_id: planId,
          },
        });
        resolvedStripePriceId = price.id;
        Object.assign(mergedFeatures, {
          stripe_product_id: stripeProductId,
          stripe_interval_months: stripeIntervalMonths,
        });
      } else if (resolvedStripePriceId) {
        Object.assign(mergedFeatures, {
          stripe_interval_months: stripeIntervalMonths,
        });
      }

      if (existing) {
        await execute(
          `UPDATE license_plans
           SET name = $1, max_devices = $2, stripe_price_id = $3, features = $4::jsonb
           WHERE id = $5`,
          [
            name,
            body.max_devices,
            resolvedStripePriceId,
            JSON.stringify(mergedFeatures),
            planId,
          ]
        );
      } else {
        await execute(
          `INSERT INTO license_plans (id, name, max_devices, stripe_price_id, features)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            planId,
            name,
            body.max_devices,
            resolvedStripePriceId,
            JSON.stringify(mergedFeatures),
          ]
        );
      }

      await logAudit({
        user_id: auth.user.id,
        action: existing ? 'superadmin.plan.updated' : 'superadmin.plan.created',
        resource_type: 'license_plan',
        resource_id: planId,
        details: {
          name,
          max_devices: body.max_devices,
          stripe_price_id: resolvedStripePriceId,
          unit_amount_cents: body.unit_amount_cents,
          currency,
          create_stripe_price: Boolean(body.create_stripe_price),
          stripe_interval_months: stripeIntervalMonths,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: existing ? 'Plan updated' : 'Plan created', id: planId });
    }

    if (request.method === 'DELETE') {
      if (auth.authType !== 'session' || !auth.user.is_superadmin) {
        return errorResponse('Only platform admins can delete plans', 403);
      }

      const params = getSearchParams(request);
      const planId = params.get('id')?.trim();
      if (!planId || !isValidUuid(planId)) return errorResponse('id must be a valid UUID');

      const plan = await queryOne<{
        id: string;
        name: string;
        stripe_price_id: string | null;
      }>(
        `SELECT id, name, stripe_price_id
         FROM license_plans
         WHERE id = $1`,
        [planId]
      );
      if (!plan) return errorResponse('plan not found', 404);

      if (plan.stripe_price_id && plan.stripe_price_id.trim()) {
        return errorResponse('Cannot delete a plan linked to Stripe. Hide it instead.', 409);
      }

      const usage = await queryOne<{ usage_count: number }>(
        `SELECT COUNT(*)::int AS usage_count
         FROM licenses
         WHERE plan_id = $1`,
        [planId]
      );
      if ((usage?.usage_count ?? 0) > 0) {
        return errorResponse('Cannot delete a plan currently used by workspace subscriptions', 409);
      }

      await execute('DELETE FROM license_plans WHERE id = $1', [planId]);

      await logAudit({
        user_id: auth.user.id,
        action: 'superadmin.plan.deleted',
        resource_type: 'license_plan',
        resource_id: planId,
        details: {
          name: plan.name,
          stripe_price_id: null,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: 'Plan deleted', id: planId });
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('license-plans error:', err);
    return errorResponse('Internal server error', 500);
  }
}
