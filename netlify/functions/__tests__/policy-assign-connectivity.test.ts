import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
// This suite covers derivative payload preservation only. The composed
// permission helper is exercised against PostgreSQL in policy-assignment.postgres.
vi.mock('../_lib/policy-assignment-authority.js', () => ({ requirePolicyAssignmentAuthority: vi.fn().mockResolvedValue({ environmentId: 'env_1' }) }));
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
vi.mock('../_lib/policy-derivative-cleanup.js', () => ({
  deletePolicyDerivativeWhenUnused: vi.fn(),
}));

import { execute, queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { canModifyLocks } from '../_lib/policy-locks.js';
import {
  assignPolicyToDeviceWithDerivative,
  getPolicyAmapiContext,
  listAffectedDevicesForPolicyContext,
  syncPolicyDerivativesForPolicy,
} from '../_lib/policy-derivatives.js';
import { deletePolicyDerivativeWhenUnused } from '../_lib/policy-derivative-cleanup.js';
import handler from '../policy-assign.js';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentResourcePermission);
const mockCanModifyLocks = vi.mocked(canModifyLocks);
const mockGetPolicyAmapiContext = vi.mocked(getPolicyAmapiContext);
const mockListAffectedDevices = vi.mocked(listAffectedDevicesForPolicyContext);
const mockSyncPolicyDerivatives = vi.mocked(syncPolicyDerivativesForPolicy);
const mockAssignPolicyToDevice = vi.mocked(assignPolicyToDeviceWithDerivative);
const mockDeleteDerivativeWhenUnused = vi.mocked(deletePolicyDerivativeWhenUnused);

describe('policy assignment connectivity preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryOne.mockReset();
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
    mockDeleteDerivativeWhenUnused.mockResolvedValue({
      deleted: true,
      reason: 'deleted',
      checked_devices: 1,
    });
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id FROM policies')) return {rows:[{id:'88888888-8888-4888-8888-888888888888'}],rowCount:1};
        if (sql.includes('SELECT policy_id FROM policy_assignments')) return {rows:[{policy_id:'old_policy'}],rowCount:1};
        if (sql.includes('SELECT amapi_name FROM policy_derivatives')) {const row=await queryOne(sql);return {rows:row?[row]:[],rowCount:1};}
        return {rows:[],rowCount:1};
      }),
    } as never));
  });

  it('passes authored connectivity siblings to derivative generation without stale APN state', async () => {
    mockQueryOne
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
        policy_id: '88888888-8888-4888-8888-888888888888',
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
        if (sql.includes('SELECT policy_id FROM policy_assignments')) return {rows:[{policy_id:'old_policy'}],rowCount:1};
        if (sql.includes('SELECT amapi_name FROM policy_derivatives')) return {rows:[],rowCount:0};
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

  it('deletes the local derivative row only after safe remote cleanup succeeds', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ amapi_name: 'enterprises/e1/policies/old-device' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ group_id: null, policy_id: 'new_policy' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ config: { cameraDisabled: false } } as never);
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT policy_id FROM policy_assignments')) return {rows:[{policy_id:'old_policy'}],rowCount:1};
        if (sql.includes('SELECT amapi_name FROM policy_derivatives')) {const row=await queryOne(sql);return {rows:row?[row]:[],rowCount:1};}
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
      body: JSON.stringify({ scope_type: 'device', scope_id: 'device_1' }),
    }), {} as never);

    expect(response.status).toBe(200);
    expect(mockDeleteDerivativeWhenUnused).toHaveBeenCalledWith(expect.objectContaining({
      environmentId: 'env_1',
      scopeType: 'device',
      scopeId: 'device_1',
      amapiName: 'enterprises/e1/policies/old-device',
    }));
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM policy_derivatives'),
      ['old_policy', 'device', 'device_1']
    );
  });

  it('retains the local derivative row when remote cleanup is uncertain', async () => {
    mockDeleteDerivativeWhenUnused.mockResolvedValueOnce({
      deleted: false,
      reason: 'device_check_uncertain',
      checked_devices: 0,
    });
    mockQueryOne
      .mockResolvedValueOnce({ amapi_name: 'enterprises/e1/policies/old-device' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ group_id: null, policy_id: 'new_policy' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ config: {} } as never);
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT policy_id FROM policy_assignments')) return {rows:[{policy_id:'old_policy'}],rowCount:1};
        if (sql.includes('SELECT amapi_name FROM policy_derivatives')) {const row=await queryOne(sql);return {rows:row?[row]:[],rowCount:1};}
        return sql.includes('SELECT id, amapi_name FROM devices')
          ? { rows: [{ id: 'device_1', amapi_name: 'enterprises/e1/devices/d1' }], rowCount: 1 }
          : { rows: [], rowCount: 1 };
      }),
    } as never));
    mockAssignPolicyToDevice.mockResolvedValue({} as never);

    const response = await handler(new Request('http://localhost/api/policies/unassign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope_type: 'device', scope_id: 'device_1' }),
    }), {} as never);

    expect(response.status).toBe(200);
    expect(mockExecute).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      amapi_sync: {
        derivative_cleanup: { deleted: false, reason: 'device_check_uncertain' },
      },
    });
  });
});
