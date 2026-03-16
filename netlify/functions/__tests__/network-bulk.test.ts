import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({ requireEnvironmentPermission: vi.fn() }));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/policy-merge.js', () => ({
  parseOncDocument: vi.fn(),
  getApnSettingKey: vi.fn(),
  removeOncDeploymentFromPolicyConfig: vi.fn(),
  removeApnDeploymentFromPolicyConfig: vi.fn(),
}));
vi.mock('../_lib/deployment-sync.js', () => ({
  syncAffectedPoliciesToAmapi: vi.fn(async () => ({ attempted: 0, synced: 0, failed: 0, failures: [] })),
  selectPoliciesForDeploymentScope: vi.fn(async () => ({ rows: [] })),
}));

import { queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import handler from '../network-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);

describe('POST /api/networks/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      user: { id: 'u1' },
      sessionId: 'sess-1',
    } as never);
  });

  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/networks/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('reports per-item failure when deployment is outside selected environment', async () => {
    mockQueryOne.mockResolvedValueOnce({ environment_id: 'env2' } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'delete',
      selection: { ids: ['n1'] },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: 'n1',
      ok: false,
      error: 'Network deployment is outside selected environment',
    });
  });

  it('all_matching selection excludes excluded_ids', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ids: ['n1', 'n2'] } as never)
      .mockResolvedValueOnce({ environment_id: 'env2' } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'delete',
      selection: {
        all_matching: true,
        excluded_ids: ['n2'],
      },
    }), {} as never);
    const body = await res.json() as {
      total_targeted: number;
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; error?: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.total_targeted).toBe(1);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results).toEqual([{
      id: 'n1',
      ok: false,
      error: 'Network deployment is outside selected environment',
    }]);
  });
});
