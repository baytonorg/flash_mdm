import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAuth,
  mockRequireWorkspaceResourcePermission,
  mockRequireEnvironmentPermission,
  mockExecute,
  mockQuery,
  mockQueryOne,
  mockGetWorkspaceLicensingSettings,
  mockGetWorkspaceAvailableGiftSeats,
  mockLogAudit,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireWorkspaceResourcePermission: vi.fn(),
  mockRequireEnvironmentPermission: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockGetWorkspaceAvailableGiftSeats: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: mockRequireWorkspaceResourcePermission,
  requireEnvironmentPermission: mockRequireEnvironmentPermission,
}));

vi.mock('../_lib/db.js', () => ({
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
  getWorkspaceAvailableGiftSeats: mockGetWorkspaceAvailableGiftSeats,
}));

import handler from '../license-grants.ts';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockExecute.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockGetWorkspaceAvailableGiftSeats.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    authType: 'session',
    user: {
      id: 'user_1',
      workspace_id: WORKSPACE_ID,
    },
  });
  mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined);
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
  mockGetWorkspaceAvailableGiftSeats.mockResolvedValue(0);
});

describe('license-grants', () => {
  it('lists grants and invoices with license_view permission', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 'grant_1', seat_count: 10, source: 'stripe' }])
      .mockResolvedValueOnce([{ id: 'inv_1', subtotal_cents: 1000, status: 'pending' }]);

    const res = await handler(
      new Request(`http://localhost/api/licenses/grants?workspace_id=${WORKSPACE_ID}`, { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ authType: 'session' }),
      WORKSPACE_ID,
      'workspace',
      'read'
    );
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ authType: 'session' }),
      WORKSPACE_ID,
      'billing',
      'license_view'
    );
    await expect(res.json()).resolves.toMatchObject({
      grants: expect.any(Array),
      invoices: expect.any(Array),
    });
  });

  it('allows grant ledger read for env-scoped member fallback', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      user: { id: 'user_1', workspace_id: null, environment_id: 'env_1' },
    });
    mockRequireWorkspaceResourcePermission.mockRejectedValueOnce(new Response(
      JSON.stringify({ error: 'Forbidden: insufficient workspace role' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    ));
    mockQueryOne.mockResolvedValueOnce({ id: 'env_1' });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await handler(
      new Request(`http://localhost/api/licenses/grants?workspace_id=${WORKSPACE_ID}`, { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      expect.objectContaining({ authType: 'session' }),
      'env_1',
      'read'
    );
  });

  it('rejects invoice requests whose subtotal overflows 32-bit integer range', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: WORKSPACE_ID })
      .mockResolvedValueOnce({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        stripe_price_id: null,
        features: { invoice_unit_amount_cents: 100_000, currency: 'usd' },
      });

    const res = await handler(
      new Request('http://localhost/api/licenses/grants/invoice-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          plan_id: '323e4567-e89b-12d3-a456-426614174000',
          seat_count: 1_000_000,
          duration_months: 12,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'invoice subtotal exceeds maximum supported value',
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('returns empty grant/invoice ledger when licensing is disabled', async () => {
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
      new Request(`http://localhost/api/licenses/grants?workspace_id=${WORKSPACE_ID}`, { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      grants: [],
      invoices: [],
      licensing_enabled: false,
    });
    expect(
      mockRequireWorkspaceResourcePermission.mock.calls.some(
        ([auth, workspaceId, resource, permission]) =>
          (auth as { authType?: string } | undefined)?.authType === 'session'
          && workspaceId === WORKSPACE_ID
          && resource === 'workspace'
          && permission === 'read'
      )
    ).toBe(true);
    expect(
      mockRequireWorkspaceResourcePermission.mock.calls.some(([, , resource]) => resource === 'billing')
    ).toBe(false);
  });
});
