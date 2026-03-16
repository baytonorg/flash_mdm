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
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/blobs.js', () => ({
  storeBlob: vi.fn(),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  syncPolicyDerivativesForPolicy: vi.fn(async () => ({
    policy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    preferred_amapi_name: 'enterprises/e123/policies/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    derivatives: [],
    direct_contexts: [{ scope_type: 'environment', scope_id: '44444444-4444-4444-8444-444444444444' }],
    forced_device_derivatives: 0,
    warnings: [],
  })),
}));

import { query, queryOne, execute, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import handler from '../policy-crud.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockAmapiCall = vi.mocked(amapiCall);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/policies/update', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('policy-crud update AMAPI generation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockTransaction.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvironmentResourcePermission.mockReset();
    mockAmapiCall.mockReset();

    mockRequireAuth.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: '22222222-2222-4222-8222-222222222222', is_superadmin: false },
    } as never);
    mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);

    mockTransaction.mockImplementation(async (fn: (tx: { query: ReturnType<typeof vi.fn> }) => unknown) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      };
      return fn(client);
    });

    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
    mockAmapiCall.mockResolvedValue({ name: 'enterprises/e123/policies/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as never);
  });

  it('rejects malformed policy UUID on update before DB lookup', async () => {
    const res = await handler(
      makeRequest({
        id: 'not-a-uuid',
        config: { passwordRequirements: { passwordMinimumLength: 12 } },
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'id must be a valid UUID' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('pushes generated payload including env app and network deployments after policy save', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        environment_id: '44444444-4444-4444-8444-444444444444',
        config: { passwordRequirements: { passwordMinimumLength: 8 } },
        version: 2,
        amapi_name: 'enterprises/e123/policies/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        enterprise_name: 'enterprises/e123',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj_1',
      } as never);

    const wifiOnc = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [
        {
          GUID: 'wifi-44444444-4444-4444-8444-444444444444-office',
          Name: 'Office WiFi',
          Type: 'WiFi',
          WiFi: { SSID: 'Office', HiddenSSID: false, AutoConnect: true },
        },
      ],
    };

    // buildGeneratedPolicyPayload is called twice (previous + next), each querying:
    // assignments, env app deployments, legacy app_deployments fallback, env network deployments, env-lock check.
    mockQuery
      .mockResolvedValueOnce([{ scope_type: 'environment', scope_id: '44444444-4444-4444-8444-444444444444' }] as never)
      .mockResolvedValueOnce([
        {
          id: 'appdep_1',
          package_name: 'com.example.agent',
          install_type: 'FORCE_INSTALLED',
          managed_config: { mode: 'prod' },
          auto_update_mode: 'AUTO_UPDATE_DEFAULT',
        },
      ] as never)
      .mockResolvedValueOnce([] as never) // legacy app_deployments fallback
      .mockResolvedValueOnce([{ id: 'netdep_1', onc_profile: wifiOnc }] as never)
      .mockResolvedValueOnce([] as never) // env-lock check
      .mockResolvedValueOnce([{ scope_type: 'environment', scope_id: '44444444-4444-4444-8444-444444444444' }] as never)
      .mockResolvedValueOnce([
        {
          id: 'appdep_1',
          package_name: 'com.example.agent',
          install_type: 'FORCE_INSTALLED',
          managed_config: { mode: 'prod' },
          auto_update_mode: 'AUTO_UPDATE_DEFAULT',
        },
      ] as never)
      .mockResolvedValueOnce([] as never) // legacy app_deployments fallback
      .mockResolvedValueOnce([{ id: 'netdep_1', onc_profile: wifiOnc }] as never)
      .mockResolvedValueOnce([] as never); // env-lock check

    const res = await handler(
      makeRequest({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        config: { passwordRequirements: { passwordMinimumLength: 12 } },
        push_to_amapi: true,
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockAmapiCall).toHaveBeenCalledTimes(1);

    const amapiArgs = mockAmapiCall.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(amapiArgs[0]).toContain('enterprises/e123/policies/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(amapiArgs[1]).toBe('11111111-1111-4111-8111-111111111111');
    expect(amapiArgs[2]).toMatchObject({
      method: 'PATCH',
      projectId: 'proj_1',
      enterpriseName: 'enterprises/e123',
    });

    const body = amapiArgs[2].body as Record<string, unknown>;
    expect(body.passwordRequirements).toEqual({ passwordMinimumLength: 12 });
    expect(body.applications).toEqual([
      expect.objectContaining({
        packageName: 'com.example.agent',
        installType: 'FORCE_INSTALLED',
      }),
    ]);
    expect(typeof body.openNetworkConfiguration).toBe('object');
    const openNetworkConfiguration = body.openNetworkConfiguration as {
      NetworkConfigurations: Array<{ WiFi?: { SSID?: string } }>;
    };
    expect(openNetworkConfiguration.NetworkConfigurations[0]?.WiFi?.SSID).toBe('Office');
  });
});
