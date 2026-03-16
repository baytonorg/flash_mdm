import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  errorResponse: vi.fn((msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })),
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
}));

import { query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import handler from '../audit-log.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvPerm = vi.mocked(requireEnvironmentResourcePermission);

function makeRequest(search = '?environment_id=env_1') {
  return new Request(`http://localhost/.netlify/functions/audit-log${search}`);
}

describe('audit-log privileged visibility filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: { id: 'user_1', email: 'user@example.com', is_superadmin: false },
    } as never);
    mockQueryOne.mockResolvedValue({ count: '0' } as never);
    mockQuery.mockResolvedValue([] as never);
  });

  it('filters to standard entries by default when caller lacks read_privileged', async () => {
    mockRequireEnvPerm.mockImplementation(async (_auth, _envId, _resource, permission) => {
      if (permission === 'read') return 'member' as never;
      throw new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    });

    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(200);
    expect(mockRequireEnvPerm).toHaveBeenNthCalledWith(1, expect.anything(), 'env_1', 'audit', 'read');
    expect(mockRequireEnvPerm).toHaveBeenNthCalledWith(2, expect.anything(), 'env_1', 'audit', 'read_privileged');
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('a.visibility_scope = $2'),
      ['env_1', 'standard']
    );
  });

  it('includes privileged entries by default when caller has read_privileged', async () => {
    mockRequireEnvPerm.mockResolvedValue('admin' as never);

    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(200);
    const countSql = mockQueryOne.mock.calls[0]?.[0] as string;
    const countParams = mockQueryOne.mock.calls[0]?.[1] as unknown[];
    expect(countSql).not.toContain('a.visibility_scope =');
    expect(countParams).toEqual(['env_1']);
  });

  it('rejects include_privileged=true without read_privileged permission', async () => {
    mockRequireEnvPerm.mockImplementation(async (_auth, _envId, _resource, permission) => {
      if (permission === 'read') return 'member' as never;
      throw new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    });

    const res = await handler(makeRequest('?environment_id=env_1&include_privileged=true'), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: insufficient permission for privileged audit entries',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rejects privileged visibility_scope filter without permission', async () => {
    mockRequireEnvPerm.mockImplementation(async (_auth, _envId, _resource, permission) => {
      if (permission === 'read') return 'member' as never;
      throw new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    });

    const res = await handler(makeRequest('?environment_id=env_1&visibility_scope=privileged'), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: insufficient permission for privileged audit entries',
    });
  });

  it('supports actor_type filter and forwards it to SQL', async () => {
    mockRequireEnvPerm.mockResolvedValue('admin' as never);

    const res = await handler(
      makeRequest('?environment_id=env_1&actor_type=system&visibility_scope=privileged'),
      {} as never
    );

    expect(res.status).toBe(200);
    const countSql = mockQueryOne.mock.calls[0]?.[0] as string;
    const countParams = mockQueryOne.mock.calls[0]?.[1] as unknown[];
    expect(countSql).toContain('a.visibility_scope = $2');
    expect(countSql).toContain('a.actor_type = $3');
    expect(countParams).toEqual(['env_1', 'privileged', 'system']);
  });

  it('supports api_key actor_type filter and forwards it to SQL', async () => {
    mockRequireEnvPerm.mockResolvedValue('admin' as never);

    const res = await handler(makeRequest('?environment_id=env_1&actor_type=api_key'), {} as never);

    expect(res.status).toBe(200);
    const countSql = mockQueryOne.mock.calls[0]?.[0] as string;
    const countParams = mockQueryOne.mock.calls[0]?.[1] as unknown[];
    expect(countSql).toContain('a.actor_type = $2');
    expect(countParams).toEqual(['env_1', 'api_key']);
  });

  it('rejects invalid actor_type values', async () => {
    mockRequireEnvPerm.mockResolvedValue('admin' as never);

    const res = await handler(makeRequest('?environment_id=env_1&actor_type=daemon'), {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'actor_type must be "user", "system", or "api_key"',
    });
  });

  it('masks unexpected internal errors with a generic 500 response', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('column a.visibility_scope does not exist'));

    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Internal server error',
    });
  });
});
