import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockQueryOne,
  mockExecute,
  mockTransaction,
  mockClientQuery,
  mockEventQuery,
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
  mockEventQuery: vi.fn(),
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
  mockEventQuery.mockReset();
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
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  mockEventQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO workspace_billing_events')) {
      return { rows: [{ id: 'billing_event_1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  mockQueueAndSendBillingEmail.mockResolvedValue({ queued: true, sent: true, skipped: false });
  mockGetWorkspaceScopeNames.mockResolvedValue({ workspaceName: 'Workspace', environmentName: null });
  mockBuildPaymentFailedEmail.mockReturnValue({ subject: 'failed', html: '<p>failed</p>' });
  mockBuildRenewalEmail.mockReturnValue({ subject: 'renewed', html: '<p>renewed</p>' });

  mockTransaction.mockImplementation(async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) =>
    fn({
      query: ((sql: string, params?: unknown[]) => {
        if (sql.includes('workspace_billing_events')) {
          return mockEventQuery(sql, params);
        }
        return mockClientQuery(sql, params);
      }) as typeof mockClientQuery,
    })
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
    id: 'evt_default',
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

  it('claims and completes the event in the same transaction', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await handler(makeWebhookRequest('{"id":"evt_atomic"}'), {} as never);

    expect(res.status).toBe(200);
    const eventSql = mockEventQuery.mock.calls.map(([sql]) => String(sql));
    expect(eventSql).toHaveLength(2);
    expect(eventSql[0]).toContain('ON CONFLICT (source, event_id) DO UPDATE');
    expect(eventSql[0]).toContain('WHERE workspace_billing_events.processed_at IS NULL');
    expect(eventSql[0]).toContain('RETURNING id');
    expect(eventSql[1]).toContain('SET processed_at = now()');
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('reprocesses the same event after the first transaction fails', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      id: 'evt_retry_after_failure',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          status: 'active',
          metadata: { workspace_id: 'ws_1' },
          items: { data: [] },
        },
      },
    });
    mockClientQuery.mockRejectedValueOnce(new Error('temporary database failure'));

    const failed = await handler(
      makeWebhookRequest('{"id":"evt_retry_after_failure"}'),
      {} as never
    );
    const retried = await handler(
      makeWebhookRequest('{"id":"evt_retry_after_failure"}'),
      {} as never
    );

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({ received: true });
    const eventSql = mockEventQuery.mock.calls.map(([sql]) => String(sql));
    expect(eventSql.filter((sql) => sql.includes('INSERT INTO workspace_billing_events'))).toHaveLength(2);
    expect(eventSql.filter((sql) => sql.includes('SET processed_at = now()'))).toHaveLength(1);
    expect(
      mockClientQuery.mock.calls.filter(([sql]) => String(sql).includes('UPDATE licenses SET'))
    ).toHaveLength(2);
  });

  it('returns duplicate acknowledgement when platform event was already processed', async () => {
    mockEventQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await handler(makeWebhookRequest('{"id":"evt_duplicate"}'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockClientQuery).not.toHaveBeenCalled();
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
      mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE licenses SET') && String(sql).includes('current_period_end'))
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
      mockClientQuery.mock.calls.some(([sql]) => String(sql).includes("SET status = 'past_due'"))
    ).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'license.payment_failed',
    }));
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      notificationType: 'platform_payment_failed',
    }));
  });

  it('renews the stripe grant transactionally from the paid invoice period', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_invoice_paid',
      data: {
        object: {
          id: 'in_paid_1',
          created: 1_700_000_100,
          subscription: 'sub_1',
          lines: {
            data: [{
              quantity: 8,
              subscription: 'sub_1',
              period: { start: 1_700_000_000, end: 1_702_678_400 },
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: { proration: false },
              },
            }],
          },
        },
      },
    });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws_1', status: 'active' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'grant_1',
          ends_at: '2023-11-14T22:13:20.000Z',
          status: 'active',
          metadata: { subscription_id: 'sub_1' },
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await handler(makeWebhookRequest('{"id":"evt_invoice_paid"}'), {} as never);

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
    const transactionalSql = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(transactionalSql[0]).toContain('FROM licenses');
    expect(transactionalSql[0]).toContain('FOR UPDATE');
    expect(transactionalSql[1]).toContain('FROM license_grants');
    expect(transactionalSql[2]).toContain("SET status = 'active', current_period_end");
    expect(transactionalSql[3]).toContain('UPDATE license_grants');
    expect(mockClientQuery.mock.calls[3]?.[1]).toEqual([
      'grant_1',
      8,
      '2023-11-14T22:13:20.000Z',
      '2023-12-15T22:13:20.000Z',
      expect.stringContaining('"invoice_id":"in_paid_1"'),
    ]);
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      notificationType: 'platform_renewal',
      dedupeKey: 'platform:renewal:in_paid_1',
      payload: expect.objectContaining({
        seat_count: 8,
        period_start: '2023-11-14T22:13:20.000Z',
        period_end: '2023-12-15T22:13:20.000Z',
      }),
    }));
  });

  it('creates a subscription grant when a paid invoice has no existing grant', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_invoice_paid_missing_grant',
      data: {
        object: {
          id: 'in_paid_missing_grant',
          created: 1_700_000_100,
          subscription: 'sub_1',
          lines: {
            data: [{
              quantity: 5,
              subscription: 'sub_1',
              period: { start: 1_700_000_000, end: 1_702_678_400 },
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: { proration: false },
              },
            }],
          },
        },
      },
    });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws_1', status: 'active' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await handler(makeWebhookRequest('{"id":"evt_invoice_paid_missing_grant"}'), {} as never);

    expect(res.status).toBe(200);
    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO license_grants')
    );
    expect(insertCall?.[1]).toEqual([
      expect.any(String),
      'ws_1',
      5,
      '2023-11-14T22:13:20.000Z',
      '2023-12-15T22:13:20.000Z',
      'subscription:sub_1',
      expect.stringContaining('"invoice_id":"in_paid_missing_grant"'),
    ]);
  });

  it('applies a later seat change for the same subscription period', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_seat_change',
      data: {
        object: {
          id: 'in_seat_change',
          created: 1_700_100_000,
          subscription: 'sub_1',
          lines: {
            data: [{
              quantity: 12,
              subscription: 'sub_1',
              period: { start: 1_700_000_000, end: 1_702_678_400 },
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: { proration: false },
              },
            }],
          },
        },
      },
    });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws_1', status: 'active' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'grant_1',
          ends_at: '2023-12-15T22:13:20.000Z',
          status: 'active',
          metadata: { last_invoice_created: 1_700_000_100 },
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await handler(makeWebhookRequest('{"id":"evt_seat_change"}'), {} as never);

    expect(res.status).toBe(200);
    const grantUpdate = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE license_grants')
    );
    expect(grantUpdate?.[1]?.[1]).toBe(12);
  });

  it('ignores legacy proration lines when selecting renewed seats', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_legacy_proration',
      data: {
        object: {
          id: 'in_legacy_proration',
          created: 1_700_100_000,
          subscription: 'sub_1',
          lines: {
            data: [
              {
                quantity: 99,
                subscription: 'sub_1',
                price: { id: 'price_pro' },
                proration: true,
                period: { start: 1_700_100_000, end: 1_702_678_400 },
              },
              {
                quantity: 7,
                subscription: 'sub_1',
                price: { id: 'price_pro' },
                proration: false,
                period: { start: 1_700_000_000, end: 1_702_678_400 },
              },
            ],
          },
        },
      },
    });
    mockClientQuery
      .mockResolvedValueOnce({
        rows: [{ workspace_id: 'ws_1', status: 'active', stripe_price_id: 'price_pro' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await handler(makeWebhookRequest('{"id":"evt_legacy_proration"}'), {} as never);

    expect(res.status).toBe(200);
    const grantInsert = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO license_grants')
    );
    expect(grantInsert?.[1]?.[2]).toBe(7);
  });

  it('selects the invoice line matching the licensed Stripe price', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_multi_item',
      data: {
        object: {
          id: 'in_multi_item',
          created: 1_700_100_000,
          subscription: 'sub_1',
          lines: {
            data: [
              {
                quantity: 50,
                subscription: 'sub_1',
                period: { start: 1_700_000_000, end: 1_702_678_400 },
                pricing: { price_details: { price: 'price_addon' } },
                parent: {
                  type: 'subscription_item_details',
                  subscription_item_details: { proration: false },
                },
              },
              {
                quantity: 6,
                subscription: 'sub_1',
                period: { start: 1_700_000_000, end: 1_702_678_400 },
                pricing: { price_details: { price: 'price_pro' } },
                parent: {
                  type: 'subscription_item_details',
                  subscription_item_details: { proration: false },
                },
              },
            ],
          },
        },
      },
    });
    mockClientQuery
      .mockResolvedValueOnce({
        rows: [{ workspace_id: 'ws_1', status: 'active', stripe_price_id: 'price_pro' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await handler(makeWebhookRequest('{"id":"evt_multi_item"}'), {} as never);

    expect(res.status).toBe(200);
    const grantInsert = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO license_grants')
    );
    expect(grantInsert?.[1]?.[2]).toBe(6);
  });

  it('returns a retryable failure without claiming invoice.paid before checkout creates the license', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_invoice_before_checkout',
      data: {
        object: {
          id: 'in_before_checkout',
          created: 1_700_100_000,
          subscription: 'sub_not_ready',
          lines: {
            data: [{
              quantity: 5,
              subscription: 'sub_not_ready',
              period: { start: 1_700_000_000, end: 1_702_678_400 },
            }],
          },
        },
      },
    });
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workspace_billing_events')) return null;
      if (sql.includes('FROM licenses WHERE stripe_subscription_id = $1')) return null;
      return null;
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await handler(makeWebhookRequest('{"id":"evt_invoice_before_checkout"}'), {} as never);

    expect(res.status).toBe(500);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
    expect(mockQueueAndSendBillingEmail).not.toHaveBeenCalled();
  });

  it('does not let an older paid invoice shorten or overwrite a newer grant', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_old_invoice',
      data: {
        object: {
          id: 'in_old',
          created: 1_700_000_000,
          subscription: 'sub_1',
          lines: {
            data: [{
              quantity: 4,
              subscription: 'sub_1',
              period: { start: 1_700_000_000, end: 1_702_678_400 },
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: { proration: false },
              },
            }],
          },
        },
      },
    });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws_1', status: 'active' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'grant_1',
          ends_at: '2024-01-15T22:13:20.000Z',
          status: 'active',
          metadata: { last_invoice_created: 1_700_100_000 },
        }],
        rowCount: 1,
      });

    const res = await handler(makeWebhookRequest('{"id":"evt_old_invoice"}'), {} as never);

    expect(res.status).toBe(200);
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    expect(mockQueueAndSendBillingEmail).not.toHaveBeenCalled();
  });

  it('acknowledges a duplicate paid invoice without renewing twice', async () => {
    mockVerifyWebhookSignature.mockReturnValue({
      type: 'invoice.paid',
      id: 'evt_invoice_duplicate',
      data: { object: { id: 'in_duplicate', subscription: 'sub_1' } },
    });
    mockEventQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await handler(makeWebhookRequest('{"id":"evt_invoice_duplicate"}'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockQueueAndSendBillingEmail).not.toHaveBeenCalled();
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
