import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClientQuery = vi.fn();

const {
  mockTransaction,
  mockGetWorkspaceStripeCredentials,
  mockCreateWorkspaceStripeClient,
  mockGetWorkspaceLicensingSettings,
  mockLogAudit,
  mockConstructEvent,
  mockSubscriptionsRetrieve,
  mockQueueAndSendBillingEmail,
  mockGetWorkspaceScopeNames,
  mockBuildRenewalEmail,
  mockBuildPaymentFailedEmail,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockGetWorkspaceStripeCredentials: vi.fn(),
  mockCreateWorkspaceStripeClient: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockLogAudit: vi.fn(),
  mockConstructEvent: vi.fn(),
  mockSubscriptionsRetrieve: vi.fn(),
  mockQueueAndSendBillingEmail: vi.fn(),
  mockGetWorkspaceScopeNames: vi.fn(),
  mockBuildRenewalEmail: vi.fn(),
  mockBuildPaymentFailedEmail: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  transaction: mockTransaction,
}));

vi.mock('../_lib/workspace-stripe.js', () => ({
  getWorkspaceStripeCredentials: mockGetWorkspaceStripeCredentials,
  createWorkspaceStripeClient: mockCreateWorkspaceStripeClient,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/billing-notifications.js', () => ({
  queueAndSendBillingEmail: mockQueueAndSendBillingEmail,
  getWorkspaceScopeNames: mockGetWorkspaceScopeNames,
  buildRenewalEmail: mockBuildRenewalEmail,
  buildPaymentFailedEmail: mockBuildPaymentFailedEmail,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
}));

import handler from '../workspace-billing-webhook.ts';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  mockClientQuery.mockReset();
  mockTransaction.mockReset();
  mockGetWorkspaceStripeCredentials.mockReset();
  mockCreateWorkspaceStripeClient.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockLogAudit.mockReset();
  mockConstructEvent.mockReset();
  mockSubscriptionsRetrieve.mockReset();
  mockQueueAndSendBillingEmail.mockReset();
  mockGetWorkspaceScopeNames.mockReset();
  mockBuildRenewalEmail.mockReset();
  mockBuildPaymentFailedEmail.mockReset();

  mockTransaction.mockImplementation(async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) =>
    fn({ query: mockClientQuery })
  );

  mockGetWorkspaceStripeCredentials.mockResolvedValue({
    mode: 'stripe',
    secretKey: 'sk_test',
    webhookSecret: 'whsec_test',
    publishableKey: 'pk_test',
  });

  mockCreateWorkspaceStripeClient.mockReturnValue({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    subscriptions: {
      retrieve: mockSubscriptionsRetrieve,
    },
  });
  mockSubscriptionsRetrieve.mockResolvedValue({ metadata: {} });
  mockQueueAndSendBillingEmail.mockResolvedValue({ queued: true, sent: true, skipped: false });
  mockGetWorkspaceScopeNames.mockResolvedValue({ workspaceName: 'Workspace', environmentName: 'Testing' });
  mockBuildRenewalEmail.mockReturnValue({ subject: 'renewal', html: '<p>renewal</p>' });
  mockBuildPaymentFailedEmail.mockReturnValue({ subject: 'failed', html: '<p>failed</p>' });
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

describe('workspace-billing-webhook', () => {
  it('rejects non-UUID workspace id query params', async () => {
    const res = await handler(
      new Request('http://localhost/api/workspace-billing/webhook?workspace_id=not-a-uuid', {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
        },
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'workspace_id must be a valid UUID',
    });
  });

  it('returns duplicate acknowledgement when event id already exists', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_duplicate',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test',
          metadata: { environment_id: 'env_1', workspace_id: WORKSPACE_ID },
        },
      },
    });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await handler(
      new Request(`http://localhost/api/workspace-billing/webhook?workspace_id=${WORKSPACE_ID}`, {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
          'content-type': 'application/json',
        },
        body: '{"id":"evt_duplicate"}',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('creates environment entitlement on checkout.session.completed', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          metadata: {
            workspace_id: WORKSPACE_ID,
            environment_id: '223e4567-e89b-12d3-a456-426614174000',
            seat_count: '5',
            duration_months: '12',
            workspace_customer_id: 'cust_1',
            pricing_id: 'pricing_1',
          },
        },
      },
    });

    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ workspace_id: WORKSPACE_ID }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(
      new Request(`http://localhost/api/workspace-billing/webhook?workspace_id=${WORKSPACE_ID}`, {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
          'content-type': 'application/json',
        },
        body: '{"id":"evt_checkout_1"}',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO environment_entitlements'))).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace_billing.entitlement.granted',
    }));
  });

  it('defers entitlement grant on checkout.session.completed when billing mode is subscription', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_checkout_sub_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_sub_1',
          metadata: {
            workspace_id: WORKSPACE_ID,
            environment_id: '223e4567-e89b-12d3-a456-426614174000',
            seat_count: '5',
            duration_months: '12',
            billing_mode: 'subscription',
          },
        },
      },
    });

    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(
      new Request(`http://localhost/api/workspace-billing/webhook?workspace_id=${WORKSPACE_ID}`, {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
          'content-type': 'application/json',
        },
        body: '{"id":"evt_checkout_sub_1"}',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, deferred: 'awaiting_invoice_paid' });
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO environment_entitlements'))).toBe(false);
  });

  it('creates environment entitlement on invoice.paid renewal events', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_invoice_paid_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_123',
          subscription: 'sub_123',
          parent: {
            subscription_details: {
              metadata: {
                workspace_id: WORKSPACE_ID,
              },
            },
          },
        },
      },
    });
    mockSubscriptionsRetrieve.mockResolvedValueOnce({
      metadata: {
        environment_id: '223e4567-e89b-12d3-a456-426614174000',
        seat_count: '6',
        duration_months: '1',
        workspace_customer_id: 'cust_1',
        pricing_id: 'pricing_1',
        billing_mode: 'subscription',
      },
    });

    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ workspace_id: WORKSPACE_ID }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(
      new Request(`http://localhost/api/workspace-billing/webhook?workspace_id=${WORKSPACE_ID}`, {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
          'content-type': 'application/json',
        },
        body: '{"id":"evt_invoice_paid_1"}',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_123');
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO environment_entitlements'))).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace_billing.entitlement.renewed',
    }));
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      environmentId: '223e4567-e89b-12d3-a456-426614174000',
      notificationType: 'workspace_renewal',
    }));
  });

  it('sends billing notification on invoice.payment_failed events', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_invoice_failed_ws',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed_1',
          subscription: 'sub_123',
          parent: {
            subscription_details: {
              metadata: {
                workspace_id: WORKSPACE_ID,
              },
            },
          },
        },
      },
    });
    mockSubscriptionsRetrieve.mockResolvedValueOnce({
      metadata: {
        environment_id: '223e4567-e89b-12d3-a456-426614174000',
      },
    });

    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(
      new Request(`http://localhost/api/workspace-billing/webhook?workspace_id=${WORKSPACE_ID}`, {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
          'content-type': 'application/json',
        },
        body: '{"id":"evt_invoice_failed_ws"}',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      environmentId: '223e4567-e89b-12d3-a456-426614174000',
      notificationType: 'workspace_payment_failed',
      dedupeKey: 'workspace:payment_failed:evt_invoice_failed_ws',
    }));
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

    const res = await handler(
      new Request(`http://localhost/api/workspace-billing/webhook?workspace_id=${WORKSPACE_ID}`, {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
          'content-type': 'application/json',
        },
        body: '{"id":"evt_workspace_off"}',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, ignored: 'licensing_disabled' });
    expect(mockCreateWorkspaceStripeClient).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
