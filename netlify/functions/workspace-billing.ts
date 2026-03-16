import type { Context } from '@netlify/functions';
import { execute, query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission, requireWorkspaceResourcePermission } from './_lib/rbac.js';
import { encrypt } from './_lib/crypto.js';
import { createWorkspaceStripeClient, getWorkspaceStripeCredentials } from './_lib/workspace-stripe.js';
import { getSearchParams, jsonResponse, errorResponse, parseJsonBody, isValidUuid, getClientIp } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { getWorkspaceLicensingSettings } from './_lib/licensing.js';

type BillingRoute = 'config' | 'pricing' | 'environment' | 'checkout' | 'portal' | 'manual_grant' | 'unknown';
const ALLOWED_DURATION_MONTHS = [1, 12, 24, 36] as const;
type AuthContext = Awaited<ReturnType<typeof requireAuth>>;
type ParsedRoute = ReturnType<typeof parseRoute>;
type WorkspaceBillingSettings = {
  mode: 'disabled' | 'stripe' | null;
  stripe_secret_key_enc: string | null;
  stripe_webhook_secret_enc: string | null;
  stripe_publishable_key: string | null;
  default_currency: string | null;
  default_pricing_id: string | null;
  billing_contact_name: string | null;
  billing_business_name: string | null;
  billing_email: string | null;
};

function normalizeDurationMonths(value: number): number {
  return (ALLOWED_DURATION_MONTHS as readonly number[]).includes(value) ? value : ALLOWED_DURATION_MONTHS[0];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function syncWorkspacePricingToStripe(params: {
  workspaceId: string;
  pricingId: string;
  name: string;
  seatPriceCents: number;
  durationMonths: number;
  currency: string;
  metadata: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const creds = await getWorkspaceStripeCredentials(params.workspaceId);
  const currentMetadata = asRecord(params.metadata);
  if (creds.mode !== 'stripe' || !creds.secretKey) {
    return {
      ...currentMetadata,
      stripe_sync_status: 'pending',
      stripe_sync_reason: 'workspace_stripe_not_configured',
    };
  }

  const stripe = createWorkspaceStripeClient(creds.secretKey);
  const existingProductIdRaw = currentMetadata.stripe_product_id;
  const existingPriceIdRaw = currentMetadata.stripe_price_id;
  let stripeProductId = typeof existingProductIdRaw === 'string' ? existingProductIdRaw.trim() : '';
  const existingPriceId = typeof existingPriceIdRaw === 'string' ? existingPriceIdRaw.trim() : '';

  if (stripeProductId) {
    try {
      await stripe.products.retrieve(stripeProductId);
      await stripe.products.update(stripeProductId, { name: params.name });
    } catch {
      stripeProductId = '';
    }
  }

  if (!stripeProductId) {
    const product = await stripe.products.create({
      name: params.name,
      metadata: {
        workspace_id: params.workspaceId,
        pricing_id: params.pricingId,
      },
    });
    stripeProductId = product.id;
  }

  let resolvedPriceId = existingPriceId;
  if (existingPriceId) {
    try {
      const existingPrice = await stripe.prices.retrieve(existingPriceId);
      const existingInterval = existingPrice.recurring?.interval;
      const existingIntervalCount = existingPrice.recurring?.interval_count ?? 1;
      const unchanged = Boolean(
        existingPrice.active
        && existingPrice.unit_amount === params.seatPriceCents
        && existingPrice.currency?.toLowerCase() === params.currency
        && existingPrice.product === stripeProductId
        && existingInterval === 'month'
        && existingIntervalCount === params.durationMonths
      );
      if (!unchanged) {
        const newPrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: params.seatPriceCents,
          currency: params.currency,
          recurring: {
            interval: 'month',
            interval_count: params.durationMonths,
          },
          metadata: {
            workspace_id: params.workspaceId,
            pricing_id: params.pricingId,
          },
        });
        resolvedPriceId = newPrice.id;
        try {
          await stripe.prices.update(existingPriceId, { active: false });
        } catch {
          // Best-effort archival; keep the newly-created active price regardless.
        }
      }
    } catch {
      resolvedPriceId = '';
    }
  }

  if (!resolvedPriceId) {
    const createdPrice = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: params.seatPriceCents,
      currency: params.currency,
      recurring: {
        interval: 'month',
        interval_count: params.durationMonths,
      },
      metadata: {
        workspace_id: params.workspaceId,
        pricing_id: params.pricingId,
      },
    });
    resolvedPriceId = createdPrice.id;
  }

  return {
    ...currentMetadata,
    stripe_product_id: stripeProductId,
    stripe_price_id: resolvedPriceId,
    stripe_currency: params.currency,
    stripe_interval_months: params.durationMonths,
    stripe_sync_status: 'synced',
    stripe_synced_at: new Date().toISOString(),
  };
}

function parseRoute(pathname: string): { route: BillingRoute; environmentId?: string } {
  const normalized = pathname
    .replace(/^\/api\/workspace-billing\/?/, '')
    .replace(/^\/\.netlify\/functions\/workspace-billing\/?/, '');
  const tail = normalized.split('/').filter(Boolean);

  if (tail[0] === 'config') return { route: 'config' };
  if (tail[0] === 'pricing') return { route: 'pricing' };
  if (tail[0] === 'environments' && tail[1]) return { route: 'environment', environmentId: tail[1] };
  if (tail[0] === 'checkout') return { route: 'checkout' };
  if (tail[0] === 'portal') return { route: 'portal' };
  if (tail[0] === 'grants' && tail[1] === 'manual') return { route: 'manual_grant' };
  return { route: 'unknown' };
}

async function handlePostManualGrant(request: Request, _route: ParsedRoute, auth: AuthContext): Promise<Response> {
  const body = await parseJsonBody<{
    environment_id: string;
    seat_count: number;
    duration_months?: number;
    no_expiry?: boolean;
    grant_type?: 'manual' | 'free';
    note?: string;
  }>(request);

  if (!body.environment_id || !isValidUuid(body.environment_id)) {
    return errorResponse('environment_id must be a valid UUID');
  }
  if (!Number.isInteger(body.seat_count) || body.seat_count <= 0) {
    return errorResponse('seat_count must be a positive integer');
  }
  if (body.seat_count > 1_000_000) {
    return errorResponse('seat_count must be <= 1000000');
  }
  if (body.duration_months !== undefined && (!Number.isInteger(body.duration_months) || body.duration_months <= 0)) {
    return errorResponse('duration_months must be a positive integer');
  }
  if (body.duration_months !== undefined && body.duration_months > 120) {
    return errorResponse('duration_months must be <= 120');
  }

  const env = await queryOne<{ id: string; workspace_id: string; name: string }>(
    'SELECT id, workspace_id, name FROM environments WHERE id = $1',
    [body.environment_id]
  );
  if (!env) return errorResponse('Environment not found', 404);

  await requireWorkspaceBillingOrEnvironmentPermission(auth, env.workspace_id, env.id, 'write');
  await requireLicensingEnabled(env.workspace_id);

  const source = body.grant_type === 'free' ? 'workspace_free' : 'workspace_manual';
  const startsAtIso = new Date().toISOString();
  let endsAtIso: string | null = null;
  if (!body.no_expiry) {
    const durationMonths = Math.max(1, Math.min(120, Math.trunc(body.duration_months ?? 1)));
    const endsAt = new Date(startsAtIso);
    endsAt.setUTCMonth(endsAt.getUTCMonth() + durationMonths);
    endsAtIso = endsAt.toISOString();
  }

  const entitlementId = crypto.randomUUID();
  await execute(
    `INSERT INTO environment_entitlements
       (id, workspace_id, environment_id, source, seat_count, starts_at, ends_at, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8::jsonb)`,
    [
      entitlementId,
      env.workspace_id,
      env.id,
      source,
      body.seat_count,
      startsAtIso,
      endsAtIso,
      JSON.stringify({
        note: body.note?.trim() ? body.note.trim() : null,
        granted_by_user_id: auth.authType === 'session' ? auth.user.id : null,
      }),
    ]
  );

  await logAudit({
    workspace_id: env.workspace_id,
    environment_id: env.id,
    user_id: auth.authType === 'session' ? auth.user.id : undefined,
    action: 'workspace_billing.entitlement.manual_granted',
    resource_type: 'environment_entitlement',
    resource_id: entitlementId,
    details: {
      source,
      seat_count: body.seat_count,
      duration_months: body.no_expiry ? null : (body.duration_months ?? 1),
      no_expiry: Boolean(body.no_expiry),
      note: body.note?.trim() ? body.note.trim() : null,
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({
    message: source === 'workspace_free' ? 'Free entitlement grant created' : 'Manual entitlement grant created',
    entitlement_id: entitlementId,
    source,
  }, 201);
}

async function requireWorkspaceBillingOrEnvironmentPermission(
  auth: AuthContext,
  workspaceId: string,
  environmentId: string,
  mode: 'read' | 'write',
): Promise<void> {
  try {
    await requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', 'read');
    await requireWorkspaceResourcePermission(
      auth,
      workspaceId,
      'billing',
      mode === 'read' ? 'billing_view' : 'billing_manage',
    );
    return;
  } catch (err) {
    if (!(err instanceof Response) || err.status !== 403) {
      throw err;
    }
  }

  await requireEnvironmentPermission(auth, environmentId, mode === 'read' ? 'read' : 'write');
}

async function requireLicensingEnabled(workspaceId: string): Promise<void> {
  const licensing = await getWorkspaceLicensingSettings(workspaceId);
  if (!licensing.effective_licensing_enabled) {
    throw new Response(JSON.stringify({ error: 'Licensing is disabled for this workspace' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function getWorkspaceBillingSettings(workspaceId: string): Promise<WorkspaceBillingSettings | null> {
  return queryOne<WorkspaceBillingSettings>(
    `SELECT mode, stripe_secret_key_enc, stripe_webhook_secret_enc, stripe_publishable_key, default_currency, default_pricing_id,
            billing_contact_name, billing_business_name, billing_email
     FROM workspace_billing_settings
     WHERE workspace_id = $1`,
    [workspaceId]
  );
}

function resolveCheckoutReturnUrl(
  request: Request,
  providedUrl: string | undefined,
  fallbackState: 'success' | 'cancelled'
): string {
  const requestOrigin = new URL(request.url).origin;
  const fallback = `${requestOrigin}/licenses?workspace_billing=${fallbackState}`;
  const trimmed = providedUrl?.trim();
  if (!trimmed) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, requestOrigin);
  } catch {
    throw new Response(JSON.stringify({ error: 'Invalid checkout return URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (parsed.origin !== requestOrigin) {
    throw new Response(JSON.stringify({ error: 'Checkout return URLs must use the same origin as this workspace' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return parsed.toString();
}

async function handleGetConfig(request: Request, _route: ParsedRoute, auth: AuthContext): Promise<Response> {
  const params = getSearchParams(request);
  const workspaceId = params.get('workspace_id')
    ?? (auth.authType === 'api_key' ? auth.apiKey?.workspace_id ?? null : auth.user.workspace_id);
  if (!workspaceId) return errorResponse('workspace_id is required');
  if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');
  await requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', 'read');

  try {
    await requireLicensingEnabled(workspaceId);
  } catch (err) {
    if (err instanceof Response && err.status === 409) {
      return jsonResponse({
        workspace_id: workspaceId,
        mode: 'disabled',
        stripe_publishable_key: null,
        default_currency: 'usd',
        default_pricing_id: null,
        billing_contact_name: null,
        billing_business_name: null,
        billing_email: null,
        has_stripe_secret_key: false,
        has_stripe_webhook_secret: false,
        licensing_enabled: false,
      });
    }
    throw err;
  }

  await requireWorkspaceResourcePermission(auth, workspaceId, 'billing', 'billing_view');
  const config = await getWorkspaceBillingSettings(workspaceId);

  return jsonResponse({
    workspace_id: workspaceId,
    mode: config?.mode ?? 'disabled',
    stripe_publishable_key: config?.stripe_publishable_key ?? null,
    default_currency: config?.default_currency ?? 'usd',
    default_pricing_id: config?.default_pricing_id ?? null,
    billing_contact_name: config?.billing_contact_name ?? null,
    billing_business_name: config?.billing_business_name ?? null,
    billing_email: config?.billing_email ?? null,
    has_stripe_secret_key: Boolean(config?.stripe_secret_key_enc),
    has_stripe_webhook_secret: Boolean(config?.stripe_webhook_secret_enc),
    licensing_enabled: true,
  });
}

async function handlePutConfig(request: Request, _route: ParsedRoute, auth: AuthContext): Promise<Response> {
  if (auth.authType === 'api_key') {
    return errorResponse('API keys cannot update workspace billing config', 403);
  }

  const body = await parseJsonBody<{
    workspace_id: string;
    mode?: 'disabled' | 'stripe';
    stripe_secret_key?: string;
    stripe_webhook_secret?: string;
    stripe_publishable_key?: string | null;
    default_currency?: string;
    default_pricing_id?: string | null;
    billing_contact_name?: string | null;
    billing_business_name?: string | null;
    billing_email?: string | null;
  }>(request);
  if (!body.workspace_id || !isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');

  await requireWorkspaceResourcePermission(auth, body.workspace_id, 'workspace', 'read');
  await requireLicensingEnabled(body.workspace_id);
  await requireWorkspaceResourcePermission(auth, body.workspace_id, 'billing', 'billing_customer');

  const existing = await getWorkspaceBillingSettings(body.workspace_id);
  const mode = body.mode ?? 'disabled';

  const secretKeyRaw = body.stripe_secret_key?.trim();
  if (secretKeyRaw) {
    try {
      const stripe = createWorkspaceStripeClient(secretKeyRaw);
      await stripe.balance.retrieve();
    } catch {
      return errorResponse('stripe_secret_key is invalid', 400);
    }
  }

  const secretKeyEnc = body.stripe_secret_key === undefined
    ? (existing?.stripe_secret_key_enc ?? null)
    : (!secretKeyRaw
      ? (existing?.stripe_secret_key_enc ?? null)
      : encrypt(secretKeyRaw, `workspace-billing:${body.workspace_id}:stripe_secret_key`));
  const webhookSecretRaw = body.stripe_webhook_secret?.trim();
  const webhookSecretEnc = body.stripe_webhook_secret === undefined
    ? (existing?.stripe_webhook_secret_enc ?? null)
    : (!webhookSecretRaw
      ? (existing?.stripe_webhook_secret_enc ?? null)
      : encrypt(webhookSecretRaw, `workspace-billing:${body.workspace_id}:stripe_webhook_secret`));

  await execute(
    `INSERT INTO workspace_billing_settings
       (workspace_id, mode, stripe_secret_key_enc, stripe_webhook_secret_enc,
        stripe_publishable_key, default_currency, default_pricing_id,
        billing_contact_name, billing_business_name, billing_email, created_by, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, now())
     ON CONFLICT (workspace_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       stripe_secret_key_enc = EXCLUDED.stripe_secret_key_enc,
       stripe_webhook_secret_enc = EXCLUDED.stripe_webhook_secret_enc,
       stripe_publishable_key = EXCLUDED.stripe_publishable_key,
       default_currency = EXCLUDED.default_currency,
       default_pricing_id = EXCLUDED.default_pricing_id,
       billing_contact_name = EXCLUDED.billing_contact_name,
       billing_business_name = EXCLUDED.billing_business_name,
       billing_email = EXCLUDED.billing_email,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      body.workspace_id,
      mode,
      secretKeyEnc,
      webhookSecretEnc,
      body.stripe_publishable_key ?? null,
      (body.default_currency ?? 'usd').toLowerCase(),
      body.default_pricing_id ?? null,
      body.billing_contact_name?.trim() || null,
      body.billing_business_name?.trim() || null,
      body.billing_email?.trim() || null,
      auth.authType === 'session' ? auth.user.id : auth.apiKey?.created_by_user_id ?? null,
    ]
  );

  await logAudit({
    workspace_id: body.workspace_id,
    user_id: auth.authType === 'session' ? auth.user.id : undefined,
    action: 'workspace_billing.config.updated',
    resource_type: 'workspace_billing',
    details: {
      mode,
      has_stripe_secret_key: Boolean(secretKeyEnc),
      has_stripe_webhook_secret: Boolean(webhookSecretEnc),
      default_currency: (body.default_currency ?? 'usd').toLowerCase(),
      default_pricing_id: body.default_pricing_id ?? null,
      billing_contact_name: body.billing_contact_name?.trim() || null,
      billing_business_name: body.billing_business_name?.trim() || null,
      billing_email: body.billing_email?.trim() || null,
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({ message: 'Workspace billing config updated' });
}

async function handleGetPricing(request: Request, _route: ParsedRoute, auth: AuthContext): Promise<Response> {
  const params = getSearchParams(request);
  const workspaceId = params.get('workspace_id')
    ?? (auth.authType === 'api_key' ? auth.apiKey?.workspace_id ?? null : auth.user.workspace_id);
  if (!workspaceId) return errorResponse('workspace_id is required');
  if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');
  await requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', 'read');

  try {
    await requireLicensingEnabled(workspaceId);
  } catch (err) {
    if (err instanceof Response && err.status === 409) {
      return jsonResponse({
        workspace_id: workspaceId,
        pricing: [],
        default_pricing_id: null,
        default_currency: 'usd',
        licensing_enabled: false,
      });
    }
    throw err;
  }

  await requireWorkspaceResourcePermission(auth, workspaceId, 'billing', 'billing_view');

  const [pricing, settings] = await Promise.all([
    query<{
      id: string;
      name: string;
      seat_price_cents: number;
      duration_months: number;
      active: boolean;
      metadata: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, seat_price_cents, duration_months, active, metadata, created_at, updated_at
       FROM workspace_pricing_catalog
       WHERE workspace_id = $1
       ORDER BY active DESC, duration_months ASC, seat_price_cents ASC`,
      [workspaceId]
    ),
    getWorkspaceBillingSettings(workspaceId),
  ]);

  return jsonResponse({
    workspace_id: workspaceId,
    pricing,
    default_pricing_id: settings?.default_pricing_id ?? null,
    default_currency: settings?.default_currency ?? 'usd',
  });
}

async function handlePutPricing(request: Request, _route: ParsedRoute, auth: AuthContext): Promise<Response> {
  const body = await parseJsonBody<{
    workspace_id: string;
    id?: string;
    name?: string;
    seat_price_cents?: number;
    duration_months?: number;
    active?: boolean;
    metadata?: Record<string, unknown>;
    delete?: boolean;
    set_default?: boolean;
  }>(request);
  if (!body.workspace_id || !isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');

  await requireWorkspaceResourcePermission(auth, body.workspace_id, 'workspace', 'read');
  await requireLicensingEnabled(body.workspace_id);
  await requireWorkspaceResourcePermission(auth, body.workspace_id, 'billing', 'billing_manage');

  if (body.delete) {
    if (!body.id || !isValidUuid(body.id)) return errorResponse('id must be a valid UUID when delete=true');
    await execute(
      `DELETE FROM workspace_pricing_catalog
       WHERE id = $1 AND workspace_id = $2`,
      [body.id, body.workspace_id]
    );
    await logAudit({
      workspace_id: body.workspace_id,
      user_id: auth.authType === 'session' ? auth.user.id : undefined,
      action: 'workspace_billing.pricing.deleted',
      resource_type: 'workspace_pricing',
      resource_id: body.id,
      ip_address: getClientIp(request),
    });
    return jsonResponse({ message: 'Pricing entry deleted' });
  }

  if (!body.name || !Number.isInteger(body.seat_price_cents) || !Number.isInteger(body.duration_months)) {
    return errorResponse('name, seat_price_cents, and duration_months are required');
  }
  if ((body.seat_price_cents ?? 0) < 0) return errorResponse('seat_price_cents must be non-negative');
  if ((body.duration_months ?? 0) <= 0) return errorResponse('duration_months must be positive');
  if (!(ALLOWED_DURATION_MONTHS as readonly number[]).includes(body.duration_months)) {
    return errorResponse(`duration_months must be one of ${ALLOWED_DURATION_MONTHS.join(', ')}`);
  }

  const pricingId = body.id && isValidUuid(body.id) ? body.id : crypto.randomUUID();
  const isUpdate = Boolean(body.id && isValidUuid(body.id));
  const durationMonths = normalizeDurationMonths(body.duration_months);
  const workspaceBillingSettings = await getWorkspaceBillingSettings(body.workspace_id);
  const planCurrency = String(workspaceBillingSettings?.default_currency ?? 'usd').toLowerCase();

  let existingMetadata: Record<string, unknown> = {};
  if (isUpdate) {
    const existingPricing = await queryOne<{ id: string; metadata: Record<string, unknown> | null }>(
      `SELECT id, metadata
       FROM workspace_pricing_catalog
       WHERE id = $1 AND workspace_id = $2`,
      [pricingId, body.workspace_id]
    );
    if (!existingPricing) return errorResponse('Pricing entry not found', 404);
    existingMetadata = asRecord(existingPricing.metadata);
  }
  const mergedMetadata = {
    ...existingMetadata,
    ...asRecord(body.metadata),
  };

  let syncedMetadata: Record<string, unknown>;
  try {
    syncedMetadata = await syncWorkspacePricingToStripe({
      workspaceId: body.workspace_id,
      pricingId,
      name: body.name.trim(),
      seatPriceCents: body.seat_price_cents,
      durationMonths,
      currency: planCurrency,
      metadata: mergedMetadata,
    });
  } catch (syncErr) {
    console.error('workspace-billing pricing sync error:', syncErr);
    return errorResponse('Failed to sync pricing plan with Stripe', 502);
  }

  if (isUpdate) {
    await execute(
      `UPDATE workspace_pricing_catalog
       SET name = $1, seat_price_cents = $2, duration_months = $3, active = $4, metadata = $5::jsonb, updated_at = now()
       WHERE id = $6 AND workspace_id = $7`,
      [
        body.name.trim(),
        body.seat_price_cents,
        durationMonths,
        body.active ?? true,
        JSON.stringify(syncedMetadata),
        pricingId,
        body.workspace_id,
      ]
    );
  } else {
    await execute(
      `INSERT INTO workspace_pricing_catalog
         (id, workspace_id, name, seat_price_cents, duration_months, active, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        pricingId,
        body.workspace_id,
        body.name.trim(),
        body.seat_price_cents,
        durationMonths,
        body.active ?? true,
        JSON.stringify(syncedMetadata),
      ]
    );
  }

  if (body.set_default) {
    await execute(
      `INSERT INTO workspace_billing_settings (workspace_id, default_pricing_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (workspace_id) DO UPDATE SET default_pricing_id = EXCLUDED.default_pricing_id, updated_at = now()`,
      [body.workspace_id, pricingId]
    );
  }

  await logAudit({
    workspace_id: body.workspace_id,
    user_id: auth.authType === 'session' ? auth.user.id : undefined,
    action: isUpdate ? 'workspace_billing.pricing.updated' : 'workspace_billing.pricing.created',
    resource_type: 'workspace_pricing',
    resource_id: pricingId,
    details: {
      name: body.name.trim(),
      seat_price_cents: body.seat_price_cents,
      duration_months: durationMonths,
      active: body.active ?? true,
      set_default: body.set_default ?? false,
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({ message: isUpdate ? 'Pricing entry updated' : 'Pricing entry created', pricing_id: pricingId });
}

async function handleGetEnvironment(_request: Request, route: ParsedRoute, auth: AuthContext): Promise<Response> {
  const environmentId = route.environmentId;
  if (!environmentId || !isValidUuid(environmentId)) return errorResponse('environment_id must be a valid UUID');

  const env = await queryOne<{ id: string; name: string; workspace_id: string }>(
    'SELECT id, name, workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env) return errorResponse('Environment not found', 404);

  await requireWorkspaceBillingOrEnvironmentPermission(auth, env.workspace_id, env.id, 'read');
  await requireLicensingEnabled(env.workspace_id);

  const [customer, settings, entitlements] = await Promise.all([
    queryOne<{
      id: string;
      name: string | null;
      email: string | null;
      stripe_customer_id: string | null;
      pricing_id: string | null;
      status: string;
      updated_at: string;
    }>(
      `SELECT id, name, email, stripe_customer_id, pricing_id, status, updated_at
       FROM workspace_customers
       WHERE environment_id = $1`,
      [environmentId]
    ),
    getWorkspaceBillingSettings(env.workspace_id),
    query<{
      id: string;
      source: string;
      seat_count: number;
      starts_at: string;
      ends_at: string | null;
      status: string;
      external_ref: string | null;
      created_at: string;
    }>(
      `SELECT id, source, seat_count, starts_at, ends_at, status, external_ref, created_at
       FROM environment_entitlements
       WHERE workspace_id = $1
         AND environment_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [env.workspace_id, env.id]
    ),
  ]);

  const effectivePricingId = customer?.pricing_id ?? settings?.default_pricing_id ?? null;
  const effectivePricing = effectivePricingId
    ? await queryOne<{
        id: string;
        name: string;
        seat_price_cents: number;
        duration_months: number;
        active: boolean;
      }>(
        `SELECT id, name, seat_price_cents, duration_months, active
         FROM workspace_pricing_catalog
         WHERE id = $1 AND workspace_id = $2`,
        [effectivePricingId, env.workspace_id]
      )
    : null;

  return jsonResponse({
    environment: env,
    customer: customer ?? null,
    default_pricing_id: settings?.default_pricing_id ?? null,
    workspace_billing_mode: settings?.mode ?? 'disabled',
    effective_pricing: effectivePricing ?? null,
    history: {
      entitlements,
    },
  });
}

async function handlePutEnvironment(request: Request, route: ParsedRoute, auth: AuthContext): Promise<Response> {
  const environmentId = route.environmentId;
  if (!environmentId || !isValidUuid(environmentId)) return errorResponse('environment_id must be a valid UUID');

  const env = await queryOne<{ id: string; workspace_id: string }>(
    'SELECT id, workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env) return errorResponse('Environment not found', 404);

  await requireWorkspaceResourcePermission(auth, env.workspace_id, 'workspace', 'read');
  await requireLicensingEnabled(env.workspace_id);
  await requireWorkspaceResourcePermission(auth, env.workspace_id, 'billing', 'billing_manage');

  const body = await parseJsonBody<{
    customer_name?: string | null;
    customer_email?: string | null;
    pricing_id?: string | null;
    status?: 'active' | 'inactive';
  }>(request);

  if (body.pricing_id && !isValidUuid(body.pricing_id)) return errorResponse('pricing_id must be a valid UUID');
  if (body.pricing_id) {
    const pricing = await queryOne<{ id: string }>(
      `SELECT id FROM workspace_pricing_catalog
       WHERE id = $1 AND workspace_id = $2`,
      [body.pricing_id, env.workspace_id]
    );
    if (!pricing) return errorResponse('pricing_id not found in this workspace', 404);
  }

  await execute(
    `INSERT INTO workspace_customers
       (id, workspace_id, environment_id, name, email, pricing_id, status, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (environment_id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, workspace_customers.name),
       email = COALESCE(EXCLUDED.email, workspace_customers.email),
       pricing_id = EXCLUDED.pricing_id,
       status = COALESCE(EXCLUDED.status, workspace_customers.status),
       updated_at = now()`,
    [
      env.workspace_id,
      environmentId,
      body.customer_name ?? null,
      body.customer_email ?? null,
      body.pricing_id ?? null,
      body.status ?? 'active',
    ]
  );

  await logAudit({
    workspace_id: env.workspace_id,
    environment_id: environmentId,
    user_id: auth.authType === 'session' ? auth.user.id : undefined,
    action: 'workspace_billing.environment.updated',
    resource_type: 'workspace_customer',
    details: {
      customer_name: body.customer_name ?? null,
      customer_email: body.customer_email ?? null,
      pricing_id: body.pricing_id ?? null,
      status: body.status ?? 'active',
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({ message: 'Environment billing mapping updated' });
}

async function handlePostCheckout(request: Request, _route: ParsedRoute, auth: AuthContext): Promise<Response> {
  if (auth.authType === 'api_key') return errorResponse('API keys cannot create workspace checkout sessions', 403);

  const body = await parseJsonBody<{
    environment_id: string;
    pricing_id?: string;
    seat_count?: number;
    customer_name?: string;
    customer_email?: string;
    success_url?: string;
    cancel_url?: string;
  }>(request);
  if (!body.environment_id || !isValidUuid(body.environment_id)) return errorResponse('environment_id must be a valid UUID');

  const env = await queryOne<{ id: string; name: string; workspace_id: string }>(
    'SELECT id, name, workspace_id FROM environments WHERE id = $1',
    [body.environment_id]
  );
  if (!env) return errorResponse('Environment not found', 404);

  await requireWorkspaceBillingOrEnvironmentPermission(auth, env.workspace_id, env.id, 'write');
  await requireLicensingEnabled(env.workspace_id);

  const creds = await getWorkspaceStripeCredentials(env.workspace_id);
  if (creds.mode !== 'stripe' || !creds.secretKey) {
    return errorResponse('Workspace Stripe billing is not configured', 400);
  }
  const stripe = createWorkspaceStripeClient(creds.secretKey);

  const [existingCustomer, settings] = await Promise.all([
    queryOne<{
      id: string;
      name: string | null;
      email: string | null;
      stripe_customer_id: string | null;
      pricing_id: string | null;
    }>(
      `SELECT id, name, email, stripe_customer_id, pricing_id
       FROM workspace_customers
       WHERE environment_id = $1`,
      [env.id]
    ),
    getWorkspaceBillingSettings(env.workspace_id),
  ]);

  const resolvedCustomerName = body.customer_name?.trim()
    || existingCustomer?.name?.trim()
    || `${env.name} Customer`;
  const resolvedCustomerEmail = body.customer_email?.trim()
    || existingCustomer?.email?.trim()
    || undefined;

  const pricingId = body.pricing_id ?? existingCustomer?.pricing_id ?? settings?.default_pricing_id ?? null;
  if (!pricingId || !isValidUuid(pricingId)) {
    return errorResponse('No pricing configured for this environment');
  }

  const pricing = await queryOne<{
    id: string;
    name: string;
    seat_price_cents: number;
    duration_months: number;
    active: boolean;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, name, seat_price_cents, duration_months, active, metadata
     FROM workspace_pricing_catalog
     WHERE id = $1 AND workspace_id = $2`,
    [pricingId, env.workspace_id]
  );
  if (!pricing || !pricing.active) return errorResponse('Pricing is not active', 400);

  const seatCount = Math.max(1, Math.min(100_000, Math.trunc(body.seat_count ?? 1)));
  const recurringIntervalMonths = normalizeDurationMonths(Math.trunc(pricing.duration_months || 1));
  const pricingMetadata = asRecord(pricing.metadata);
  const stripePriceIdRaw = pricingMetadata.stripe_price_id;
  let stripePriceId = typeof stripePriceIdRaw === 'string' ? stripePriceIdRaw.trim() : '';
  if (!stripePriceId) {
    try {
      const syncedMetadata = await syncWorkspacePricingToStripe({
        workspaceId: env.workspace_id,
        pricingId: pricing.id,
        name: pricing.name,
        seatPriceCents: pricing.seat_price_cents,
        durationMonths: recurringIntervalMonths,
        currency: String(settings?.default_currency ?? 'usd').toLowerCase(),
        metadata: pricingMetadata,
      });
      await execute(
        `UPDATE workspace_pricing_catalog
         SET metadata = $1::jsonb, updated_at = now()
         WHERE id = $2 AND workspace_id = $3`,
        [JSON.stringify(syncedMetadata), pricing.id, env.workspace_id]
      );
      stripePriceId = typeof syncedMetadata.stripe_price_id === 'string'
        ? syncedMetadata.stripe_price_id.trim()
        : '';
    } catch (syncErr) {
      console.error('workspace-billing checkout sync error:', syncErr);
      return errorResponse('Failed to sync pricing plan to Stripe for checkout', 502);
    }
  }
  if (!stripePriceId) {
    return errorResponse('Pricing plan is not synced to Stripe. Re-save the plan in workspace billing settings.', 409);
  }

  let stripeCustomerId = existingCustomer?.stripe_customer_id ?? null;
  if (!stripeCustomerId) {
    const stripeCustomer = await stripe.customers.create({
      name: resolvedCustomerName,
      email: resolvedCustomerEmail,
      metadata: {
        workspace_id: env.workspace_id,
        environment_id: env.id,
      },
    });
    stripeCustomerId = stripeCustomer.id;
  }

  const workspaceCustomerId = existingCustomer?.id ?? crypto.randomUUID();
  await execute(
    `INSERT INTO workspace_customers
       (id, workspace_id, environment_id, name, email, stripe_customer_id, pricing_id, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', now())
     ON CONFLICT (environment_id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, workspace_customers.name),
       email = COALESCE(EXCLUDED.email, workspace_customers.email),
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       pricing_id = EXCLUDED.pricing_id,
       status = 'active',
       updated_at = now()`,
    [
      workspaceCustomerId,
      env.workspace_id,
      env.id,
      resolvedCustomerName || null,
      resolvedCustomerEmail ?? null,
      stripeCustomerId,
      pricing.id,
    ]
  );

  const successUrl = resolveCheckoutReturnUrl(request, body.success_url, 'success');
  const cancelUrl = resolveCheckoutReturnUrl(request, body.cancel_url, 'cancelled');
  const checkoutMetadata = {
    workspace_id: env.workspace_id,
    environment_id: env.id,
    pricing_id: pricing.id,
    workspace_customer_id: workspaceCustomerId,
    seat_count: String(seatCount),
    duration_months: String(recurringIntervalMonths),
    billing_mode: 'subscription',
    stripe_interval_months: String(recurringIntervalMonths),
    stripe_price_id: stripePriceId,
  };

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        price: stripePriceId,
        quantity: seatCount,
      },
    ],
    metadata: checkoutMetadata,
    subscription_data: {
      metadata: checkoutMetadata,
    },
  });

  if (!session.url) return errorResponse('Failed to create checkout session', 500);

  await logAudit({
    workspace_id: env.workspace_id,
    environment_id: env.id,
    user_id: auth.user.id,
    action: 'workspace_billing.checkout.created',
    resource_type: 'workspace_customer',
    resource_id: workspaceCustomerId,
    details: {
      pricing_id: pricing.id,
      seat_count: seatCount,
      duration_months: recurringIntervalMonths,
      billing_mode: 'subscription',
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({ checkout_url: session.url });
}

async function handlePostPortal(request: Request, _route: ParsedRoute, auth: AuthContext): Promise<Response> {
  const body = await parseJsonBody<{ environment_id: string }>(request);
  if (!body.environment_id || !isValidUuid(body.environment_id)) return errorResponse('environment_id must be a valid UUID');

  const env = await queryOne<{ id: string; workspace_id: string }>(
    'SELECT id, workspace_id FROM environments WHERE id = $1',
    [body.environment_id]
  );
  if (!env) return errorResponse('Environment not found', 404);

  await requireWorkspaceBillingOrEnvironmentPermission(auth, env.workspace_id, env.id, 'write');
  await requireLicensingEnabled(env.workspace_id);

  const customer = await queryOne<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id
     FROM workspace_customers
     WHERE environment_id = $1`,
    [env.id]
  );
  if (!customer?.stripe_customer_id) return errorResponse('No Stripe customer configured for environment', 404);

  const creds = await getWorkspaceStripeCredentials(env.workspace_id);
  if (creds.mode !== 'stripe' || !creds.secretKey) {
    return errorResponse('Workspace Stripe billing is not configured', 400);
  }
  const stripe = createWorkspaceStripeClient(creds.secretKey);
  const returnUrl = `${new URL(request.url).origin}/licenses`;
  const portal = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: returnUrl,
  });

  await logAudit({
    workspace_id: env.workspace_id,
    environment_id: env.id,
    user_id: auth.authType === 'session' ? auth.user.id : undefined,
    action: 'workspace_billing.portal.created',
    resource_type: 'workspace_customer',
    ip_address: getClientIp(request),
  });

  return jsonResponse({ portal_url: portal.url });
}

export default async function handler(request: Request, _context: Context) {
  try {
    const auth = await requireAuth(request);
    const parsed = parseRoute(new URL(request.url).pathname);
    const routeKey = `${request.method}:${parsed.route}`;
    const routeHandlers: Record<string, (req: Request, route: ParsedRoute, authCtx: AuthContext) => Promise<Response>> = {
      'GET:config': handleGetConfig,
      'PUT:config': handlePutConfig,
      'GET:pricing': handleGetPricing,
      'PUT:pricing': handlePutPricing,
      'GET:environment': handleGetEnvironment,
      'PUT:environment': handlePutEnvironment,
      'POST:checkout': handlePostCheckout,
      'POST:portal': handlePostPortal,
      'POST:manual_grant': handlePostManualGrant,
    };

    const routeHandler = routeHandlers[routeKey];
    if (!routeHandler) return errorResponse('Not found', 404);
    return await routeHandler(request, parsed, auth);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('workspace-billing error:', err);
    return errorResponse('Internal server error', 500);
  }
}
