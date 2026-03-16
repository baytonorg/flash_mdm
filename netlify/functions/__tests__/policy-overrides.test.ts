import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../_lib/policy-locks.js', () => ({
  getInheritedLocks: vi.fn(),
  validateOverrideAgainstLocks: vi.fn(),
  canSaveOverrides: vi.fn(),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  syncPolicyDerivativesForPolicy: vi.fn(),
  getPolicyAmapiContext: vi.fn(),
  listAffectedDevicesForPolicyContext: vi.fn(),
  assignPolicyToDeviceWithDerivative: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { getInheritedLocks } from '../_lib/policy-locks.js';
import handler from '../policy-overrides.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvPermission = vi.mocked(requireEnvironmentResourcePermission);
const mockGetInheritedLocks = vi.mocked(getInheritedLocks);

describe('policy-overrides GET effective base config', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvPermission.mockReset();
    mockGetInheritedLocks.mockReset();

    mockRequireAuth.mockResolvedValue({
      user: { id: '11111111-1111-4111-8111-111111111111' },
    } as never);
    mockRequireEnvPermission.mockResolvedValue(undefined as never);
    mockGetInheritedLocks.mockResolvedValue({
      fully_locked: false,
      locked_sections: [],
      locked_by_scope: null,
      locked_by_scope_name: null,
    });
  });

  it('returns device effective_base_config with inherited group overrides applied', async () => {
    const envId = '22222222-2222-4222-8222-222222222222';
    const deviceId = '33333333-3333-4333-8333-333333333333';
    const policyId = '44444444-4444-4444-8444-444444444444';
    const groupId = '55555555-5555-4555-8555-555555555555';

    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT environment_id FROM devices')) return { environment_id: envId } as never;
      if (sql.includes('SELECT config FROM policies')) return { config: { screenCaptureDisabled: false } } as never;
      if (sql.includes('SELECT group_id FROM devices')) return { group_id: groupId } as never;
      if (sql.includes('FROM device_policy_overrides')) return null as never;
      return null as never;
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM group_closures gc') && sql.includes('JOIN group_policy_overrides')) {
        return [{ override_config: { playStoreMode: 'WHITELIST' } }] as never;
      }
      return [] as never;
    });

    const res = await handler(
      new Request(`http://localhost/api/policies/overrides?policy_id=${policyId}&scope_type=device&scope_id=${deviceId}`, { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.override_config).toEqual({});
    expect(body.effective_base_config).toMatchObject({
      screenCaptureDisabled: false,
      playStoreMode: 'WHITELIST',
    });
    expect(mockGetInheritedLocks).toHaveBeenCalledWith('device', deviceId, policyId, envId);
  });
});

