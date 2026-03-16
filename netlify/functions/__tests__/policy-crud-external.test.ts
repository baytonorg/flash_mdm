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

import { queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentAccessScopeForResourcePermission, requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import handler from '../policy-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentAccessScope = vi.mocked(requireEnvironmentAccessScopeForResourcePermission);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockAmapiCall = vi.mocked(amapiCall);

function makeRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentAccessScope.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockAmapiCall.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: '22222222-2222-4222-8222-222222222222', is_superadmin: false },
  } as never);
  mockRequireEnvironmentAccessScope.mockResolvedValue({
    mode: 'environment',
    role: 'viewer',
    accessible_group_ids: null,
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
});

describe('policy-crud external policy viewer', () => {
  it('returns auth Response errors instead of throwing when requireAuth rejects', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new Response(
        JSON.stringify({ error: 'Read-only support session: mutating actions are blocked during impersonation.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const res = await handler(
      new Request('http://localhost/api/policies/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Read-only support session: mutating actions are blocked during impersonation.',
    });
  });

  it('rejects malformed UUID query params before permission checks', async () => {
    const res = await handler(
      makeRequest(
        'http://localhost/api/policies/external?environment_id=bad-env&device_id=bad-device&amapi_name=enterprises%2Fe123%2Fpolicies%2Fp_abc'
      ),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'environment_id must be a valid UUID' });
    expect(mockRequireEnvironmentAccessScope).not.toHaveBeenCalled();
    expect(mockAmapiCall).not.toHaveBeenCalled();
  });

  it('rejects malformed UUID route params for GET /api/policies/:id', async () => {
    const res = await handler(makeRequest('http://localhost/api/policies/not-a-uuid'), {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'policy_id must be a valid UUID' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('allows viewer role and returns AMAPI policy payload with local match metadata', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        enterprise_name: 'enterprises/e123',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never)
      .mockResolvedValueOnce({
        id: 'pol_local_1',
        name: 'Baseline Policy',
      } as never);

    mockAmapiCall.mockResolvedValue({
      name: 'enterprises/e123/policies/p_abc',
      applications: [{ packageName: 'com.example.app' }],
    } as never);

    const res = await handler(
      makeRequest(
        'http://localhost/api/policies/external?environment_id=44444444-4444-4444-8444-444444444444&amapi_name=enterprises%2Fe123%2Fpolicies%2Fp_abc'
      ),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentAccessScope).toHaveBeenCalledWith(
      expect.anything(),
      '44444444-4444-4444-8444-444444444444',
      'policy',
      'read'
    );
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e123/policies/p_abc',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ method: 'GET', resourceType: 'policies' })
    );

    const body = await res.json();
    expect(body).toEqual({
      policy: {
        name: 'enterprises/e123/policies/p_abc',
        applications: [{ packageName: 'com.example.app' }],
      },
      local_policy: {
        id: 'pol_local_1',
        name: 'Baseline Policy',
      },
    });
  });

  it('rejects AMAPI policies that do not belong to the environment enterprise', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        enterprise_name: 'enterprises/e123',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);

    const res = await handler(
      makeRequest(
        'http://localhost/api/policies/external?environment_id=44444444-4444-4444-8444-444444444444&amapi_name=enterprises%2Fe999%2Fpolicies%2Fp_abc'
      ),
      {} as never
    );

    expect(res.status).toBe(400);
    expect(mockAmapiCall).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: 'Policy does not belong to the selected environment enterprise',
    });
  });

  it('requires device_id for group-scoped viewers', async () => {
    mockRequireEnvironmentAccessScope.mockResolvedValue({
      mode: 'group',
      role: 'viewer',
      accessible_group_ids: ['66666666-6666-4666-8666-666666666666'],
    } as never);

    const res = await handler(
      makeRequest(
        'http://localhost/api/policies/external?environment_id=44444444-4444-4444-8444-444444444444&amapi_name=enterprises%2Fe123%2Fpolicies%2Fp_abc'
      ),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'device_id is required for scoped group access',
    });
  });

  it('rejects malformed device_id on external route', async () => {
    const res = await handler(
      makeRequest(
        'http://localhost/api/policies/external?environment_id=44444444-4444-4444-8444-444444444444&device_id=bad-device&amapi_name=enterprises%2Fe123%2Fpolicies%2Fp_abc'
      ),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'device_id must be a valid UUID' });
    expect(mockRequireEnvironmentAccessScope).not.toHaveBeenCalled();
  });
});
