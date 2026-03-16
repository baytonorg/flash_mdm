import { describe, expect, it, vi } from 'vitest';

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

vi.mock('../_lib/blobs.js', () => ({
  storeBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  getPolicyAmapiContext: vi.fn(),
  syncPolicyDerivativesForPolicy: vi.fn(),
}));

import { requireAuth } from '../_lib/auth.js';
import handler from '../certificate-crud.ts';

const mockRequireAuth = vi.mocked(requireAuth);

describe('certificate-crud error handling', () => {
  it('masks unexpected internal errors with a generic 500 response', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('relation "certificates" does not exist'));

    const res = await handler(
      new Request('http://localhost/api/certificates/list?environment_id=env_1', {
        method: 'GET',
      }),
      {} as never
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Internal server error',
    });
  });
});
