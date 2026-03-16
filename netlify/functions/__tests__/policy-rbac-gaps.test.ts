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
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  parseJsonBody: vi.fn((req: Request) => req.json()),
  getClientIp: vi.fn(() => '127.0.0.1'),
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

import { query, queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import policyCloneHandler from '../policy-clone.ts';
import policyVersionsHandler from '../policy-versions.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockLogAudit = vi.mocked(logAudit);

const authContext = { user: { id: 'user_1', email: 'u@example.com', is_superadmin: false } };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authContext as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
  mockLogAudit.mockResolvedValue(undefined as never);
  mockTransaction.mockImplementation(async (fn: (tx: { query: ReturnType<typeof vi.fn> }) => unknown) => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] }),
    };
    return fn(client);
  });
});

describe('policy clone RBAC', () => {
  it('requires admin role for source policy environment', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'pol_1',
      environment_id: 'env_1',
      name: 'Source',
      description: null,
      deployment_scenario: 'PERSONAL_DEVICE',
      config: {},
    } as never);

    const res = await policyCloneHandler(new Request('http://localhost/api/policies/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_id: 'pol_1', new_name: 'Copy' }),
    }), {} as never);

    expect(res.status).toBe(201);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(authContext, 'env_1', 'policy', 'write');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy.cloned' }));
  });

  it('propagates 403 from RBAC check', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'pol_1',
      environment_id: 'env_1',
      name: 'Source',
      description: null,
      deployment_scenario: 'PERSONAL_DEVICE',
      config: {},
    } as never);
    mockRequireEnvironmentResourcePermission.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    );

    await expect(policyCloneHandler(new Request('http://localhost/api/policies/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_id: 'pol_1', new_name: 'Copy' }),
    }), {} as never)).rejects.toEqual(expect.objectContaining({ status: 403 }));
  });
});

describe('policy versions RBAC', () => {
  it('requires viewer role for policy environment before returning versions', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'pol_1', environment_id: 'env_1' } as never);
    mockQuery.mockResolvedValueOnce([{ version: 1, created_at: '2026-01-01T00:00:00Z' }] as never);

    const res = await policyVersionsHandler(
      new Request('http://localhost/api/policies/pol_1/versions', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(authContext, 'env_1', 'policy', 'read');
  });

  it('propagates 403 from viewer RBAC check', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'pol_1', environment_id: 'env_1' } as never);
    mockRequireEnvironmentResourcePermission.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    );

    await expect(policyVersionsHandler(
      new Request('http://localhost/api/policies/pol_1/versions', { method: 'GET' }),
      {} as never
    )).rejects.toEqual(expect.objectContaining({ status: 403 }));
  });
});
