import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentPermission: vi.fn(),
}));

import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import handler from '../enrollment-list.ts';

const mockQuery = vi.mocked(query);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);

describe('enrollment-list expired token visibility', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvironmentPermission.mockReset();

    mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } } as never);
    mockRequireEnvironmentPermission.mockResolvedValue('viewer' as never);
    mockQuery.mockResolvedValue([] as never);
  });

  it('hides expired tokens by default', async () => {
    const res = await handler(
      new Request('http://localhost/api/enrolment/list?environment_id=env_1', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(['env_1', false]);
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('$2::boolean = true OR et.expires_at IS NULL OR et.expires_at > now()');
  });

  it('returns expired tokens when include_expired=true is requested', async () => {
    await handler(
      new Request('http://localhost/api/enrolment/list?environment_id=env_1&include_expired=true', { method: 'GET' }),
      {} as never
    );

    expect(mockQuery.mock.calls[0]?.[1]).toEqual(['env_1', true]);
  });
});
