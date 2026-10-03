import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({ query: vi.fn() }));
vi.mock('../amapi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../amapi.js')>();
  return { ...actual, amapiCall: vi.fn() };
});

import { amapiCall } from '../amapi.js';
import { query } from '../db.js';
import { deletePolicyDerivativeWhenUnused } from '../policy-derivative-cleanup.js';

const mockAmapiCall = vi.mocked(amapiCall);
const mockQuery = vi.mocked(query);

const input = {
  environmentId: 'env_1',
  scopeType: 'device' as const,
  scopeId: 'device_1',
  amapiName: 'enterprises/e1/policies/old-derivative',
  amapiContext: {
    workspace_id: 'workspace_1',
    gcp_project_id: 'project_1',
    enterprise_name: 'enterprises/e1',
  },
};

describe('policy derivative cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([
      { id: 'device_1', amapi_name: 'enterprises/e1/devices/device-1' },
    ] as never);
  });

  it('retains the derivative while a device still applies it', async () => {
    mockAmapiCall.mockResolvedValueOnce({
      policyName: 'enterprises/e1/policies/new-derivative',
      appliedPolicyName: input.amapiName,
    });

    await expect(deletePolicyDerivativeWhenUnused(input)).resolves.toEqual({
      deleted: false,
      reason: 'still_requested_or_applied',
      checked_devices: 1,
    });
    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
  });

  it('deletes the derivative after requested and applied policy both move away', async () => {
    mockAmapiCall
      .mockResolvedValueOnce({
        policyName: 'enterprises/e1/policies/new-derivative',
        appliedPolicyName: 'enterprises/e1/policies/new-derivative',
      })
      .mockResolvedValueOnce({});

    await expect(deletePolicyDerivativeWhenUnused(input)).resolves.toEqual({
      deleted: true,
      reason: 'deleted',
      checked_devices: 1,
    });
    expect(mockAmapiCall).toHaveBeenLastCalledWith(
      input.amapiName,
      input.amapiContext.workspace_id,
      expect.objectContaining({ method: 'DELETE', retryMode: 'safe' })
    );
  });

  it('treats a definite derivative 404 as successful cleanup', async () => {
    mockAmapiCall
      .mockResolvedValueOnce({
        policyName: 'enterprises/e1/policies/new-derivative',
        appliedPolicyName: 'enterprises/e1/policies/new-derivative',
      })
      .mockRejectedValueOnce(new Error('AMAPI error (404): not found'));

    await expect(deletePolicyDerivativeWhenUnused(input)).resolves.toEqual({
      deleted: true,
      reason: 'already_absent',
      checked_devices: 1,
    });
  });

  it('retains the derivative when a device policy read is uncertain', async () => {
    mockAmapiCall.mockRejectedValueOnce(new Error('AMAPI error (503): unavailable'));

    await expect(deletePolicyDerivativeWhenUnused(input)).resolves.toEqual({
      deleted: false,
      reason: 'device_check_uncertain',
      checked_devices: 0,
    });
    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
  });
});
