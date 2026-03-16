import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
}));
vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => 500),
}));
vi.mock('../_lib/amapi-policy-validation.js', () => ({
  AmapiPolicyValidationError: class extends Error {
    issues: string[] = [];
  },
  assertValidAmapiPolicyPayload: vi.fn(),
}));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/blobs.js', () => ({ storeBlob: vi.fn() }));
vi.mock('../_lib/policy-update-mask.js', () => ({ buildPolicyUpdateMask: vi.fn() }));
vi.mock('../_lib/policy-recompile.js', () => ({ sanitizeConfig: vi.fn((v) => v) }));
vi.mock('../_lib/policy-generation.js', () => ({
  buildGeneratedPolicyPayload: vi.fn(async () => ({ payload: {}, metadata: {} })),
}));
vi.mock('../_lib/policy-derivatives.js', () => ({
  syncPolicyDerivativesForPolicy: vi.fn(async () => ({ derivatives: [], direct_contexts: 0, forced_device_derivatives: 0, warnings: [], preferred_amapi_name: null })),
  getPolicyAmapiContext: vi.fn(async () => null),
}));
vi.mock('../_lib/helpers.js', () => ({
  parseJsonBody: vi.fn((req: Request) => req.json()),
  getClientIp: vi.fn(() => '127.0.0.1'),
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  isValidUuid: vi.fn(() => true),
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }),
  ),
  errorResponse: vi.fn((message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } }),
  ),
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

describe('POST /api/policies/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } } as never);
    mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
  });

  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/policies/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('bulk set_draft skips Default policy and updates non-default', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'p1',
        environment_id: 'env1',
        name: 'Policy A',
        description: null,
        deployment_scenario: 'fm',
        config: {},
        status: 'production',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'p2',
        environment_id: 'env1',
        name: 'Default',
        description: null,
        deployment_scenario: 'fm',
        config: {},
        status: 'production',
        amapi_name: null,
      } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'set_draft',
      selection: { ids: ['p1', 'p2'] },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env1',
      'policy',
      'write',
    );
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("status = 'draft'"), ['p1']);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r) => r.id === 'p2')).toMatchObject({
      ok: false,
      error: 'Default policy cannot be modified by this action',
    });
  });

  it('bulk copy returns new policy identifiers', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'p1',
      environment_id: 'env1',
      name: 'Policy A',
      description: null,
      deployment_scenario: 'fm',
      config: {},
      status: 'draft',
      amapi_name: null,
    } as never);

    mockTransaction.mockImplementation(async (fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ component_id: string; priority: number }> }> }) => unknown) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT component_id, priority')) return { rows: [] };
          return { rows: [] };
        }),
      };
      return fn(client) as never;
    });

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'copy',
      selection: { ids: ['p1'] },
      options: { copy_name_prefix: 'Copy of' },
    }), {} as never);
    const body = await res.json() as { results: Array<{ id: string; ok: boolean; new_id?: string; new_name?: string }> };

    expect(res.status).toBe(200);
    expect(body.results[0]?.ok).toBe(true);
    expect(typeof body.results[0]?.new_id).toBe('string');
    expect(body.results[0]?.new_name).toBe('Copy of Policy A');
  });

  it('all_matching selection honors excluded_ids', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as never);
    mockQueryOne.mockResolvedValueOnce({
      id: 'p1',
      environment_id: 'env1',
      name: 'Policy A',
      description: null,
      deployment_scenario: 'fm',
      config: {},
      status: 'production',
      amapi_name: null,
    } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'set_draft',
      selection: {
        all_matching: true,
        excluded_ids: ['p2'],
      },
    }), {} as never);
    const body = await res.json() as { total_targeted: number; results: Array<{ id: string; ok: boolean }> };

    expect(res.status).toBe(200);
    expect(body.total_targeted).toBe(1);
    expect(body.results).toEqual([{ id: 'p1', ok: true }]);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("status = 'draft'"), ['p1']);
  });

  it('set_production pushes policy to AMAPI and marks it production', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'p1',
        environment_id: 'env1',
        name: 'Policy A',
        description: null,
        deployment_scenario: 'fm',
        config: {},
        status: 'draft',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'p1',
        environment_id: 'env1',
        config: {},
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj1',
      } as never);
    mockAmapiCall.mockResolvedValueOnce({ name: 'enterprises/e1/policies/p1' } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'set_production',
      selection: { ids: ['p1'] },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean }> };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results).toEqual([{ id: 'p1', ok: true }]);
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/policies/p1',
      'ws1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'production'"),
      ['enterprises/e1/policies/p1', 'p1'],
    );
  });

  it('push_to_amapi continues after per-item AMAPI failures', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'p1',
        environment_id: 'env1',
        name: 'Policy A',
        description: null,
        deployment_scenario: 'fm',
        config: {},
        status: 'draft',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'p1',
        environment_id: 'env1',
        config: {},
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj1',
      } as never)
      .mockResolvedValueOnce({
        id: 'p2',
        environment_id: 'env1',
        name: 'Policy B',
        description: null,
        deployment_scenario: 'fm',
        config: {},
        status: 'draft',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'p2',
        environment_id: 'env1',
        config: {},
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj1',
      } as never);

    mockAmapiCall
      .mockResolvedValueOnce({ name: 'enterprises/e1/policies/p1' } as never)
      .mockRejectedValueOnce(new Error('AMAPI outage'));

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'push_to_amapi',
      selection: { ids: ['p1', 'p2'] },
    }), {} as never);
    const body = await res.json() as {
      total_targeted: number;
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; error?: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.total_targeted).toBe(2);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r) => r.id === 'p1')).toEqual({ id: 'p1', ok: true });
    expect(body.results.find((r) => r.id === 'p2')).toMatchObject({
      id: 'p2',
      ok: false,
      error: 'AMAPI outage',
    });
  });

  it('delete operation reports partial failures per policy', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'p1',
        environment_id: 'env1',
        name: 'Policy A',
        description: null,
        deployment_scenario: 'fm',
        config: {},
        status: 'draft',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'p1',
        environment_id: 'env1',
        name: 'Policy A',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({ count: '0' } as never)
      .mockResolvedValueOnce({
        id: 'p2',
        environment_id: 'env1',
        name: 'Policy B',
        description: null,
        deployment_scenario: 'fm',
        config: {},
        status: 'draft',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'p2',
        environment_id: 'env1',
        name: 'Policy B',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({ count: '2' } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'delete',
      selection: { ids: ['p1', 'p2'] },
    }), {} as never);
    const body = await res.json() as {
      total_targeted: number;
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; error?: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.total_targeted).toBe(2);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r) => r.id === 'p1')).toEqual({ id: 'p1', ok: true });
    expect(body.results.find((r) => r.id === 'p2')).toMatchObject({
      id: 'p2',
      ok: false,
      error: 'Cannot delete policy: devices are still using it',
    });
    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM policies WHERE id = $1', ['p1']);
  });
});
