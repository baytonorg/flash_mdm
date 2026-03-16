import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAuth,
  mockQuery,
  mockQueryOne,
  mockRequireWorkspaceResourcePermission,
  mockGetStripe,
  mockCreateCheckoutSession,
  mockLogAudit,
  mockGetWorkspaceLicensingSettings,
  mockGetWorkspaceAvailableGiftSeats,
  mockCustomersCreate,
  mockCustomersUpdate,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockRequireWorkspaceResourcePermission: vi.fn(),
  mockGetStripe: vi.fn(),
  mockCreateCheckoutSession: vi.fn(),
  mockLogAudit: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockGetWorkspaceAvailableGiftSeats: vi.fn(),
  mockCustomersCreate: vi.fn(),
  mockCustomersUpdate: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../_lib/db.js', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: mockRequireWorkspaceResourcePermission,
}));

vi.mock('../_lib/stripe.js', () => ({
  getStripe: mockGetStripe,
  createCheckoutSession: mockCreateCheckoutSession,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
  getWorkspaceAvailableGiftSeats: mockGetWorkspaceAvailableGiftSeats,
}));

import handler from '../stripe-checkout.ts';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';
const PLAN_ID = '223e4567-e89b-12d3-a456-426614174001';

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';

  mockRequireAuth.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockGetStripe.mockReset();
  mockCreateCheckoutSession.mockReset();
  mockLogAudit.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockGetWorkspaceAvailableGiftSeats.mockReset();
  mockCustomersCreate.mockReset();
  mockCustomersUpdate.mockReset();

  mockRequireAuth.mockResolvedValue({
    authType: 'session',
    user: { id: 'user_1', workspace_id: WORKSPACE_ID },
  });
  mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
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
  mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.test/session_1');
  mockGetStripe.mockReturnValue({
    customers: {
      create: mockCustomersCreate,
      update: mockCustomersUpdate,
    },
  });
  mockCustomersCreate.mockResolvedValue({ id: 'cus_new' });
});

describe('stripe-checkout', () => {
  it('applies gift offset seats and bills only the remaining quantity', async () => {
    mockGetWorkspaceAvailableGiftSeats.mockResolvedValueOnce(3);
    mockQueryOne
      .mockResolvedValueOnce({ id: 'plan_1', name: 'Pro', stripe_price_id: 'price_1' })
      .mockResolvedValueOnce({ id: WORKSPACE_ID, name: 'Acme Workspace', stripe_customer_id: 'cus_existing' })
      .mockResolvedValueOnce(null);

    const res = await handler(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          plan_id: PLAN_ID,
          seat_count: 10,
          duration_months: 12,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ checkout_url: 'https://checkout.stripe.test/session_1' });
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'price_1',
      'cus_existing',
      'http://localhost/licenses',
      expect.objectContaining({
        quantity: 7,
        metadata: expect.objectContaining({
          seat_count: '7',
          requested_seat_count: '10',
          gift_offset_seats: '3',
          duration_months: '12',
        }),
      })
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'stripe.checkout.created',
      details: expect.objectContaining({
        seat_count: 7,
        requested_seat_count: 10,
        gift_offset_seats: 3,
      }),
    }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects checkout when gifts fully cover requested seats', async () => {
    mockGetWorkspaceAvailableGiftSeats.mockResolvedValueOnce(10);
    mockQueryOne
      .mockResolvedValueOnce({ id: 'plan_1', name: 'Pro', stripe_price_id: 'price_1' })
      .mockResolvedValueOnce({ id: WORKSPACE_ID, name: 'Acme Workspace', stripe_customer_id: 'cus_existing' })
      .mockResolvedValueOnce(null);

    const res = await handler(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          plan_id: PLAN_ID,
          seat_count: 5,
          duration_months: 1,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Requested seats are fully covered by gifted seats. No Stripe payment is required.',
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('creates a stripe customer when the workspace has none before applying gift offset', async () => {
    mockGetWorkspaceAvailableGiftSeats.mockResolvedValueOnce(2);
    mockQueryOne
      .mockResolvedValueOnce({ id: 'plan_1', name: 'Pro', stripe_price_id: 'price_1' })
      .mockResolvedValueOnce({ id: WORKSPACE_ID, name: 'Acme Workspace', stripe_customer_id: null })
      .mockResolvedValueOnce({
        billing_contact_name: 'James McCarthy',
        billing_business_name: 'Bayton Ltd',
        billing_email: 'billing@bayton.org',
      });

    const res = await handler(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          plan_id: PLAN_ID,
          seat_count: 3,
          duration_months: 2,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      name: 'Bayton Ltd',
      email: 'billing@bayton.org',
      metadata: {
        workspace_id: WORKSPACE_ID,
        billing_contact_name: 'James McCarthy',
        billing_business_name: 'Bayton Ltd',
        billing_email: 'billing@bayton.org',
      },
    });
    expect(
      mockQuery.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string'
          && sql.includes('UPDATE workspaces SET stripe_customer_id = $1')
          && (params as unknown[])[0] === 'cus_new'
      )
    ).toBe(true);
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'price_1',
      'cus_new',
      'http://localhost/licenses',
      expect.objectContaining({
        quantity: 1,
        metadata: expect.objectContaining({
          requested_seat_count: '3',
          gift_offset_seats: '2',
          seat_count: '1',
        }),
      })
    );
  });

  it('coerces non-numeric seat and duration values to safe defaults', async () => {
    mockGetWorkspaceAvailableGiftSeats.mockResolvedValueOnce(0);
    mockQueryOne
      .mockResolvedValueOnce({ id: 'plan_1', name: 'Pro', stripe_price_id: 'price_1' })
      .mockResolvedValueOnce({ id: WORKSPACE_ID, name: 'Acme Workspace', stripe_customer_id: 'cus_existing' })
      .mockResolvedValueOnce(null);

    const res = await handler(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          plan_id: PLAN_ID,
          seat_count: 'not-a-number',
          duration_months: 'NaN',
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'price_1',
      'cus_existing',
      'http://localhost/licenses',
      expect.objectContaining({
        quantity: 1,
        metadata: expect.objectContaining({
          requested_seat_count: '1',
          seat_count: '1',
          duration_months: '1',
        }),
      })
    );
  });

  it('updates existing workspace Stripe customer with configured workspace billing defaults', async () => {
    mockGetWorkspaceAvailableGiftSeats.mockResolvedValueOnce(0);
    mockQueryOne
      .mockResolvedValueOnce({ id: 'plan_1', name: 'Pro', stripe_price_id: 'price_1' })
      .mockResolvedValueOnce({ id: WORKSPACE_ID, name: 'Acme Workspace', stripe_customer_id: 'cus_existing' })
      .mockResolvedValueOnce({
        billing_contact_name: 'James McCarthy',
        billing_business_name: 'Bayton Ltd',
        billing_email: 'billing@bayton.org',
      });

    const res = await handler(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          plan_id: PLAN_ID,
          seat_count: 2,
          duration_months: 1,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockCustomersUpdate).toHaveBeenCalledWith('cus_existing', {
      name: 'Bayton Ltd',
      email: 'billing@bayton.org',
    });
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });
});
