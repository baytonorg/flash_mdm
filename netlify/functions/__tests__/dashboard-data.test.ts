import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({ requireEnvironmentAccessScopeForPermission: vi.fn() }));

import { query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentAccessScopeForPermission } from '../_lib/rbac.js';
import handler from '../dashboard-data.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireScope = vi.mocked(requireEnvironmentAccessScopeForPermission);
const environmentId = '44444444-4444-4444-8444-444444444444';

describe('dashboard device report health', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } } as never);
    mockRequireScope.mockResolvedValue({ mode: 'environment', accessible_group_ids: null } as never);
    mockQuery.mockResolvedValue([] as never);
    mockQueryOne.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('JOIN workspaces')) return { settings: { device_health: { stale_after_days: 10 } } };
      if (text.includes('COUNT(*) FILTER')) return { stale: '2', unknown: '1' };
      if (text.includes('FROM policies')) return { count: '3' };
      if (text.includes('FROM enrollment_tokens')) return { count: '4' };
      if (text.includes('FROM devices')) return { count: '5' };
      return null;
    });
  });

  it('returns stale and unknown report counts separately from AMAPI state', async () => {
    const res = await handler(
      new Request(`http://localhost/api/dashboard/data?environment_id=${environmentId}`),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      device_count: 5,
      device_report_health: { stale_after_days: 10, stale: 2, unknown: 1 },
    }));

    const healthCall = mockQueryOne.mock.calls.find(([sql]) => String(sql).includes('COUNT(*) FILTER'));
    expect(healthCall?.[1]).toEqual([environmentId, 10]);
    expect(String(healthCall?.[0])).not.toContain("state = 'ACTIVE'");
  });
});
