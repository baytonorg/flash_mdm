import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Stripe method spies
const mockCheckoutSessionsCreate = vi.fn();
const mockBillingPortalSessionsCreate = vi.fn();
const mockWebhooksConstructEvent = vi.fn();

// Use a real function (not arrow) so it can be used as a constructor with `new`
function MockStripe() {
  return {
    checkout: {
      sessions: {
        create: mockCheckoutSessionsCreate,
      },
    },
    billingPortal: {
      sessions: {
        create: mockBillingPortalSessionsCreate,
      },
    },
    webhooks: {
      constructEvent: mockWebhooksConstructEvent,
    },
  };
}

vi.mock('stripe', () => ({
  default: MockStripe,
}));

// Helper to get a fresh stripe module (resets singleton)
async function loadFreshStripeModule() {
  vi.resetModules();

  vi.doMock('stripe', () => ({
    default: MockStripe,
  }));

  return await import('../stripe.js');
}

describe('getStripe', () => {
  it('throws when STRIPE_SECRET_KEY is not set', async () => {
    const originalKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    const { getStripe } = await loadFreshStripeModule();
    expect(() => getStripe()).toThrow('STRIPE_SECRET_KEY is not configured');

    if (originalKey) process.env.STRIPE_SECRET_KEY = originalKey;
  });

  it('returns a Stripe instance when key is configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_123';

    const { getStripe } = await loadFreshStripeModule();
    const stripe = getStripe();
    expect(stripe).toBeDefined();
    expect(stripe.checkout).toBeDefined();
    expect(stripe.billingPortal).toBeDefined();
    expect(stripe.webhooks).toBeDefined();
  });

  it('returns the same instance on subsequent calls (singleton)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_123';

    const { getStripe } = await loadFreshStripeModule();
    const first = getStripe();
    const second = getStripe();
    expect(first).toBe(second);
  });
});

describe('createCheckoutSession', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_123';
    mockCheckoutSessionsCreate.mockReset();
  });

  it('calls stripe.checkout.sessions.create with correct parameters', async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_123',
    });

    const { createCheckoutSession } = await loadFreshStripeModule();
    const result = await createCheckoutSession(
      'ws_123',
      'price_abc',
      'cus_xyz',
      'https://app.example.com/billing'
    );

    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_xyz',
      mode: 'subscription',
      line_items: [{ price: 'price_abc', quantity: 1 }],
      success_url: 'https://app.example.com/billing?checkout=success',
      cancel_url: 'https://app.example.com/billing?checkout=cancelled',
      metadata: { workspace_id: 'ws_123' },
      subscription_data: {
        metadata: { workspace_id: 'ws_123' },
      },
    });

    expect(result).toBe('https://checkout.stripe.com/session_123');
  });

  it('throws when session.url is null', async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({ url: null });

    const { createCheckoutSession } = await loadFreshStripeModule();
    await expect(
      createCheckoutSession('ws_123', 'price_abc', 'cus_xyz', 'https://app.example.com')
    ).rejects.toThrow('Failed to create checkout session');
  });

  it('includes workspace_id in both metadata and subscription_data metadata', async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_123',
    });

    const { createCheckoutSession } = await loadFreshStripeModule();
    await createCheckoutSession('ws_456', 'price_def', 'cus_abc', 'https://example.com');

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(callArgs.metadata.workspace_id).toBe('ws_456');
    expect(callArgs.subscription_data.metadata.workspace_id).toBe('ws_456');
  });

  it('appends checkout=success and checkout=cancelled to URLs', async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_123',
    });

    const { createCheckoutSession } = await loadFreshStripeModule();
    await createCheckoutSession('ws_1', 'price_1', 'cus_1', 'https://example.com/billing');

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(callArgs.success_url).toBe('https://example.com/billing?checkout=success');
    expect(callArgs.cancel_url).toBe('https://example.com/billing?checkout=cancelled');
  });

  it('uses subscription mode', async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_123',
    });

    const { createCheckoutSession } = await loadFreshStripeModule();
    await createCheckoutSession('ws_1', 'price_1', 'cus_1', 'https://example.com');

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(callArgs.mode).toBe('subscription');
  });
});

describe('createPortalSession', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_123';
    mockBillingPortalSessionsCreate.mockReset();
  });

  it('calls stripe.billingPortal.sessions.create with correct parameters', async () => {
    mockBillingPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/portal_123',
    });

    const { createPortalSession } = await loadFreshStripeModule();
    const result = await createPortalSession('cus_xyz', 'https://app.example.com/billing');

    expect(mockBillingPortalSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_xyz',
      return_url: 'https://app.example.com/billing',
    });

    expect(result).toBe('https://billing.stripe.com/portal_123');
  });

  it('returns the portal session URL', async () => {
    const expectedUrl = 'https://billing.stripe.com/portal_abc';
    mockBillingPortalSessionsCreate.mockResolvedValue({ url: expectedUrl });

    const { createPortalSession } = await loadFreshStripeModule();
    const result = await createPortalSession('cus_abc', 'https://example.com');
    expect(result).toBe(expectedUrl);
  });
});

describe('verifyWebhookSignature', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_123';
    mockWebhooksConstructEvent.mockReset();
  });

  it('calls stripe.webhooks.constructEvent with body, signature, and secret', async () => {
    const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
    mockWebhooksConstructEvent.mockReturnValue(mockEvent);

    const { verifyWebhookSignature } = await loadFreshStripeModule();
    const result = verifyWebhookSignature(
      '{"id":"evt_123"}',
      'sig_header_value',
      'whsec_test_secret'
    );

    expect(mockWebhooksConstructEvent).toHaveBeenCalledWith(
      '{"id":"evt_123"}',
      'sig_header_value',
      'whsec_test_secret'
    );

    expect(result).toEqual(mockEvent);
  });

  it('propagates errors from constructEvent', async () => {
    mockWebhooksConstructEvent.mockImplementation(() => {
      throw new Error('Webhook signature verification failed');
    });

    const { verifyWebhookSignature } = await loadFreshStripeModule();
    expect(() =>
      verifyWebhookSignature('body', 'bad_sig', 'whsec_secret')
    ).toThrow('Webhook signature verification failed');
  });
});
