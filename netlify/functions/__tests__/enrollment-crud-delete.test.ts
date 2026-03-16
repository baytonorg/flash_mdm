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

describe('DELETE /api/enrolment/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      user: { id: 'u1' },
      sessionId: 'sess-1',
    } as never);
  });

  it('returns 404 when token does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(
      new Request('http://localhost/api/enrolment/11111111-1111-4111-8111-111111111111', {
        method: 'DELETE',
      }),
      {} as never
    );
    const body = await res.json() as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe('Enrolment token not found');
  });
});
