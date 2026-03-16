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
  requireEnvironmentPermission: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  parseJsonBody: vi.fn((req: Request) => req.json()),
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
  errorResponse: vi.fn((message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { query, queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../workflow-crud.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockLogAudit = vi.mocked(logAudit);

const fakeUser = { id: 'user1', email: 'user@test.com', is_superadmin: false };

const fakeWorkflow = {
  id: 'wf1',
  environment_id: 'env1',
  name: 'Workflow 1',
  enabled: false,
  trigger_type: 'device.enrolled',
  trigger_config: {},
  conditions: [],
  action_type: 'device.command',
  action_config: {},
  scope_type: 'environment',
  scope_id: null,
  last_triggered_at: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

describe('POST /api/workflows/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ user: fakeUser } as never);
    mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
    mockExecute.mockResolvedValue(undefined as never);
    mockLogAudit.mockResolvedValue(undefined as never);
  });

  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/workflows/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('bulk enables selected workflows and reports per-item success', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'enable',
      selection: { ids: ['wf1'] },
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'write',
    );
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE workflows SET enabled = $1, updated_at = now() WHERE id = $2',
      [true, 'wf1'],
    );
    const payload = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean }> };
    expect(payload.succeeded).toBe(1);
    expect(payload.failed).toBe(0);
    expect(payload.results).toEqual([{ id: 'wf1', ok: true }]);
  });

  it('returns item failure when workflow is outside environment', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...fakeWorkflow, environment_id: 'env2' } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'delete',
      selection: { ids: ['wf1'] },
    }), {} as never);

    expect(res.status).toBe(200);
    const payload = await res.json() as { succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };
    expect(payload.succeeded).toBe(0);
    expect(payload.failed).toBe(1);
    expect(payload.results[0]).toMatchObject({
      id: 'wf1',
      ok: false,
      error: 'Workflow is outside selected environment',
    });
  });

  it('all_matching selection excludes excluded_ids', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'wf1' }, { id: 'wf2' }] as never);
    mockQueryOne.mockResolvedValueOnce({ ...fakeWorkflow, id: 'wf1', enabled: true } as never);

    const res = await handler(makeRequest({
      environment_id: 'env1',
      operation: 'disable',
      selection: {
        all_matching: true,
        excluded_ids: ['wf2'],
      },
    }), {} as never);
    const payload = await res.json() as {
      total_targeted: number;
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(payload.total_targeted).toBe(1);
    expect(payload.succeeded).toBe(1);
    expect(payload.failed).toBe(0);
    expect(payload.results).toEqual([{ id: 'wf1', ok: true }]);
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE workflows SET enabled = $1, updated_at = now() WHERE id = $2',
      [false, 'wf1'],
    );
  });
});
