import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockQuery, mockQueryOne, mockSendEmail } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock('../db.js', () => ({
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne,
}));

vi.mock('../resend.js', () => ({
  sendEmail: mockSendEmail,
}));

import {
  buildNearExpiryEmail,
  buildPaymentFailedEmail,
  buildRenewalEmail,
  queueAndSendBillingEmail,
} from '../billing-notifications.js';

beforeEach(() => {
  mockExecute.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
});

describe('billing notifications', () => {
  it('returns duplicate when dedupe insert is ignored', async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 0 });

    const result = await queueAndSendBillingEmail({
      workspaceId: 'ws_1',
      notificationType: 'test',
      dedupeKey: 'dup_1',
      subject: 'Subject',
      html: '<p>Hello</p>',
    });

    expect(result).toMatchObject({ skipped: true, reason: 'duplicate' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('marks no recipients as skipped', async () => {
    mockExecute
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce([]);

    const result = await queueAndSendBillingEmail({
      workspaceId: 'ws_1',
      notificationType: 'test',
      dedupeKey: 'none_1',
      subject: 'Subject',
      html: '<p>Hello</p>',
    });

    expect(result).toMatchObject({ skipped: true, reason: 'no_recipients' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends notification to workspace admins and environment customer', async () => {
    mockExecute
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce([{ email: 'owner@example.com' }]);
    mockQueryOne.mockResolvedValueOnce({ email: 'customer@example.com' });

    const result = await queueAndSendBillingEmail({
      workspaceId: 'ws_1',
      environmentId: 'env_1',
      notificationType: 'test',
      dedupeKey: 'send_1',
      subject: 'Subject',
      html: '<p>Hello</p>',
      includeEnvironmentCustomer: true,
    });

    expect(result).toMatchObject({ queued: true, sent: true, skipped: false });
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it('builds safe billing email templates', () => {
    const names = { workspaceName: 'ACME <x>', environmentName: 'Prod "A"' };

    const renewal = buildRenewalEmail(names, 10, 12, 'in_1');
    const failed = buildPaymentFailedEmail(names, 'in_2', 'sub_2');
    const expiry = buildNearExpiryEmail(names, 5, 7, '2026-03-08T00:00:00.000Z');

    expect(renewal.html).toContain('ACME &lt;x&gt;');
    expect(failed.html).toContain('Prod &quot;A&quot;');
    expect(expiry.subject).toContain('7 day(s)');
  });
});
