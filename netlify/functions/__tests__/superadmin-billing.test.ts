import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireSuperadmin,
  mockExecute,
  mockQuery,
  mockQueryOne,
  mockTransaction,
  mockLogAudit,
  mockGetWorkspaceAvailableGiftSeats,
  mockIsPlatformLicensingEnabled,
  mockGetWorkspaceLicensingSettings,
} = vi.hoisted(() => ({
  mockRequireSuperadmin: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockTransaction: vi.fn(),
  mockLogAudit: vi.fn(),
  mockGetWorkspaceAvailableGiftSeats: vi.fn(),
  mockIsPlatformLicensingEnabled: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireSuperadmin: mockRequireSuperadmin,
}));

vi.mock('../_lib/db.js', () => ({
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceAvailableGiftSeats: mockGetWorkspaceAvailableGiftSeats,
  isPlatformLicensingEnabled: mockIsPlatformLicensingEnabled,
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
}));

import handler from '../superadmin-billing.ts';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  mockRequireSuperadmin.mockReset();
  mockExecute.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockTransaction.mockReset();
  mockLogAudit.mockReset();
  mockGetWorkspaceAvailableGiftSeats.mockReset();
  mockIsPlatformLicensingEnabled.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();

  mockRequireSuperadmin.mockResolvedValue({
    user: { id: 'sa_1', is_superadmin: true },
  });
  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockQueryOne.mockResolvedValue({ id: WORKSPACE_ID });
  mockGetWorkspaceAvailableGiftSeats.mockResolvedValue(0);
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
});

describe('superadmin-billing manual grants', () => {
  it('caps manual grant seat count and duration to safe upper bounds', async () => {
    const res = await handler(
      new Request('http://localhost/api/superadmin/billing/grants/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          seat_count: 9_999_999,
          duration_months: 1_000,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    const insertParams = mockExecute.mock.calls[0][1];
    expect(insertParams[2]).toBe('manual');
    expect(insertParams[3]).toBe(1_000_000);
    expect(insertParams[5]).toBeTruthy();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        seat_count: 1_000_000,
        duration_months: 120,
      }),
    }));
  });

  it('returns empty invoices payload when platform licensing is disabled', async () => {
    mockIsPlatformLicensingEnabled.mockResolvedValueOnce(false);

    const res = await handler(
      new Request('http://localhost/api/superadmin/billing/invoices', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ invoices: [], licensing_enabled: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects invoice status filters outside the allowlist', async () => {
    const res = await handler(
      new Request('http://localhost/api/superadmin/billing/invoices?status=archived', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'status must be one of: pending, paid, cancelled',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('normalizes allowed invoice status filters before querying', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(
      new Request('http://localhost/api/superadmin/billing/invoices?status=PAID', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(
      mockQuery.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string'
          && sql.includes('FROM billing_invoices bi')
          && sql.includes('bi.status = $1')
          && Array.isArray(params)
          && params[0] === 'paid'
      )
    ).toBe(true);
  });
});
