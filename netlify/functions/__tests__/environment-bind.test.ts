import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  syncPolicyDerivativesForPolicy: vi.fn(),
}));

vi.mock('../signin-config.js', () => ({
  syncSigninDetailsToAmapi: vi.fn(),
}));

import { query, queryOne, execute, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import { syncPolicyDerivativesForPolicy } from '../_lib/policy-derivatives.js';
import handler from '../environment-bind.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);
const mockSyncPolicyDerivatives = vi.mocked(syncPolicyDerivativesForPolicy);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/.netlify/functions/environment-bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockQuery.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockAmapiCall.mockReset();
  mockLogAudit.mockReset();
  mockSyncPolicyDerivatives.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1', is_superadmin: false },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue('admin' as never);
  mockQuery.mockResolvedValue([] as never);
  mockSyncPolicyDerivatives.mockResolvedValue({} as never);
});

describe('environment-bind finalize enterprise create payload', () => {
  it('preserves connectivity siblings when policies regenerate after binding', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        name: 'QA Env',
        enterprise_name: null,
        signup_url_name: 'signupUrls/123',
        pubsub_topic: null,
        workspace_default_pubsub_topic: null,
      } as never)
      .mockResolvedValueOnce({ gcp_project_id: 'project_1' } as never);
    mockQuery.mockResolvedValueOnce([{
      id: 'policy_1',
      config: {
        applications: [{ packageName: 'com.example.app' }],
        openNetworkConfiguration: { Type: 'UnencryptedConfiguration' },
        cameraDisabled: true,
        deviceConnectivityManagement: {
          tetheringSettings: 'DISALLOW_ALL_TETHERING',
          wifiSsidPolicy: {
            wifiSsidPolicyType: 'WIFI_SSID_DENYLIST',
            wifiSsids: [{ wifiSsid: 'Guest' }],
          },
          apnPolicy: { apnSettings: [{ displayName: 'Old', apn: 'old.example' }] },
        },
      },
    }] as never);
    mockAmapiCall.mockResolvedValue({
      name: 'enterprises/e1',
      enterpriseDisplayName: 'QA Env',
    } as never);

    const response = await handler(
      makeRequest({ environment_id: 'env_1', enterprise_token: 'token_123' }),
      {} as never
    );

    expect(response.status).toBe(200);
    expect(mockSyncPolicyDerivatives).toHaveBeenCalledWith(expect.objectContaining({
      baseConfig: {
        cameraDisabled: true,
        deviceConnectivityManagement: {
          tetheringSettings: 'DISALLOW_ALL_TETHERING',
          wifiSsidPolicy: {
            wifiSsidPolicyType: 'WIFI_SSID_DENYLIST',
            wifiSsids: [{ wifiSsid: 'Guest' }],
          },
        },
      },
    }));
  });

  it('unbinds atomically while preserving policy assignment intent for rebind', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    mockTransaction.mockImplementation(async (fn) => fn({ query: clientQuery } as never));
    mockQueryOne.mockResolvedValueOnce({
      id: 'env_1',
      workspace_id: 'ws_1',
      name: 'QA Env',
      enterprise_name: 'enterprises/old',
      signup_url_name: null,
      pubsub_topic: null,
      workspace_default_pubsub_topic: null,
    } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', action: 'unbind' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledOnce();
    const sql = clientQuery.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('DELETE FROM policy_derivatives');
    expect(sql).toContain('last_policy_sync_name = NULL');
    expect(sql).not.toContain('DELETE FROM policy_assignments');
    expect(sql).not.toContain('policy_id = NULL');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'environment.enterprise_unbound',
      details: { previous_enterprise: 'enterprises/old' },
    }));
  });

  it('returns a generic 500 error body for unexpected internal failures', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('db: duplicate key value violates unique constraint'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handler(
      makeRequest({ environment_id: 'env_1' }),
      {} as never
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Internal server error',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Bind handler error:',
      'db: duplicate key value violates unique constraint'
    );

    errorSpy.mockRestore();
  });

  it('cancels a pending bind and audits signup URL clear', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'env_1',
      workspace_id: 'ws_1',
      name: 'QA Env',
      enterprise_name: null,
      signup_url_name: 'signupUrls/pending-123',
      pubsub_topic: null,
      workspace_default_pubsub_topic: null,
    } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', action: 'cancel_bind' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ cancelled: true });
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE environments SET signup_url_name = NULL, updated_at = now() WHERE id = $1',
      ['env_1']
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      user_id: 'user_1',
      action: 'environment.bind_cancelled',
      details: { cleared_signup_url_name: 'signupUrls/pending-123' },
    }));
  });

  it('omits notification config when no pubsub_topic is configured', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        name: 'QA Env',
        enterprise_name: null,
        signup_url_name: 'signupUrls/123',
        pubsub_topic: null,
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);

    mockAmapiCall.mockResolvedValue({
      name: 'enterprises/abc',
      enterpriseDisplayName: 'QA Env',
    } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', enterprise_token: 'token_123' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
    const options = mockAmapiCall.mock.calls[0][2] as { body?: Record<string, unknown> };
    expect(options.body).toEqual({
      enterpriseDisplayName: 'QA Env',
    });
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });

  it('includes pubsubTopic and enabledNotificationTypes when pubsub_topic is configured', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        name: 'QA Env',
        enterprise_name: null,
        signup_url_name: 'signupUrls/123',
        pubsub_topic: 'projects/proj-123/topics/amapi-events',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);

    mockAmapiCall.mockResolvedValue({
      name: 'enterprises/abc',
      enterpriseDisplayName: 'QA Env',
      pubsubTopic: 'projects/proj-123/topics/amapi-events',
    } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', enterprise_token: 'token_123' }),
      {} as never
    );

    expect(res.status).toBe(200);
    const options = mockAmapiCall.mock.calls[0][2] as { body?: Record<string, unknown> };
    expect(options.body).toEqual({
      enterpriseDisplayName: 'QA Env',
      pubsubTopic: 'projects/proj-123/topics/amapi-events',
      enabledNotificationTypes: [
        'ENROLLMENT',
        'STATUS_REPORT',
        'COMMAND',
        'USAGE_LOGS',
        'ENTERPRISE_UPGRADE',
      ],
    });
  });

  it('returns success with warning when attach-existing bootstrap import fails after binding', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        name: 'QA Env',
        enterprise_name: null,
        signup_url_name: null,
        pubsub_topic: null,
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never)
      .mockResolvedValueOnce(null as never);

    mockAmapiCall
      .mockResolvedValueOnce({
        name: 'enterprises/abc',
        enterpriseDisplayName: 'Attached Env',
        pubsubTopic: 'projects/proj-123/topics/amapi-events',
      } as never)
      .mockRejectedValueOnce(new Error('AMAPI devices.list failed'));

    const res = await handler(
      makeRequest({ environment_id: 'env_1', existing_enterprise_name: 'enterprises/abc' }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.enterprise).toEqual({
      name: 'enterprises/abc',
      display_name: 'Attached Env',
      pubsub_topic: 'projects/proj-123/topics/amapi-events',
    });
    expect(body.warning).toBeTruthy();
    expect(body.bootstrap_sync).toMatchObject({
      imported_devices: 0,
      truncated: false,
    });
    expect(mockExecute).toHaveBeenCalledTimes(1); // binding persisted despite bootstrap failure
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });
});
