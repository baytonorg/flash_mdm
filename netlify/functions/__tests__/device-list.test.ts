import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
}));

import { query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentAccessScopeForResourcePermission } from '../_lib/rbac.js';
import handler from '../device-list.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvScope = vi.mocked(requireEnvironmentAccessScopeForResourcePermission);

describe('device-list UUID validation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvScope.mockReset();

    mockRequireAuth.mockResolvedValue({
      user: { id: '22222222-2222-4222-8222-222222222222' },
    } as never);
    mockRequireEnvScope.mockResolvedValue({
      mode: 'environment',
      accessible_group_ids: null,
    } as never);
  });

  it('rejects malformed environment_id before RBAC/DB access', async () => {
    const res = await handler(
      new Request('http://localhost/api/device-list?environment_id=not-a-uuid', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'environment_id must be a valid UUID' });
    expect(mockRequireEnvScope).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects malformed group_id before DB queries', async () => {
    const res = await handler(
      new Request(
        'http://localhost/api/device-list?environment_id=44444444-4444-4444-8444-444444444444&group_id=not-a-uuid',
        { method: 'GET' }
      ),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'group_id must be a valid UUID' });
    expect(mockRequireEnvScope).toHaveBeenCalledWith(
      expect.anything(),
      '44444444-4444-4444-8444-444444444444',
      'device',
      'read'
    );
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns thrown response-like objects from helper layers', async () => {
    const forbidden = {
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: vi.fn().mockResolvedValue({ error: 'Forbidden' }),
      text: vi.fn(),
    } as unknown as Response;

    mockRequireEnvScope.mockRejectedValueOnce(forbidden);

    const res = await handler(
      new Request(
        'http://localhost/api/device-list?environment_id=44444444-4444-4444-8444-444444444444',
        { method: 'GET' }
      ),
      {} as never
    );

    expect(res).toBe(forbidden);
    expect(res.status).toBe(403);
  });
});
