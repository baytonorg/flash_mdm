import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
}));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/policy-derivatives.js', () => ({
  syncPolicyDerivativesForPolicy: vi.fn(),
  getPolicyAmapiContext: vi.fn(),
}));
vi.mock('../_lib/policy-derivative-cleanup.js', () => ({
  deletePolicyDerivativeWhenUnused: vi.fn(),
}));

import { execute, query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { getPolicyAmapiContext } from '../_lib/policy-derivatives.js';
import { deletePolicyDerivativeWhenUnused } from '../_lib/policy-derivative-cleanup.js';
import handler from '../policy-crud.js';

const mockExecute = vi.mocked(execute);
const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentResourcePermission);
const mockGetPolicyAmapiContext = vi.mocked(getPolicyAmapiContext);
const mockDeleteDerivativeWhenUnused = vi.mocked(deletePolicyDerivativeWhenUnused);

const policyId = '11111111-1111-4111-8111-111111111111';
const environmentId = '22222222-2222-4222-8222-222222222222';
const scopeId = '33333333-3333-4333-8333-333333333333';

describe('policy deletion derivative cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } } as never);
    mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
    mockGetPolicyAmapiContext.mockResolvedValue({
      workspace_id: 'workspace_1',
      gcp_project_id: 'project_1',
      enterprise_name: 'enterprises/e1',
    });
    mockQueryOne
      .mockResolvedValueOnce({
        id: policyId,
        environment_id: environmentId,
        name: 'Temporary policy',
        amapi_name: null,
      } as never)
      .mockResolvedValueOnce({ count: '0' } as never);
    mockQuery.mockResolvedValue([{
      amapi_name: 'enterprises/e1/policies/old-device',
      scope_type: 'device',
      scope_id: scopeId,
    }] as never);
  });

  it('retains the policy when derivative cleanup is uncertain', async () => {
    mockDeleteDerivativeWhenUnused.mockResolvedValue({
      deleted: false,
      reason: 'device_check_uncertain',
      checked_devices: 0,
    });

    const response = await handler(new Request(`http://localhost/api/policies/${policyId}`, {
      method: 'DELETE',
    }), {} as never);

    expect(response.status).toBe(502);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('blocks deletion while a device still requests or applies the derivative', async () => {
    mockDeleteDerivativeWhenUnused.mockResolvedValue({
      deleted: false,
      reason: 'still_requested_or_applied',
      checked_devices: 1,
    });

    const response = await handler(new Request(`http://localhost/api/policies/${policyId}`, {
      method: 'DELETE',
    }), {} as never);

    expect(response.status).toBe(409);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('deletes local policy state after remote cleanup succeeds', async () => {
    mockDeleteDerivativeWhenUnused.mockResolvedValue({
      deleted: true,
      reason: 'already_absent',
      checked_devices: 1,
    });

    const response = await handler(new Request(`http://localhost/api/policies/${policyId}`, {
      method: 'DELETE',
    }), {} as never);

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM policies WHERE id = $1', [policyId]);
  });
});
