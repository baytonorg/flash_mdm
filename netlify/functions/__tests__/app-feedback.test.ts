import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
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
import handler from '../app-feedback.ts';

const mockQuery = vi.mocked(query);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);

function makeGetRequest(path: string) {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentPermission.mockReset();

  mockRequireAuth.mockResolvedValue({
    user: { id: 'user_1', is_superadmin: false },
  } as never);
});

describe('app-feedback', () => {
  it('rejects invalid device_id filter values', async () => {
    const res = await handler(
      makeGetRequest('/api/app-feedback?environment_id=env_1&device_id=not-a-uuid'),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid device_id filter');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lists app feedback items', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 'f1',
      environment_id: 'env_1',
      device_id: 'dev_1',
      device_amapi_name: 'enterprises/e1/devices/d1',
      package_name: 'com.example.app',
      feedback_key: 'policy_state',
      severity: 'ERROR',
      message: 'Failed',
      data_json: {},
      first_reported_at: '2026-03-01T00:00:00.000Z',
      last_reported_at: '2026-03-02T00:00:00.000Z',
      last_update_time: '2026-03-02T00:00:00.000Z',
      status: 'open',
      device_name: 'Device A',
    }] as never);

    const res = await handler(
      makeGetRequest('/api/app-feedback?environment_id=env_1'),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'read'
    );
    expect(body.items).toHaveLength(1);
  });
});
