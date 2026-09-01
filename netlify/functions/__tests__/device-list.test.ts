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

const environmentId = '44444444-4444-4444-8444-444444444444';

describe('device-list filters and validation', () => {
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
    mockQuery.mockResolvedValue([] as never);
    mockQueryOne.mockImplementation(async (sql) => (
      String(sql).includes('JOIN workspaces')
        ? { settings: {} }
        : { count: '0' }
    ) as never);
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
        `http://localhost/api/device-list?environment_id=${environmentId}&group_id=not-a-uuid`,
        { method: 'GET' }
      ),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'group_id must be a valid UUID' });
    expect(mockRequireEnvScope).toHaveBeenCalledWith(
      expect.anything(),
      environmentId,
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
        `http://localhost/api/device-list?environment_id=${environmentId}`,
        { method: 'GET' }
      ),
      {} as never
    );

    expect(res).toBe(forbidden);
    expect(res.status).toBe(403);
  });

  it('rejects invalid compliance filters before database queries', async () => {
    const res = await handler(
      new Request(
        `http://localhost/api/device-list?environment_id=${environmentId}&policy_compliant=unknown`,
        { method: 'GET' }
      ),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'policy_compliant must be true or false' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects invalid report freshness filters before database queries', async () => {
    const res = await handler(
      new Request(
        `http://localhost/api/device-list?environment_id=${environmentId}&report_freshness=offline`,
        { method: 'GET' }
      ),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'report_freshness must be fresh, stale, or unknown' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('binds policy_compliant=%s as a boolean predicate', async (rawValue, expectedValue) => {
    await handler(
      new Request(
        `http://localhost/api/device-list?environment_id=${environmentId}&policy_compliant=${rawValue}`,
        { method: 'GET' }
      ),
      {} as never
    );

    const [countSql, countParams] = mockQueryOne.mock.calls[1] ?? [];
    expect(String(countSql)).toContain('d.policy_compliant = $2');
    expect(countParams).toEqual([environmentId, expectedValue]);

    const [deviceSql, deviceParams] = mockQuery.mock.calls[1] ?? [];
    expect(String(deviceSql)).toContain('d.policy_compliant = $2');
    expect(deviceParams).toEqual([environmentId, expectedValue, 50, 0]);
  });

  it('filters rows and totals while returning stable fleet-wide manufacturer facets', async () => {
    const device = {
      id: 'device_1',
      manufacturer: 'Google',
      policy_compliant: false,
    };
    mockQuery
      .mockResolvedValueOnce([
        { manufacturer: 'Google' },
        { manufacturer: 'motorola' },
      ] as never)
      .mockResolvedValueOnce([device] as never);
    mockQueryOne
      .mockResolvedValueOnce({ settings: { device_health: { stale_after_days: 14 } } } as never)
      .mockResolvedValueOnce({ count: '26' } as never);

    const res = await handler(
      new Request(
        `http://localhost/api/device-list?environment_id=${environmentId}&manufacturer=%20google%20&policy_compliant=false&page=2&per_page=10`,
        { method: 'GET' }
      ),
      {} as never
    );

    const [facetSql, facetParams] = mockQuery.mock.calls[0] ?? [];
    expect(String(facetSql)).toContain("NULLIF(BTRIM(d.manufacturer), '') IS NOT NULL");
    expect(String(facetSql)).toContain('GROUP BY LOWER(BTRIM(d.manufacturer))');
    expect(String(facetSql)).not.toContain('d.policy_compliant =');
    expect(String(facetSql)).not.toContain('LOWER(BTRIM(d.manufacturer)) = LOWER($');
    expect(facetParams).toEqual([environmentId]);

    const [countSql, countParams] = mockQueryOne.mock.calls[1] ?? [];
    expect(String(countSql)).toContain('LOWER(BTRIM(d.manufacturer)) = LOWER($2)');
    expect(String(countSql)).toContain('d.policy_compliant = $3');
    expect(countParams).toEqual([environmentId, 'google', false]);

    const [deviceSql, deviceParams] = mockQuery.mock.calls[1] ?? [];
    expect(String(deviceSql)).toContain('LOWER(BTRIM(d.manufacturer)) = LOWER($2)');
    expect(String(deviceSql)).toContain('d.policy_compliant = $3');
    expect(deviceParams).toEqual([environmentId, 'google', false, 10, 10]);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      devices: [{ ...device, report_freshness: 'unknown' }],
      pagination: { page: 2, per_page: 10, total: 26, total_pages: 3 },
      facets: {
        manufacturers: [
          { value: 'Google', label: 'Google' },
          { value: 'motorola', label: 'motorola' },
        ],
      },
      device_report_stale_after_days: 14,
    });
  });

  it('returns empty facets without database access when no groups are accessible', async () => {
    mockRequireEnvScope.mockResolvedValueOnce({
      mode: 'group',
      accessible_group_ids: [],
    } as never);

    const res = await handler(
      new Request(`http://localhost/api/device-list?environment_id=${environmentId}`, { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      devices: [],
      pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
      facets: { manufacturers: [] },
      device_report_stale_after_days: 7,
    });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('scopes facets and combined filters to the caller accessible groups', async () => {
    const accessibleGroupIds = [
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ];
    mockRequireEnvScope.mockResolvedValueOnce({
      mode: 'group',
      accessible_group_ids: accessibleGroupIds,
    } as never);

    await handler(
      new Request(
        `http://localhost/api/device-list?environment_id=${environmentId}&manufacturer=Google&policy_compliant=false`,
        { method: 'GET' }
      ),
      {} as never
    );

    const [facetSql, facetParams] = mockQuery.mock.calls[0] ?? [];
    expect(String(facetSql)).toContain('d.group_id = ANY($2::uuid[])');
    expect(facetParams).toEqual([environmentId, accessibleGroupIds]);

    const [countSql, countParams] = mockQueryOne.mock.calls[1] ?? [];
    expect(String(countSql)).toContain('d.group_id = ANY($2::uuid[])');
    expect(String(countSql)).toContain('LOWER(BTRIM(d.manufacturer)) = LOWER($3)');
    expect(String(countSql)).toContain('d.policy_compliant = $4');
    expect(countParams).toEqual([environmentId, accessibleGroupIds, 'Google', false]);
  });

  it.each([
    ['stale', '<', [environmentId, 7]],
    ['fresh', '>=', [environmentId, 7]],
    ['unknown', 'IS NULL', [environmentId]],
  ])('filters report_freshness=%s using the workspace threshold', async (freshness, operator, expectedParams) => {
    await handler(
      new Request(
        `http://localhost/api/device-list?environment_id=${environmentId}&report_freshness=${freshness}`,
        { method: 'GET' }
      ),
      {} as never
    );

    const [countSql, countParams] = mockQueryOne.mock.calls[1] ?? [];
    expect(String(countSql)).toContain(`d.last_status_report_at ${operator}`);
    expect(countParams).toEqual(expectedParams);
  });
});
