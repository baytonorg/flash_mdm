import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({ requireEnvironmentPermission: vi.fn() }));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(),
}));

import { queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import handler from '../enrollment-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);

describe('POST /api/enrolment/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      user: { id: 'u1' },
      sessionId: 'sess-1',
    } as never);
  });

  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/enrolment/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('all_matching mode returns zero-target success when no ids exist', async () => {
    mockQueryOne.mockResolvedValueOnce({ ids: [] } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'delete',
      selection: { all_matching: true },
    }), {} as never);
    const body = await res.json() as { total_targeted: number; succeeded: number; failed: number };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      total_targeted: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it('all_matching mode applies excluded_ids before processing targets', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ids: ['t1', 't2'] } as never)
      .mockResolvedValueOnce({ environment_id: 'env2' } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'delete',
      selection: {
        all_matching: true,
        excluded_ids: ['t2'],
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
      id: 't1',
      ok: false,
      error: 'Enrolment token is outside selected environment',
    }]);
  });
});
