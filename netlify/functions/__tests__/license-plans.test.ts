import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAuth,
  mockRequireWorkspaceResourcePermission,
  mockRequireEnvironmentPermission,
  mockGetWorkspaceLicensingSettings,
  mockQuery,
  mockQueryOne,
  mockExecute,
  mockLogAudit,
  mockStripeRetrieve,
  mockStripeProductCreate,
  mockStripePriceCreate,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireWorkspaceResourcePermission: vi.fn(),
  mockRequireEnvironmentPermission: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockExecute: vi.fn(),
  mockLogAudit: vi.fn(),
  mockStripeRetrieve: vi.fn(),
  mockStripeProductCreate: vi.fn(),
  mockStripePriceCreate: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: mockRequireWorkspaceResourcePermission,
  requireEnvironmentPermission: mockRequireEnvironmentPermission,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
}));

vi.mock('../_lib/db.js', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: mockExecute,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/stripe.js', () => ({
  getStripe: () => ({
    products: {
      create: mockStripeProductCreate,
    },
    prices: {
      retrieve: mockStripeRetrieve,
      create: mockStripePriceCreate,
    },
  }),
}));

import handler from '../license-plans.ts';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockLogAudit.mockReset();
  mockStripeRetrieve.mockReset();
  mockStripeProductCreate.mockReset();
  mockStripePriceCreate.mockReset();

  mockRequireAuth.mockResolvedValue({
    authType: 'session',
    user: {
      id: 'sa_1',
      is_superadmin: true,
      workspace_id: null,
    },
  });
  mockRequireEnvironmentPermission.mockResolvedValue(undefined);
});

describe('license-plans', () => {
  it('allows superadmin GET without workspace context', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 100,
        stripe_price_id: null,
        features: { invoice_unit_amount_cents: 250, currency: 'usd' },
        created_at: new Date().toISOString(),
      },
    ]);

    const res = await handler(new Request('http://localhost/api/licenses/plans', { method: 'GET' }), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      plans: [
        expect.objectContaining({
          name: 'Pro',
          unit_amount_cents: 250,
          currency: 'usd',
        }),
      ],
    });
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
  });

  it('rejects PUT for non-superadmin users', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      user: { id: 'u_1', is_superadmin: false, workspace_id: WORKSPACE_ID },
    });

    const res = await handler(new Request('http://localhost/api/licenses/plans', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 100,
        unit_amount_cents: 250,
        currency: 'usd',
      }),
    }), {} as never);

    expect(res.status).toBe(403);
  });

  it('hides plans marked hidden for workspace-scoped GET responses', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      user: { id: 'u_1', is_superadmin: false, workspace_id: WORKSPACE_ID },
    });
    mockGetWorkspaceLicensingSettings.mockResolvedValueOnce({
      effective_licensing_enabled: true,
    });
    mockQuery.mockResolvedValueOnce([
      {
        id: 'plan_visible',
        name: 'Visible Plan',
        max_devices: 100,
        stripe_price_id: null,
        features: { invoice_unit_amount_cents: 250, currency: 'usd' },
        created_at: new Date().toISOString(),
      },
      {
        id: 'plan_hidden',
        name: 'Hidden Plan',
        max_devices: 100,
        stripe_price_id: null,
        features: { invoice_unit_amount_cents: 250, currency: 'usd', hidden: true },
        created_at: new Date().toISOString(),
      },
    ]);

    const res = await handler(
      new Request(`http://localhost/api/licenses/plans?workspace_id=${WORKSPACE_ID}`, { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      plans: [
        expect.objectContaining({
          id: 'plan_visible',
        }),
      ],
    });
  });

  it('allows workspace-scoped GET for env-scoped member fallback', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      user: { id: 'u_1', is_superadmin: false, workspace_id: null, environment_id: 'env_1' },
    });
    mockRequireWorkspaceResourcePermission.mockRejectedValueOnce(new Response(
      JSON.stringify({ error: 'Forbidden: insufficient workspace role' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    ));
    mockQueryOne.mockResolvedValueOnce({ id: 'env_1' });
    mockGetWorkspaceLicensingSettings.mockResolvedValueOnce({
      effective_licensing_enabled: true,
    });
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(
      new Request(`http://localhost/api/licenses/plans?workspace_id=${WORKSPACE_ID}`, { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      expect.objectContaining({ authType: 'session' }),
      'env_1',
      'read'
    );
  });

  it('updates a plan with pricing metadata via PUT', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: '323e4567-e89b-12d3-a456-426614174000',
      features: { existing_flag: true },
    });

    const res = await handler(new Request('http://localhost/api/licenses/plans', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 250,
        unit_amount_cents: 599,
        currency: 'gbp',
      }),
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const executeArgs = mockExecute.mock.calls[0];
    expect(executeArgs[0]).toContain('UPDATE license_plans');
    expect(executeArgs[1][0]).toBe('Pro');
    expect(executeArgs[1][1]).toBe(250);
    expect(String(executeArgs[1][3])).toContain('"invoice_unit_amount_cents":599');
    expect(String(executeArgs[1][3])).toContain('"currency":"gbp"');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'superadmin.plan.updated',
    }));
  });

  it('creates a Stripe price when requested', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: '323e4567-e89b-12d3-a456-426614174000',
      stripe_price_id: null,
      features: {},
    });
    mockStripeProductCreate.mockResolvedValueOnce({ id: 'prod_123' });
    mockStripePriceCreate.mockResolvedValueOnce({ id: 'price_new_123' });

    const res = await handler(new Request('http://localhost/api/licenses/plans', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 250,
        unit_amount_cents: 999,
        currency: 'usd',
        create_stripe_price: true,
        stripe_interval_months: 24,
      }),
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockStripeProductCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Pro',
    }));
    expect(mockStripePriceCreate).toHaveBeenCalledWith(expect.objectContaining({
      product: 'prod_123',
      unit_amount: 999,
      currency: 'usd',
      recurring: {
        interval: 'month',
        interval_count: 24,
      },
    }));
    const executeArgs = mockExecute.mock.calls[0];
    expect(executeArgs[1][2]).toBe('price_new_123');
  });

  it('normalizes stripe_interval_months to supported bounds when creating Stripe price', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: '323e4567-e89b-12d3-a456-426614174000',
      stripe_price_id: null,
      features: {},
    });
    mockStripeProductCreate.mockResolvedValueOnce({ id: 'prod_456' });
    mockStripePriceCreate.mockResolvedValueOnce({ id: 'price_new_456' });

    const res = await handler(new Request('http://localhost/api/licenses/plans', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 250,
        unit_amount_cents: 999,
        currency: 'usd',
        create_stripe_price: true,
        stripe_interval_months: 99,
      }),
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockStripePriceCreate).toHaveBeenCalledWith(expect.objectContaining({
      recurring: {
        interval: 'month',
        interval_count: 1,
      },
    }));
  });

  it('returns 500 when Stripe price creation fails', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: '323e4567-e89b-12d3-a456-426614174000',
      stripe_price_id: null,
      features: {},
    });
    mockStripeProductCreate.mockResolvedValueOnce({ id: 'prod_fail' });
    mockStripePriceCreate.mockRejectedValueOnce(new Error('stripe unavailable'));

    const res = await handler(new Request('http://localhost/api/licenses/plans', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 250,
        unit_amount_cents: 999,
        currency: 'usd',
        create_stripe_price: true,
        stripe_interval_months: 1,
      }),
    }), {} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects duplicate Stripe price creation when plan already has stripe_price_id', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: '323e4567-e89b-12d3-a456-426614174000',
      stripe_price_id: 'price_existing_123',
      features: {},
    });

    const res = await handler(new Request('http://localhost/api/licenses/plans', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 250,
        unit_amount_cents: 999,
        currency: 'usd',
        create_stripe_price: true,
      }),
    }), {} as never);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'This plan already has a Stripe price. Clear stripe_price_id before creating a new Stripe price.',
    });
    expect(mockStripeProductCreate).not.toHaveBeenCalled();
    expect(mockStripePriceCreate).not.toHaveBeenCalled();
  });

  it('deletes a non-stripe plan when it is not used by subscriptions', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Legacy Plan',
        stripe_price_id: null,
      })
      .mockResolvedValueOnce({
        usage_count: 0,
      });

    const res = await handler(
      new Request('http://localhost/api/licenses/plans?id=323e4567-e89b-12d3-a456-426614174000', {
        method: 'DELETE',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM license_plans WHERE id = $1',
      ['323e4567-e89b-12d3-a456-426614174000']
    );
  });

  it('rejects deleting a plan linked to Stripe', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: '323e4567-e89b-12d3-a456-426614174000',
      name: 'Pro',
      stripe_price_id: 'price_123',
    });

    const res = await handler(
      new Request('http://localhost/api/licenses/plans?id=323e4567-e89b-12d3-a456-426614174000', {
        method: 'DELETE',
      }),
      {} as never
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Cannot delete a plan linked to Stripe. Hide it instead.',
    });
  });
});
