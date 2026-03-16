import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecute,
  mockQuery,
  mockQueryOne,
  mockRequireAuth,
  mockRequireWorkspaceResourcePermission,
  mockRequireEnvironmentPermission,
  mockEncrypt,
  mockCreateWorkspaceStripeClient,
  mockGetWorkspaceStripeCredentials,
  mockGetWorkspaceLicensingSettings,
  mockLogAudit,
  mockCustomersCreate,
  mockCheckoutCreate,
  mockProductsCreate,
  mockProductsRetrieve,
  mockProductsUpdate,
  mockPricesCreate,
  mockPricesRetrieve,
  mockPricesUpdate,
} = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockRequireWorkspaceResourcePermission: vi.fn(),
  mockRequireEnvironmentPermission: vi.fn(),
  mockEncrypt: vi.fn(),
  mockCreateWorkspaceStripeClient: vi.fn(),
  mockGetWorkspaceStripeCredentials: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockLogAudit: vi.fn(),
  mockCustomersCreate: vi.fn(),
  mockCheckoutCreate: vi.fn(),
  mockProductsCreate: vi.fn(),
  mockProductsRetrieve: vi.fn(),
  mockProductsUpdate: vi.fn(),
  mockPricesCreate: vi.fn(),
  mockPricesRetrieve: vi.fn(),
  mockPricesUpdate: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne,
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: mockRequireWorkspaceResourcePermission,
  requireEnvironmentPermission: mockRequireEnvironmentPermission,
}));

vi.mock('../_lib/crypto.js', () => ({
  encrypt: mockEncrypt,
}));

vi.mock('../_lib/workspace-stripe.js', () => ({
  createWorkspaceStripeClient: mockCreateWorkspaceStripeClient,
  getWorkspaceStripeCredentials: mockGetWorkspaceStripeCredentials,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
}));

import handler from '../workspace-billing.ts';

beforeEach(() => {
  mockExecute.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockRequireAuth.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockEncrypt.mockReset();
  mockCreateWorkspaceStripeClient.mockReset();
  mockGetWorkspaceStripeCredentials.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockLogAudit.mockReset();
  mockCustomersCreate.mockReset();
  mockCheckoutCreate.mockReset();
  mockProductsCreate.mockReset();
  mockProductsRetrieve.mockReset();
  mockProductsUpdate.mockReset();
  mockPricesCreate.mockReset();
  mockPricesRetrieve.mockReset();
  mockPricesUpdate.mockReset();

  mockEncrypt.mockImplementation((value: string) => `enc:${value}`);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined);
  mockCreateWorkspaceStripeClient.mockReturnValue({
    customers: { create: mockCustomersCreate },
    checkout: { sessions: { create: mockCheckoutCreate } },
    billingPortal: { sessions: { create: vi.fn() } },
    products: {
      create: mockProductsCreate,
      retrieve: mockProductsRetrieve,
      update: mockProductsUpdate,
    },
    prices: {
      create: mockPricesCreate,
      retrieve: mockPricesRetrieve,
      update: mockPricesUpdate,
    },
  });
  mockProductsCreate.mockResolvedValue({ id: 'prod_1' });
  mockProductsRetrieve.mockResolvedValue({ id: 'prod_1' });
  mockProductsUpdate.mockResolvedValue({ id: 'prod_1' });
  mockPricesCreate.mockResolvedValue({ id: 'price_1' });
  mockPricesRetrieve.mockResolvedValue({
    id: 'price_1',
    active: true,
    unit_amount: 500,
    currency: 'usd',
    product: 'prod_1',
    recurring: {
      interval: 'month',
      interval_count: 1,
    },
  });
  mockPricesUpdate.mockResolvedValue({ id: 'price_1', active: false });
  mockGetWorkspaceLicensingSettings.mockResolvedValue({
    platform_licensing_enabled: true,
    workspace_licensing_enabled: true,
    effective_licensing_enabled: true,
    inherit_platform_free_tier: true,
    free_enabled: true,
    free_seat_limit: 10,
    workspace_free_enabled: true,
    workspace_free_seat_limit: 10,
    platform_default_free_enabled: true,
    platform_default_free_seat_limit: 10,
    billing_method: 'stripe',
    customer_owner_enabled: false,
    grace_day_block: 10,
    grace_day_disable: 30,
    grace_day_wipe: 45,
  });
});

describe('workspace-billing', () => {
  it('returns disabled workspace billing config when licensing is disabled', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: {
        id: 'user_1',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
    mockGetWorkspaceLicensingSettings.mockResolvedValueOnce({
      platform_licensing_enabled: true,
      workspace_licensing_enabled: false,
      effective_licensing_enabled: false,
      inherit_platform_free_tier: true,
      free_enabled: true,
      free_seat_limit: 10,
      workspace_free_enabled: true,
      workspace_free_seat_limit: 10,
      platform_default_free_enabled: true,
      platform_default_free_seat_limit: 10,
      billing_method: 'stripe',
      customer_owner_enabled: false,
      grace_day_block: 10,
      grace_day_disable: 30,
      grace_day_wipe: 45,
    });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/config?workspace_id=123e4567-e89b-12d3-a456-426614174000', {
        method: 'GET',
      }),
      {} as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workspace_id: '123e4567-e89b-12d3-a456-426614174000',
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
    expect(
      mockRequireWorkspaceResourcePermission.mock.calls.some(
        ([, workspaceId, resource, permission]) =>
          workspaceId === '123e4567-e89b-12d3-a456-426614174000'
          && resource === 'workspace'
          && permission === 'read'
      )
    ).toBe(true);
    expect(
      mockRequireWorkspaceResourcePermission.mock.calls.some(([, , resource]) => resource === 'billing')
    ).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rejects API keys for billing config updates', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'api_key',
      apiKey: {
        id: 'key_1',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
        environment_id: null,
        role: 'owner',
        created_by_user_id: null,
      },
    });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: '123e4567-e89b-12d3-a456-426614174000',
          mode: 'stripe',
        }),
      }),
      {} as never
    );

    expect(response.status).toBe(403);
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
  });

  it('rejects checkout redirects that do not match request origin', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: {
        id: 'user_1',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
    mockGetWorkspaceStripeCredentials.mockResolvedValue({
      mode: 'stripe',
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      publishableKey: 'pk_test',
    });
    mockQueryOne
      .mockResolvedValueOnce({
        id: '223e4567-e89b-12d3-a456-426614174000',
        name: 'Env',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        default_pricing_id: '323e4567-e89b-12d3-a456-426614174000',
        default_currency: 'usd',
      })
      .mockResolvedValueOnce({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Monthly',
        seat_price_cents: 500,
        duration_months: 1,
        active: true,
        metadata: {
          stripe_price_id: 'price_workspace_monthly',
        },
      });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_1' });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          environment_id: '223e4567-e89b-12d3-a456-426614174000',
          success_url: 'https://evil.example/phish',
        }),
      }),
      {} as never
    );

    expect(response.status).toBe(400);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('preserves encrypted keys when blank key fields are submitted', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: {
        id: 'user_1',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
    mockQueryOne.mockResolvedValueOnce({
      stripe_secret_key_enc: 'enc:existing-secret',
      stripe_webhook_secret_enc: 'enc:existing-webhook',
    });
    mockExecute.mockResolvedValue({ rowCount: 1 });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: '123e4567-e89b-12d3-a456-426614174000',
          mode: 'stripe',
          stripe_secret_key: '',
          stripe_webhook_secret: '',
        }),
      }),
      {} as never
    );

    expect(response.status).toBe(200);
    const executeParams = mockExecute.mock.calls[0][1];
    expect(executeParams[2]).toBe('enc:existing-secret');
    expect(executeParams[3]).toBe('enc:existing-webhook');
  });

  it('syncs workspace pricing entries to Stripe product/price catalog on save', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: {
        id: 'user_1',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
    mockGetWorkspaceStripeCredentials.mockResolvedValue({
      mode: 'stripe',
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      publishableKey: 'pk_test',
    });
    mockQueryOne.mockResolvedValueOnce({
      default_currency: 'gbp',
    });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/pricing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Annual',
          seat_price_cents: 1200,
          duration_months: 12,
          active: true,
        }),
      }),
      {} as never
    );

    expect(response.status).toBe(200);
    expect(mockProductsCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Annual',
    }));
    expect(mockPricesCreate).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'gbp',
      unit_amount: 1200,
      recurring: {
        interval: 'month',
        interval_count: 12,
      },
    }));
    const insertParams = mockExecute.mock.calls[0][1];
    expect(String(insertParams[6])).toContain('"stripe_price_id":"price_1"');
  });

  it('creates subscription-mode Stripe checkout sessions for recurring workspace billing', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: {
        id: 'user_1',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
    mockGetWorkspaceStripeCredentials.mockResolvedValue({
      mode: 'stripe',
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      publishableKey: 'pk_test',
    });
    mockQueryOne
      .mockResolvedValueOnce({
        id: '223e4567-e89b-12d3-a456-426614174000',
        name: 'Env',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        default_pricing_id: '323e4567-e89b-12d3-a456-426614174000',
        default_currency: 'usd',
      })
      .mockResolvedValueOnce({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Annual',
        seat_price_cents: 1200,
        duration_months: 12,
        active: true,
        metadata: {
          stripe_price_id: 'price_workspace_annual',
        },
      });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_1' });
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/session_1' });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          environment_id: '223e4567-e89b-12d3-a456-426614174000',
          seat_count: 5,
        }),
      }),
      {} as never
    );

    expect(response.status).toBe(200);
    const payload = mockCheckoutCreate.mock.calls[0][0];
    expect(payload.mode).toBe('subscription');
    expect(payload.line_items?.[0]?.price).toBe('price_workspace_annual');
    expect(payload.subscription_data?.metadata?.billing_mode).toBe('subscription');
    expect(payload.metadata?.duration_months).toBe('12');
  });


  it('allows environment-scoped admins to checkout via environment permission fallback', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: { id: 'user_1', workspace_id: '123e4567-e89b-12d3-a456-426614174000' },
    });
    mockRequireWorkspaceResourcePermission.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient workspace role' }), { status: 403 })
    );
    mockGetWorkspaceStripeCredentials.mockResolvedValue({
      mode: 'stripe',
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      publishableKey: 'pk_test',
    });
    mockQueryOne
      .mockResolvedValueOnce({
        id: '223e4567-e89b-12d3-a456-426614174000',
        name: 'Env',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        default_pricing_id: '323e4567-e89b-12d3-a456-426614174000',
        default_currency: 'usd',
      })
      .mockResolvedValueOnce({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Annual',
        seat_price_cents: 1200,
        duration_months: 12,
        active: true,
        metadata: { stripe_price_id: 'price_workspace_annual' },
      });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_1' });
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/session_1' });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          environment_id: '223e4567-e89b-12d3-a456-426614174000',
          seat_count: 2,
        }),
      }),
      {} as never
    );

    expect(response.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      expect.anything(),
      '223e4567-e89b-12d3-a456-426614174000',
      'write'
    );
  });

  it('creates a manual environment entitlement grant without Stripe', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: {
        id: 'user_1',
        workspace_id: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
    mockQueryOne.mockResolvedValueOnce({
      id: '223e4567-e89b-12d3-a456-426614174000',
      name: 'Env',
      workspace_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    mockExecute.mockResolvedValue({ rowCount: 1 });

    const response = await handler(
      new Request('http://localhost/api/workspace-billing/grants/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          environment_id: '223e4567-e89b-12d3-a456-426614174000',
          seat_count: 25,
          duration_months: 12,
          grant_type: 'free',
          note: 'Community tier',
        }),
      }),
      {} as never
    );

    expect(response.status).toBe(201);
    expect(
      mockExecute.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO environment_entitlements')
      )
    ).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workspace_billing.entitlement.manual_granted',
      })
    );
  });
});
