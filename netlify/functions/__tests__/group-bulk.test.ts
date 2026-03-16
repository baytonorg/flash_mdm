import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
}));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/policy-derivatives.js', () => ({
  getPolicyAmapiContext: vi.fn(async () => null),
  assignPolicyToDeviceWithDerivative: vi.fn(),
}));

import { query, queryOne, execute, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import handler from '../group-crud.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);

describe('POST /api/groups/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      user: { id: 'user-1' },
      sessionId: 'sess-1',
    } as never);
  });

  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/groups/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('bulk move supports clear_direct_assignments cleanup', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: '11111111-1111-4111-8111-111111111111', environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: null } as never)
      .mockResolvedValueOnce({ id: '22222222-2222-4222-8222-222222222222', environment_id: '44444444-4444-4444-8444-444444444444' } as never)
      .mockResolvedValueOnce(null as never);

    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockTransaction.mockImplementation(async (cb: (tx: typeof client) => unknown) => cb(client) as never);

    const res = await handler(makeRequest({
      environment_id: '44444444-4444-4444-8444-444444444444',
      operation: 'move',
      selection: { ids: ['11111111-1111-4111-8111-111111111111'] },
      options: {
        target_parent_id: '22222222-2222-4222-8222-222222222222',
        clear_direct_assignments: true,
      },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM policy_assignments'), ['11111111-1111-4111-8111-111111111111']);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM app_deployments'), ['11111111-1111-4111-8111-111111111111']);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM network_deployments'), ['11111111-1111-4111-8111-111111111111']);
  });

  it('bulk move reports per-item cycle failure', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: '11111111-1111-4111-8111-111111111111', environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: null } as never)
      .mockResolvedValueOnce({ id: '22222222-2222-4222-8222-222222222222', environment_id: '44444444-4444-4444-8444-444444444444' } as never)
      .mockResolvedValueOnce({ exists: 1 } as never);

    const res = await handler(makeRequest({
      environment_id: '44444444-4444-4444-8444-444444444444',
      operation: 'move',
      selection: { ids: ['11111111-1111-4111-8111-111111111111'] },
      options: {
        target_parent_id: '22222222-2222-4222-8222-222222222222',
      },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      ok: false,
      error: 'Cannot move a group under one of its descendants',
    });
  });

  it('all_matching selection excludes excluded_ids for move operations', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '33333333-3333-4333-8333-333333333333' },
    ] as never);
    mockQueryOne
      .mockResolvedValueOnce({ id: '11111111-1111-4111-8111-111111111111', environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: null } as never)
      .mockResolvedValueOnce({ id: '22222222-2222-4222-8222-222222222222', environment_id: '44444444-4444-4444-8444-444444444444' } as never)
      .mockResolvedValueOnce(null as never);
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockTransaction.mockImplementation(async (cb: (tx: typeof client) => unknown) => cb(client) as never);

    const res = await handler(makeRequest({
      environment_id: '44444444-4444-4444-8444-444444444444',
      operation: 'move',
      selection: {
        all_matching: true,
        excluded_ids: ['33333333-3333-4333-8333-333333333333'],
      },
      options: {
        target_parent_id: '22222222-2222-4222-8222-222222222222',
      },
    }), {} as never);
    const body = await res.json() as { total_targeted: number; results: Array<{ id: string; ok: boolean }> };

    expect(res.status).toBe(200);
    expect(body.total_targeted).toBe(1);
    expect(body.results).toEqual([{ id: '11111111-1111-4111-8111-111111111111', ok: true }]);
  });

  it('bulk move supports mixed-valid multi-select with per-item errors', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: '11111111-1111-4111-8111-111111111111', environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: null } as never)
      .mockResolvedValueOnce({ id: '22222222-2222-4222-8222-222222222222', environment_id: '44444444-4444-4444-8444-444444444444' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: '33333333-3333-4333-8333-333333333333', environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: null } as never)
      .mockResolvedValueOnce({ id: '22222222-2222-4222-8222-222222222222', environment_id: '44444444-4444-4444-8444-444444444444' } as never)
      .mockResolvedValueOnce({ exists: 1 } as never);
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockTransaction.mockImplementation(async (cb: (tx: typeof client) => unknown) => cb(client) as never);

    const res = await handler(makeRequest({
      environment_id: '44444444-4444-4444-8444-444444444444',
      operation: 'move',
      selection: { ids: ['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'] },
      options: {
        target_parent_id: '22222222-2222-4222-8222-222222222222',
      },
    }), {} as never);
    const body = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r) => r.id === '11111111-1111-4111-8111-111111111111')).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      ok: true,
    });
    expect(body.results.find((r) => r.id === '33333333-3333-4333-8333-333333333333')).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      ok: false,
      error: 'Cannot move a group under one of its descendants',
    });
  });

  it('bulk delete dedupes descendant overlap and reports covered descendants as no-op success', async () => {
    const rootId = '11111111-1111-4111-8111-111111111111';
    const childId = '33333333-3333-4333-8333-333333333333';

    mockQueryOne
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ exists: 1 } as never)
      .mockResolvedValueOnce({ environment_id: '44444444-4444-4444-8444-444444444444' } as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT descendant_id FROM group_closures WHERE ancestor_id = $1')) {
        return [{ descendant_id: rootId }, { descendant_id: childId }] as never;
      }
      if (sql.includes('SELECT id, amapi_name FROM devices')) {
        return [] as never;
      }
      return [] as never;
    });
    mockExecute.mockResolvedValue(undefined as never);

    const res = await handler(makeRequest({
      environment_id: '44444444-4444-4444-8444-444444444444',
      operation: 'delete',
      selection: { ids: [rootId, childId] },
    }), {} as never);
    const body = await res.json() as {
      total_targeted: number;
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(body.total_targeted).toBe(2);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.results).toEqual(expect.arrayContaining([
      { id: rootId, ok: true },
      { id: childId, ok: true },
    ]));
  });
});
