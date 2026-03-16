import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
  requireEnvironmentPermission: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  requireWorkspaceResourcePermission: vi.fn(),
}));

vi.mock('../_lib/licensing.js', () => ({
  getWorkspacePlatformEntitledSeats: vi.fn().mockResolvedValue(0),
  getWorkspaceEnvironmentLicensingSnapshots: vi.fn().mockResolvedValue([]),
  getEnvironmentLicensingSnapshot: vi.fn().mockResolvedValue({
    environment_id: 'env_1',
    environment_name: 'Env 1',
    workspace_id: 'ws_1',
    active_device_count: 1,
    entitled_seats: 1,
    overage_count: 0,
    open_case_id: null,
    overage_started_at: null,
    overage_age_days: 0,
    overage_phase: 'resolved',
    enrollment_blocked: false,
  }),
  getWorkspaceLicensingSettings: vi.fn().mockResolvedValue({
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
  }),
  getWorkspaceAvailableGiftSeats: vi.fn().mockResolvedValue(0),
}));

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  parseJsonBody: vi.fn((req: Request) => req.json()),
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  isValidUuid: vi.fn(() => true),
  getClientIp: vi.fn(() => '127.0.0.1'),
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  errorResponse: vi.fn((message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/stripe.js', () => ({
  getStripe: vi.fn(),
  createCheckoutSession: vi.fn(),
}));

import { requireAuth } from '../_lib/auth.js';
import {
  requireEnvironmentResourcePermission,
  requireEnvironmentPermission,
  requireWorkspacePermission,
  requireWorkspaceResourcePermission,
} from '../_lib/rbac.js';
import { queryOne, execute } from '../_lib/db.js';
import { amapiCall } from '../_lib/amapi.js';
import { getWorkspaceLicensingSettings } from '../_lib/licensing.js';
import environmentRenewHandler from '../environment-renew.ts';
import licenseAssignHandler from '../license-assign.ts';
import licenseStatusHandler from '../license-status.ts';
import stripeCheckoutHandler from '../stripe-checkout.ts';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockRequireWorkspacePermission = vi.mocked(requireWorkspacePermission);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockAmapiCall = vi.mocked(amapiCall);
const mockGetWorkspaceLicensingSettings = vi.mocked(getWorkspaceLicensingSettings);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    authType: 'session',
    user: { id: 'user_1', email: 'u@example.com', is_superadmin: false, workspace_id: 'ws_from_user' },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
  mockRequireWorkspacePermission.mockResolvedValue('admin' as never);
  mockRequireWorkspaceResourcePermission.mockResolvedValue('admin' as never);
  mockExecute.mockResolvedValue(undefined as never);
});

describe('environment-renew hardening', () => {
  it('uses environment RBAC instead of creator membership checks', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        name: 'Env',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({ gcp_project_id: 'proj_1' } as never);
    mockAmapiCall.mockResolvedValueOnce({ name: 'signupUrls/1', url: 'https://example.test' } as never);

    const res = await environmentRenewHandler(
      new Request('http://localhost/api/environment/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment_id: 'env_1' }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(expect.objectContaining({ authType: 'session' }), 'env_1', 'environment', 'manage_settings');
  });
});

describe('license-assign hardening', () => {
  it('uses environment RBAC for assign/unassign operations', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'dev_1', environment_id: 'env_1', license_id: 'lic_1' } as never)
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);

    const res = await licenseAssignHandler(
      new Request('http://localhost/api/licenses/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'dev_1' }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(expect.objectContaining({ authType: 'session' }), 'env_1', 'write');
  });

  it('filters soft-deleted devices during device lookup', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await licenseAssignHandler(
      new Request('http://localhost/api/licenses/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'dev_deleted' }),
      }),
      {} as never
    );

    expect(res.status).toBe(404);
    expect(String(mockQueryOne.mock.calls[0]?.[0] ?? '')).toContain('d.deleted_at IS NULL');
    expect(mockRequireEnvironmentPermission).not.toHaveBeenCalled();
  });
});

describe('license-status hardening', () => {
  it('uses workspace API key scope as fallback workspace id and RBAC helper', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      apiKey: { workspace_id: 'ws_key', scope_type: 'workspace' },
      user: { id: 'creator', email: 'creator@example.com', workspace_id: null, is_superadmin: false },
    } as never);
    mockQueryOne
      .mockResolvedValueOnce(null as never) // license
      .mockResolvedValueOnce({ count: '0' } as never) // count
      .mockResolvedValueOnce({ name: 'Free', max_devices: 10, features: {} } as never); // free plan

    const res = await licenseStatusHandler(
      new Request('http://localhost/api/license-status', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ authType: 'api_key' }),
      'ws_key',
      'workspace',
      'read'
    );
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ authType: 'api_key' }),
      'ws_key',
      'billing',
      'license_view'
    );
    const countSql = mockQueryOne.mock.calls[1]?.[0];
    expect(typeof countSql).toBe('string');
    expect(String(countSql)).toContain('d.deleted_at IS NULL');
  });

  it('does not require billing permissions when licensing is disabled', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      user: { id: 'creator', email: 'creator@example.com', workspace_id: 'ws_1', is_superadmin: false },
    } as never);
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
    mockQueryOne
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ count: '0' } as never)
      .mockResolvedValueOnce({ name: 'Free', max_devices: 10, features: {} } as never);

    const res = await licenseStatusHandler(
      new Request('http://localhost/api/license-status?workspace_id=ws_1', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ authType: 'session' }),
      'ws_1',
      'workspace',
      'read'
    );
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenCalledTimes(1);
  });

  it('supports environment-scoped status reads without workspace billing permission', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'session',
      user: { id: 'user_1', email: 'u@example.com', is_superadmin: false, workspace_id: null, environment_id: 'env_1' },
    } as never);
    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ count: '1' } as never)
      .mockResolvedValueOnce({ name: 'Free', max_devices: 10, features: {} } as never);

    const res = await licenseStatusHandler(
      new Request('http://localhost/api/license-status?environment_id=env_1', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ authType: 'session' }),
      'env_1',
      'read'
    );
    expect(
      mockRequireWorkspaceResourcePermission.mock.calls.some(([, , resource]) => resource === 'billing')
    ).toBe(false);
  });
});

describe('stripe-checkout hardening', () => {
  it('rejects API key callers', async () => {
    const originalStripeKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      apiKey: { workspace_id: 'ws_1', scope_type: 'workspace' },
      user: { id: 'creator', email: 'creator@example.com', is_superadmin: false },
    } as never);

    const res = await stripeCheckoutHandler(
      new Request('http://localhost/api/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: 'ws_1', plan_id: 'plan_1' }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
    process.env.STRIPE_SECRET_KEY = originalStripeKey;
  });

  it('uses workspace RBAC for session callers before checkout', async () => {
    const originalStripeKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    mockQueryOne.mockResolvedValueOnce(null as never); // plan lookup => 404

    const res = await stripeCheckoutHandler(
      new Request('http://localhost/api/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: 'ws_1', plan_id: 'plan_1' }),
      }),
      {} as never
    );

    expect(res.status).toBe(404);
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ authType: 'session' }),
      'ws_1',
      'workspace',
      'read'
    );
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ authType: 'session' }),
      'ws_1',
      'billing',
      'billing_manage'
    );
    process.env.STRIPE_SECRET_KEY = originalStripeKey;
  });
});
