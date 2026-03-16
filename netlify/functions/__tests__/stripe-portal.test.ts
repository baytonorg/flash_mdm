import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAuth,
  mockQueryOne,
  mockRequireWorkspaceResourcePermission,
  mockCreatePortalSession,
  mockGetWorkspaceLicensingSettings,
  mockLogAudit,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockQueryOne: vi.fn(),
  mockRequireWorkspaceResourcePermission: vi.fn(),
  mockCreatePortalSession: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: mockQueryOne,
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: mockRequireWorkspaceResourcePermission,
}));

vi.mock('../_lib/stripe.js', () => ({
  createPortalSession: mockCreatePortalSession,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
}));

import handler from '../stripe-portal.ts';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';

  mockRequireAuth.mockReset();
  mockQueryOne.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockCreatePortalSession.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockLogAudit.mockReset();
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

describe('stripe-portal', () => {
  it('rejects API key callers', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'api_key',
      apiKey: { workspace_id: WORKSPACE_ID },
    });

    const res = await handler(
      new Request('http://localhost/api/stripe/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: WORKSPACE_ID }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
  });

  it('creates a portal URL for workspace customer', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: { id: 'user_1', workspace_id: WORKSPACE_ID },
    });
    mockRequireWorkspaceResourcePermission.mockResolvedValue(undefined);
    mockQueryOne.mockResolvedValue({
      id: WORKSPACE_ID,
      stripe_customer_id: 'cus_123',
    });
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/p/session_123');

    const res = await handler(
      new Request('http://localhost/api/stripe/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: WORKSPACE_ID }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      portal_url: 'https://billing.stripe.com/p/session_123',
    });
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
      'billing_manage'
    );
    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_123', 'http://localhost/licenses');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'stripe.portal.created',
    }));
  });

  it('rejects portal creation when workspace licensing is disabled', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      user: { id: 'user_1', workspace_id: WORKSPACE_ID },
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

    const res = await handler(
      new Request('http://localhost/api/stripe/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: WORKSPACE_ID }),
      }),
      {} as never
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'Licensing is disabled for this workspace' });
    expect(
      mockRequireWorkspaceResourcePermission.mock.calls.some(
        ([, workspaceId, resource, permission]) =>
          workspaceId === WORKSPACE_ID && resource === 'workspace' && permission === 'read'
      )
    ).toBe(true);
    expect(
      mockRequireWorkspaceResourcePermission.mock.calls.some(([, , resource]) => resource === 'billing')
    ).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockCreatePortalSession).not.toHaveBeenCalled();
  });
});
