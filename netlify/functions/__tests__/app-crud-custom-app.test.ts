import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentPermission: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/deployment-sync.js', () => ({
  selectPoliciesForDeploymentScope: vi.fn(),
  syncAffectedPoliciesToAmapi: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(),
}));

import { queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { selectPoliciesForDeploymentScope, syncAffectedPoliciesToAmapi } from '../_lib/deployment-sync.js';
import appCrudHandler from '../app-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockSelectPoliciesForDeploymentScope = vi.mocked(selectPoliciesForDeploymentScope);
const mockSyncAffectedPoliciesToAmapi = vi.mocked(syncAffectedPoliciesToAmapi);

const APP = {
  id: 'app-1',
  environment_id: 'env-1',
  package_name: 'com.example.custom',
  display_name: 'Custom app',
  default_install_type: 'AVAILABLE',
  default_auto_update_mode: 'AUTO_UPDATE_DEFAULT',
  default_managed_config: null,
  icon_url: null,
  distribution_channel: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

const AUTH_CONTEXT = {
  sessionId: 'session-1',
  user: { id: 'user-1', email: 'test@example.com', is_superadmin: false },
};

beforeEach(() => {
  mockQueryOne.mockReset();
  mockTransaction.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockSelectPoliciesForDeploymentScope.mockReset();
  mockSyncAffectedPoliciesToAmapi.mockReset();
  mockRequireAuth.mockResolvedValue(AUTH_CONTEXT as never);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
});

describe('app-crud CUSTOM scope validation', () => {
  it('rejects creating a CUSTOM scope without customAppConfig', async () => {
    mockQueryOne.mockResolvedValueOnce(APP as never);

    const response = await appCrudHandler(new Request('http://localhost/api/apps/app-1/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope_type: 'device',
        scope_id: 'device-1',
        install_type: 'CUSTOM',
        app_policy: {},
      }),
    }), {} as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'app_policy.customAppConfig must be an object when install_type is CUSTOM',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects customAppConfig outside a CUSTOM scope', async () => {
    mockQueryOne.mockResolvedValueOnce(APP as never);

    const response = await appCrudHandler(new Request('http://localhost/api/apps/app-1/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope_type: 'device',
        scope_id: 'device-1',
        install_type: 'AVAILABLE',
        app_policy: { customAppConfig: {} },
      }),
    }), {} as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'app_policy.customAppConfig requires install_type CUSTOM',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('accepts creating a CUSTOM scope with an object customAppConfig', async () => {
    mockQueryOne.mockResolvedValueOnce(APP as never);
    mockTransaction.mockImplementationOnce(async (callback) => callback({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{
          id: 'config-1',
          app_id: 'app-1',
          environment_id: 'env-1',
          scope_type: 'device',
          scope_id: 'device-1',
          install_type: 'CUSTOM',
          auto_update_mode: null,
          managed_config: null,
          app_policy: JSON.stringify({ customAppConfig: {} }),
        }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as never) as never);
    mockSelectPoliciesForDeploymentScope.mockResolvedValueOnce({ rows: [] } as never);
    mockSyncAffectedPoliciesToAmapi.mockResolvedValueOnce({ success: true } as never);

    const response = await appCrudHandler(new Request('http://localhost/api/apps/app-1/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope_type: 'device',
        scope_id: 'device-1',
        install_type: 'CUSTOM',
        app_policy: { customAppConfig: {} },
      }),
    }), {} as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      scope_config: expect.objectContaining({
        install_type: 'CUSTOM',
        app_policy: { customAppConfig: {} },
      }),
    }));
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('validates the existing app policy when an update changes the effective install type to CUSTOM', async () => {
    mockQueryOne
      .mockResolvedValueOnce(APP as never)
      .mockResolvedValueOnce({
        id: 'config-1',
        app_id: 'app-1',
        environment_id: 'env-1',
        scope_type: 'device',
        scope_id: 'device-1',
        install_type: 'AVAILABLE',
        auto_update_mode: null,
        managed_config: null,
        app_policy: '{}',
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
      } as never);

    const response = await appCrudHandler(new Request('http://localhost/api/apps/app-1/configs/config-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_type: 'CUSTOM' }),
    }), {} as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'app_policy.customAppConfig must be an object when install_type is CUSTOM',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('validates an existing CUSTOM scope even when the update omits install_type and app_policy', async () => {
    mockQueryOne
      .mockResolvedValueOnce(APP as never)
      .mockResolvedValueOnce({
        id: 'config-1',
        app_id: 'app-1',
        environment_id: 'env-1',
        scope_type: 'device',
        scope_id: 'device-1',
        install_type: 'CUSTOM',
        auto_update_mode: null,
        managed_config: null,
        app_policy: '{}',
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
      } as never);

    const response = await appCrudHandler(new Request('http://localhost/api/apps/app-1/configs/config-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_update_mode: 'AUTO_UPDATE_DEFAULT' }),
    }), {} as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'app_policy.customAppConfig must be an object when install_type is CUSTOM',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
