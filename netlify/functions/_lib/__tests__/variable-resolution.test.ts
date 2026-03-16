import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  queryOne: vi.fn(),
}));

import { queryOne } from '../db.js';
import { buildVariableContextForDevice, resolveVariables } from '../variable-resolution.js';

const mockQueryOne = vi.mocked(queryOne);

describe('variable-resolution', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('resolves strict namespaced variables and leaves legacy aliases unresolved', () => {
    const result = resolveVariables(
      {
        identity: '${user.firstname}.${user.lastname}',
        note: 'Device ${device.name} (${device.sn})',
        fallbackCheck: '${serial_number} ${group.department}',
      },
      {
        device: { name: 'Pixel 9', sn: 'ABC123' },
        user: { firstname: 'Alice', lastname: 'Admin' },
        group: { metadata: { department: 'IT' } },
      }
    );

    expect(result.config).toEqual({
      identity: 'Alice.Admin',
      note: 'Device Pixel 9 (ABC123)',
      fallbackCheck: '${serial_number} IT',
    });
    expect(result.unresolved_variables).toEqual(['serial_number']);
    expect(result.resolved_variables).toMatchObject({
      'user.firstname': 'Alice',
      'user.lastname': 'Admin',
      'device.name': 'Pixel 9',
      'device.sn': 'ABC123',
      'group.department': 'IT',
    });
  });

  it('builds user, group, and environment namespaces for a device', async () => {
    // Route mocked rows by SQL shape so the test remains stable if lookup order changes.
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM devices')) {
        return {
          id: 'dev_1',
          amapi_name: 'enterprises/x/devices/y',
          name: 'Warehouse-Kiosk-01',
          serial_number: 'SN-42',
          imei: '351234567890123',
          os_version: '15',
          security_patch_level: '2026-02-01',
          state: 'ACTIVE',
          ownership: 'COMPANY_OWNED',
          management_mode: 'FULLY_MANAGED',
          policy_compliant: true,
          enrollment_time: '2026-02-28T08:00:00.000Z',
          last_status_report_at: '2026-03-01T08:00:00.000Z',
          model: 'Pixel 8',
          manufacturer: 'Google',
          group_id: 'grp_1',
          snapshot: {
            hardwareInfo: { meid: 'MEID-1234', androidId: 'android-1' },
            enrollmentTokenData: { signin_email: 'owner@example.com' },
          },
        } as never;
      }
      if (sql.includes('FROM environments')) {
        return {
          id: 'env_1',
          workspace_id: 'ws_1',
          name: 'Production',
          enterprise_name: 'enterprises/123456',
          enterprise_display_name: 'Prod Enterprise',
        } as never;
      }
      if (sql.includes('FROM groups')) {
        return {
          id: 'grp_1',
          name: 'HQ',
          description: 'HQ devices',
          settings: { metadata: { region: 'EMEA' } },
        } as never;
      }
      if (sql.includes('FROM users u')) {
        return {
          id: 'usr_1',
          first_name: 'Alice',
          last_name: 'Owner',
          email: 'owner@example.com',
          environment_role: 'admin',
          workspace_role: 'member',
          group_role: null,
          group_name: null,
        } as never;
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    });

    const context = await buildVariableContextForDevice('dev_1', 'env_1');

    expect(context.device).toMatchObject({
      id: 'dev_1',
      name: 'Warehouse-Kiosk-01',
      sn: 'SN-42',
      serial: 'SN-42',
      serial_number: 'SN-42',
      imei: '351234567890123',
      meid: 'MEID-1234',
      android_id: 'android-1',
      assigneduserfirstname: 'Alice',
      assigneduserlastname: 'Owner',
      assigneduseremail: 'owner@example.com',
      assigneduserrole: 'admin',
      assignedusergroup: 'HQ',
    });
    expect(context.user).toMatchObject({
      id: 'usr_1',
      firstname: 'Alice',
      lastname: 'Owner',
      email: 'owner@example.com',
      role: 'admin',
      group: 'HQ',
      name: 'Alice Owner',
    });
    expect(context.group).toMatchObject({
      id: 'grp_1',
      name: 'HQ',
      description: 'HQ devices',
      metadata: { region: 'EMEA' },
    });
    expect(context.environment).toMatchObject({
      id: 'env_1',
      workspace_id: 'ws_1',
      name: 'Production',
      enterprise_name: 'enterprises/123456',
      enterprise_display_name: 'Prod Enterprise',
    });
  });
});
