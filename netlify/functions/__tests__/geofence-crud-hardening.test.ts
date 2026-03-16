import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/webhook-ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/webhook-ssrf.js')>();
  return {
    ...actual,
    validateResolvedWebhookUrlForOutbound: vi.fn(actual.validateResolvedWebhookUrlForOutbound),
  };
});

import { queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { validateResolvedWebhookUrlForOutbound } from '../_lib/webhook-ssrf.js';
import handler from '../geofence-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockValidateResolvedWebhookUrlForOutbound = vi.mocked(validateResolvedWebhookUrlForOutbound);

function makeRequest(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockValidateResolvedWebhookUrlForOutbound.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1' },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
  mockValidateResolvedWebhookUrlForOutbound.mockImplementation(async (urlValue) => {
    const actual = await vi.importActual<typeof import('../_lib/webhook-ssrf.js')>('../_lib/webhook-ssrf.js');
    return actual.validateResolvedWebhookUrlForOutbound(urlValue);
  });
});

describe('geofence-crud hardening', () => {
  it('rejects create when group scope_id does not belong to the geofence environment', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(
      makeRequest('POST', '/api/geofences/create', {
        environment_id: 'env_1',
        name: 'Fence',
        latitude: 1,
        longitude: 2,
        radius_meters: 100,
        scope_type: 'group',
        scope_id: 'grp_other_env',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'scope_id does not belong to environment env_1',
    });
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      ['grp_other_env', 'env_1']
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects update when effective device scope_id is outside the geofence environment', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        environment_id: 'env_1',
        scope_type: 'device',
        scope_id: 'dev_existing',
      } as never)
      .mockResolvedValueOnce(null as never);

    const res = await handler(
      makeRequest('PUT', '/api/geofences/update', {
        id: 'geo_1',
        scope_id: 'dev_other_env',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'scope_id does not belong to environment env_1',
    });
    expect(mockQueryOne).toHaveBeenLastCalledWith(
      'SELECT id FROM devices WHERE id = $1 AND environment_id = $2',
      ['dev_other_env', 'env_1']
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects create when geofence webhook action uses non-HTTPS URL', async () => {
    const res = await handler(
      makeRequest('POST', '/api/geofences/create', {
        environment_id: 'env_1',
        name: 'Fence',
        latitude: 1,
        longitude: 2,
        radius_meters: 100,
        scope_type: 'environment',
        action_on_enter: {
          type: 'webhook',
          url: 'http://example.com/hook',
        },
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'action_on_enter: Webhook URL must use HTTPS',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects update when geofence webhook action targets metadata/internal addresses', async () => {
    mockQueryOne.mockResolvedValueOnce({
      environment_id: 'env_1',
      scope_type: 'environment',
      scope_id: null,
    } as never);

    const res = await handler(
      makeRequest('PUT', '/api/geofences/update', {
        id: 'geo_1',
        action_on_exit: {
          type: 'webhook',
          url: 'https://metadata.google.internal/hook',
        },
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'action_on_exit: Webhook URL points to a blocked address',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects create when DNS-aware webhook validation fails even with a public-looking hostname', async () => {
    mockValidateResolvedWebhookUrlForOutbound.mockResolvedValueOnce({
      ok: false,
      error: 'Webhook URL resolves to a blocked address',
    });

    const res = await handler(
      makeRequest('POST', '/api/geofences/create', {
        environment_id: 'env_1',
        name: 'Fence',
        latitude: 1,
        longitude: 2,
        radius_meters: 100,
        scope_type: 'environment',
        action_on_enter: {
          type: 'webhook',
          url: 'https://hooks.example.test/hook',
        },
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'action_on_enter: Webhook URL resolves to a blocked address',
    });
    expect(mockValidateResolvedWebhookUrlForOutbound).toHaveBeenCalledWith('https://hooks.example.test/hook');
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
