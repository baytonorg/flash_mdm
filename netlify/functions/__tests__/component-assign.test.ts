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

vi.mock('../_lib/policy-recompile.js', () => ({
  recompilePolicy: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  parseJsonBody: vi.fn((req: Request) => req.json()),
  getClientIp: vi.fn(() => '127.0.0.1'),
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  errorResponse: vi.fn((message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

import { execute, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import { recompilePolicy } from '../_lib/policy-recompile.js';
import handler from '../component-assign.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockLogAudit = vi.mocked(logAudit);
const mockRecompilePolicy = vi.mocked(recompilePolicy);

function makeAssignRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/components/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    user: { id: 'user_1', is_superadmin: false },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
  mockLogAudit.mockResolvedValue(undefined as never);
  mockRecompilePolicy.mockResolvedValue(undefined as never);
  mockExecute.mockResolvedValue({ rowCount: 1 } as never);
});

describe('component-assign assign environment validation', () => {
  it('rejects cross-environment component assignment', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'pol_1', environment_id: 'env_1' } as never)
      .mockResolvedValueOnce({ id: 'cmp_1', name: 'Comp', environment_id: 'env_2' } as never);

    const res = await handler(
      makeAssignRequest({ policy_id: 'pol_1', component_id: 'cmp_1' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Component does not belong to this policy environment',
    });
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'user_1' }) }),
      'env_1',
      'policy',
      'write'
    );
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockRecompilePolicy).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('assigns component when policy and component share environment', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'pol_1', environment_id: 'env_1' } as never)
      .mockResolvedValueOnce({ id: 'cmp_1', name: 'Comp', environment_id: 'env_1' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ max_p: 2 } as never);

    const res = await handler(
      makeAssignRequest({ policy_id: 'pol_1', component_id: 'cmp_1' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Component assigned and policy recompiled',
    });
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO policy_component_assignments'),
      ['pol_1', 'cmp_1', 3]
    );
    expect(mockRecompilePolicy).toHaveBeenCalledWith('pol_1', 'user_1');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      environment_id: 'env_1',
      action: 'component.assigned',
      resource_id: 'pol_1',
      details: expect.objectContaining({ component_id: 'cmp_1', component_name: 'Comp', priority: 3 }),
    }));
  });
});
