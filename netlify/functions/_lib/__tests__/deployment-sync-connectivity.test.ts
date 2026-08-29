import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../amapi.js', () => ({
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../policy-derivatives.js', () => ({
  ensurePolicyDerivativeForScope: vi.fn(),
  syncPolicyDerivativesForPolicy: vi.fn(),
  getPolicyAmapiContext: vi.fn(),
  assignPolicyToDeviceWithDerivative: vi.fn(),
  listAffectedDevicesForPolicyContext: vi.fn(),
}));

import { queryOne } from '../db.js';
import {
  getPolicyAmapiContext,
  listAffectedDevicesForPolicyContext,
  syncPolicyDerivativesForPolicy,
} from '../policy-derivatives.js';
import { syncAffectedPoliciesToAmapi } from '../deployment-sync.js';

const mockQueryOne = vi.mocked(queryOne);
const mockGetPolicyAmapiContext = vi.mocked(getPolicyAmapiContext);
const mockListAffectedDevices = vi.mocked(listAffectedDevicesForPolicyContext);
const mockSyncPolicyDerivatives = vi.mocked(syncPolicyDerivativesForPolicy);

describe('deployment sync connectivity preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPolicyAmapiContext.mockResolvedValue({
      workspace_id: 'ws_1',
      gcp_project_id: 'project_1',
      enterprise_name: 'enterprises/e1',
    });
    mockListAffectedDevices.mockResolvedValue([]);
    mockSyncPolicyDerivatives.mockResolvedValue({} as never);
  });

  it('preserves connectivity siblings and removes only stored APN state', async () => {
    mockQueryOne.mockResolvedValue({
      config: JSON.stringify({
        applications: [{ packageName: 'com.example.app' }],
        openNetworkConfiguration: { Type: 'UnencryptedConfiguration' },
        screenCaptureDisabled: true,
        deviceConnectivityManagement: {
          configureWifi: 'DISALLOW_CONFIGURING_WIFI',
          privateDnsSettings: { privateDnsMode: 'PRIVATE_DNS_AUTOMATIC' },
          apnPolicy: { apnSettings: [{ displayName: 'Old', apn: 'old.example' }] },
        },
      }),
    } as never);

    const result = await syncAffectedPoliciesToAmapi(
      ['policy_1'],
      'env_1',
      'environment',
      'env_1'
    );

    expect(result).toMatchObject({ attempted: 1, synced: 1, failed: 0 });
    expect(mockSyncPolicyDerivatives).toHaveBeenCalledWith(expect.objectContaining({
      baseConfig: {
        screenCaptureDisabled: true,
        deviceConnectivityManagement: {
          configureWifi: 'DISALLOW_CONFIGURING_WIFI',
          privateDnsSettings: { privateDnsMode: 'PRIVATE_DNS_AUTOMATIC' },
        },
      },
    }));
  });
});
