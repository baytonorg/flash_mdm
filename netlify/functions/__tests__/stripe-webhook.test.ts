import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockQueryOne,
  mockExecute,
  mockTransaction,
  mockClientQuery,
  mockVerifyWebhookSignature,
  mockGetStripe,
  mockIsPlatformLicensingEnabled,
  mockGetWorkspaceLicensingSettings,
  mockLogAudit,
  mockQueueAndSendBillingEmail,
  mockGetWorkspaceScopeNames,
  mockBuildPaymentFailedEmail,
  mockBuildRenewalEmail,
} = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockClientQuery: vi.fn(),
  mockVerifyWebhookSignature: vi.fn(),
  mockGetStripe: vi.fn(),
  mockIsPlatformLicensingEnabled: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockLogAudit: vi.fn(),
  mockQueueAndSendBillingEmail: vi.fn(),
  mockGetWorkspaceScopeNames: vi.fn(),
  mockBuildPaymentFailedEmail: vi.fn(),
  mockBuildRenewalEmail: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: mockQueryOne,
  execute: mockExecute,
  transaction: mockTransaction,
}));

vi.mock('../_lib/stripe.js', () => ({
  verifyWebhookSignature: mockVerifyWebhookSignature,
  getStripe: mockGetStripe,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/billing-notifications.js', () => ({
  queueAndSendBillingEmail: mockQueueAndSendBillingEmail,
  getWorkspaceScopeNames: mockGetWorkspaceScopeNames,
  buildPaymentFailedEmail: mockBuildPaymentFailedEmail,
  buildRenewalEmail: mockBuildRenewalEmail,
}));

vi.mock('../_lib/licensing.js', () => ({
  isPlatformLicensingEnabled: mockIsPlatformLicensingEnabled,
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
}));

import handler from '../stripe-webhook.ts';

function makeWebhookRequest(body: string): Request {
  return new Request('http://localhost/.netlify/functions/stripe-webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': 'sig_test',
      'content-type': 'application/json',
    },
    body,
  });
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockClientQuery.mockReset();
  mockVerifyWebhookSignature.mockReset();
  mockGetStripe.mockReset();
  mockIsPlatformLicensingEnabled.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockLogAudit.mockReset();
  mockQueueAndSendBillingEmail.mockReset();
  mockGetWorkspaceScopeNames.mockReset();
  mockBuildPaymentFailedEmail.mockReset();
  mockBuildRenewalEmail.mockReset();
  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockQueueAndSendBillingEmail.mockResolvedValue({ queued: true, sent: true, skipped: false });
  mockGetWorkspaceScopeNames.mockResolvedValue({ workspaceName: 'Workspace', environmentName: null });
  mockBuildPaymentFailedEmail.mockReturnValue({ subject: 'failed', html: '<p>failed</p>' });
  mockBuildRenewalEmail.mockReturnValue({ subject: 'renewed', html: '<p>renewed</p>' });

  mockTransaction.mockImplementation(async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) =>
    fn({ query: mockClientQuery })
  );

  mockGetStripe.mockReturnValue({
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({
        items: {
          data: [{ price: { id: 'price_pro' } }],
        },
      }),
    },
  });
  mockIsPlatformLicensingEnabled.mockResolvedValue(true);
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

  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM workspace_billing_events')) return null;
    if (sql.includes('FROM license_plans')) return { id: 'plan_1', name: 'Pro' };
    if (sql.includes('FROM licenses WHERE stripe_subscription_id = $1')) return { workspace_id: 'ws_1' };
    return null;
  });

  mockVerifyWebhookSignature.mockReturnValue({
    type: 'checkout.session.completed',
    data: {
      object: {
        metadata: { workspace_id: 'ws_1' },
        subscription: 'sub_1',
      },
    },
  });
});

describe('stripe-webhook checkout.session.completed', () => {
  it('serializes license writes by locking the workspace row before update/insert', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(makeWebhookRequest('{"id":"evt_1"}'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
    const transactionalSql = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(transactionalSql.some((sql) => sql.includes('FROM workspaces') && sql.includes('FOR UPDATE'))).toBe(true);
    expect(transactionalSql.some((sql) => sql.includes('UPDATE licenses'))).toBe(true);
    expect(transactionalSql.some((sql) => sql.includes('INSERT INTO licenses'))).toBe(true);
    expect(transactionalSql.some((sql) => sql.includes('INSERT INTO license_grants'))).toBe(true);

    expect(
      mockQueryOne.mock.calls.some(([sql]) => String(sql).includes('FROM licenses'))
    ).toBe(false);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'license.activated' }));
  });

  it('skips insert when the transactional update finds an existing license row', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(makeWebhookRequest('{"id":"evt_2"}'), {} as never);

    expect(res.status).toBe(200);
    const transactionalSql = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(transactionalSql.some((sql) => sql.includes('UPDATE licenses'))).toBe(true);
    expect(transactionalSql.some((sql) => sql.includes('INSERT INTO licenses'))).toBe(false);
    expect(transactionalSql.some((sql) => sql.includes('INSERT INTO license_grants'))).toBe(true);
  });

  it('returns duplicate acknowledgement when platform event was already processed', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'evt_duplicate' });

    const res = await handler(makeWebhookRequest('{"id":"evt_duplicate"}'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('cancels active stripe grants when subscription is deleted', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'customer.subscription.deleted',
      id: 'evt_sub_deleted',
      data: {
        object: {
          id: 'sub_1',
          metadata: { workspace_id: 'ws_1' },
        },
      },
    });

    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(makeWebhookRequest('{"id":"evt_sub_deleted"}'), {} as never);

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
    const transactionalSql = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(transactionalSql.some((sql) => sql.includes('UPDATE licenses'))).toBe(true);
    expect(transactionalSql.some((sql) => sql.includes('UPDATE license_grants'))).toBe(true);
  });

  it('updates license status and period on subscription.updated', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'customer.subscription.updated',
      id: 'evt_sub_updated',
      data: {
        object: {
          id: 'sub_1',
          status: 'past_due',
          current_period_end: 1_700_000_000,
          metadata: { workspace_id: 'ws_1' },
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    });
    const res = await handler(makeWebhookRequest('{"id":"evt_sub_updated"}'), {} as never);

    expect(res.status).toBe(200);
    expect(
      mockExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE licenses SET') && String(sql).includes('current_period_end'))
    ).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'license.updated',
    }));
  });

  it('marks license as past_due on invoice.payment_failed', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.payment_failed',
      id: 'evt_invoice_failed',
      data: {
        object: {
          id: 'in_1',
          subscription: 'sub_1',
        },
      },
    });
    const res = await handler(makeWebhookRequest('{"id":"evt_invoice_failed"}'), {} as never);

    expect(res.status).toBe(200);
    expect(
      mockExecute.mock.calls.some(([sql]) => String(sql).includes("SET status = 'past_due'"))
    ).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'license.payment_failed',
    }));
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      notificationType: 'platform_payment_failed',
    }));
  });

  it('sends renewal billing notification on invoice.paid', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_invoice_paid',
      data: {
        object: {
          id: 'in_paid_1',
          subscription: 'sub_1',
          lines: { data: [{ quantity: 8 }] },
        },
      },
    });

    const res = await handler(makeWebhookRequest('{"id":"evt_invoice_paid"}'), {} as never);

    expect(res.status).toBe(200);
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      notificationType: 'platform_renewal',
      dedupeKey: 'platform:renewal:in_paid_1',
    }));
  });

  it('ignores webhook events when platform licensing is disabled', async () => {
    mockIsPlatformLicensingEnabled.mockResolvedValueOnce(false);

    const res = await handler(makeWebhookRequest('{"id":"evt_platform_off"}'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, ignored: 'platform_licensing_disabled' });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('ignores webhook events when workspace licensing is disabled', async () => {
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

    const res = await handler(makeWebhookRequest('{"id":"evt_workspace_off"}'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, ignored: 'workspace_licensing_disabled' });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
