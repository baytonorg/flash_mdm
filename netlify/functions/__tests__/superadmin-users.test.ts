import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireSuperadmin: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { requireSuperadmin } from '../_lib/auth.js';
import { query, queryOne } from '../_lib/db.js';
import handler from '../superadmin-users.ts';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

beforeEach(() => {
  mockRequireSuperadmin.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockRequireSuperadmin.mockResolvedValue({ user: { id: 'sa_1', is_superadmin: true } } as never);
});

describe('superadmin-users', () => {
  it('lists users with workspace memberships', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' } as never);
    mockQuery.mockResolvedValueOnce([
      {
        id: 'u1',
        email: 'alice@example.com',
        first_name: 'Alice',
        last_name: 'Admin',
        is_superadmin: true,
        totp_enabled: true,
        created_at: '2026-02-22T00:00:00.000Z',
        last_login_at: '2026-02-22T12:00:00.000Z',
        last_login_method: 'password',
        workspace_count: '2',
        workspaces: [
          { id: 'w1', name: 'Acme', role: 'owner' },
          { id: 'w2', name: 'Beta', role: 'admin' },
        ],
      },
    ] as never);

    const res = await handler(new Request('http://localhost/api/superadmin/users?page=1&per_page=25'), {} as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      users: [
        {
          id: 'u1',
          email: 'alice@example.com',
          first_name: 'Alice',
          last_name: 'Admin',
          is_superadmin: true,
          totp_enabled: true,
          created_at: '2026-02-22T00:00:00.000Z',
          last_login_at: '2026-02-22T12:00:00.000Z',
          last_login_method: 'password',
          workspace_count: 2,
          workspaces: [
            { id: 'w1', name: 'Acme', role: 'owner', access_scope: 'workspace', environment_count: 0, group_count: 0 },
            { id: 'w2', name: 'Beta', role: 'admin', access_scope: 'workspace', environment_count: 0, group_count: 0 },
          ],
        },
      ],
      total: 1,
      page: 1,
      per_page: 25,
    });
  });
});
