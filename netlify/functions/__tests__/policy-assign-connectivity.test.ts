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
  requireGroupPermission: vi.fn(),
}));
vi.mock('../_lib/policy-locks.js', () => ({ canModifyLocks: vi.fn() }));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/policy-derivatives.js', () => ({
  assignPolicyToDeviceWithDerivative: vi.fn(),
  syncPolicyDerivativesForPolicy: vi.fn(),
  getPolicyAmapiContext: vi.fn(),
  ensurePolicyDerivativeForScope: vi.fn(),
  listAffectedDevicesForPolicyContext: vi.fn(),
}));

import { queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { canModifyLocks } from '../_lib/policy-locks.js';
import {
  assignPolicyToDeviceWithDerivative,
  getPolicyAmapiContext,
  listAffectedDevicesForPolicyContext,
  syncPolicyDerivativesForPolicy,
} from '../_lib/policy-derivatives.js';
import handler from '../policy-assign.js';

const mockQueryOne = vi.mocked(queryOne);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentResourcePermission);
const mockCanModifyLocks = vi.mocked(canModifyLocks);
const mockGetPolicyAmapiContext = vi.mocked(getPolicyAmapiContext);
const mockListAffectedDevices = vi.mocked(listAffectedDevicesForPolicyContext);
const mockSyncPolicyDerivatives = vi.mocked(syncPolicyDerivativesForPolicy);
const mockAssignPolicyToDevice = vi.mocked(assignPolicyToDeviceWithDerivative);

describe('policy assignment connectivity preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } } as never);
    mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
    mockCanModifyLocks.mockResolvedValue({ allowed: true } as never);
    mockGetPolicyAmapiContext.mockResolvedValue({
      workspace_id: 'ws_1',
      gcp_project_id: 'project_1',
      enterprise_name: 'enterprises/e1',
    });
    mockListAffectedDevices.mockResolvedValue([]);
    mockSyncPolicyDerivatives.mockResolvedValue({} as never);
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    } as never));
  });

  it('passes authored connectivity siblings to derivative generation without stale APN state', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'policy_1', name: 'Policy', environment_id: 'env_1' } as never)
      .mockResolvedValueOnce({ id: 'env_1' } as never)
      .mockResolvedValueOnce({
        config: {
          applications: [{ packageName: 'com.example.app' }],
          openNetworkConfiguration: { Type: 'UnencryptedConfiguration' },
          cameraDisabled: true,
          deviceConnectivityManagement: {
            usbDataAccess: 'DISALLOW_USB_DATA_TRANSFER',
            bluetoothSharing: 'BLUETOOTH_SHARING_DISALLOWED',
            apnPolicy: { apnSettings: [{ displayName: 'Old', apn: 'old.example' }] },
          },
        },
      } as never);

    const response = await handler(new Request('http://localhost/api/policies/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        policy_id: 'policy_1',
        scope_type: 'environment',
        scope_id: 'env_1',
      }),
    }), {} as never);

    expect(response.status).toBe(200);
    expect(mockSyncPolicyDerivatives).toHaveBeenCalledWith(expect.objectContaining({
      baseConfig: {
        cameraDisabled: true,
        deviceConnectivityManagement: {
          usbDataAccess: 'DISALLOW_USB_DATA_TRANSFER',
          bluetoothSharing: 'BLUETOOTH_SHARING_DISALLOWED',
        },
      },
    }));
  });

  it('preserves connectivity siblings when unassignment reapplies the effective policy', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'env_1' } as never)
      .mockResolvedValueOnce({ policy_id: 'old_policy' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ group_id: null, policy_id: 'new_policy' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        config: JSON.stringify({
          applications: [{ packageName: 'com.example.app' }],
          openNetworkConfiguration: { Type: 'UnencryptedConfiguration' },
          cameraDisabled: true,
          deviceConnectivityManagement: {
            wifiDirectSettings: 'DISALLOW_WIFI_DIRECT',
            privateDnsSettings: { privateDnsMode: 'PRIVATE_DNS_AUTOMATIC' },
            apnPolicy: { apnSettings: [{ displayName: 'Old', apn: 'old.example' }] },
          },
        }),
      } as never);
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id, amapi_name FROM devices')) {
          return {
            rows: [{ id: 'device_1', amapi_name: 'enterprises/e1/devices/d1' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    } as never));
    mockAssignPolicyToDevice.mockResolvedValue({} as never);

    const response = await handler(new Request('http://localhost/api/policies/unassign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope_type: 'environment',
        scope_id: 'env_1',
      }),
    }), {} as never);

    expect(response.status).toBe(200);
    expect(mockAssignPolicyToDevice).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'new_policy',
      deviceId: 'device_1',
      baseConfig: {
        cameraDisabled: true,
        deviceConnectivityManagement: {
          wifiDirectSettings: 'DISALLOW_WIFI_DIRECT',
          privateDnsSettings: { privateDnsMode: 'PRIVATE_DNS_AUTOMATIC' },
        },
      },
    }));
  });
});
