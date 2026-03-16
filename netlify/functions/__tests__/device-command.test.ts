import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn((err: unknown) => {
    if (!(err instanceof Error)) return null;
    const match = /^AMAPI error \((\d{3})\):/.exec(err.message)?.[1];
    return match ? Number(match) : null;
  }),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../device-command.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);
const VALID_DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/.netlify/functions/device-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedBaseLookups() {
  mockQueryOne
    .mockResolvedValueOnce({
      id: 'dev_1',
      amapi_name: 'enterprises/e1/devices/d1',
      environment_id: 'env_1',
      state: 'ACTIVE',
    } as never)
    .mockResolvedValueOnce({
      workspace_id: 'ws_1',
      enterprise_name: 'enterprises/e1',
    } as never)
    .mockResolvedValueOnce({
      gcp_project_id: 'proj-123',
    } as never);
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockAmapiCall.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1', is_superadmin: false },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
});

describe('device-command AMAPI error passthrough', () => {
  it('normalizes lowercase command_type values', async () => {
    seedBaseLookups();
    mockAmapiCall.mockResolvedValue({ name: 'operations/cmd-123', done: false } as never);

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command_type: 'lock' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/devices/d1:issueCommand',
      'ws_1',
      expect.objectContaining({
        method: 'POST',
        body: { type: 'LOCK' },
      })
    );
  });

  it('rejects malformed device UUIDs before DB lookup', async () => {
    const res = await handler(
      makeRequest({ device_id: 'dev_1', command: 'LOCK' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'device_id must be a valid UUID',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns AMAPI 400 to the client for command validation failures', async () => {
    seedBaseLookups();
    mockAmapiCall.mockRejectedValue(new Error('AMAPI error (400): INVALID_ARGUMENT'));

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command: 'LOCK' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to issue command. Please try again or contact support.',
    });
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      'command'
    );
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('returns AMAPI 503 to the client for upstream AMAPI outages/rate-limits', async () => {
    seedBaseLookups();
    mockAmapiCall.mockRejectedValue(new Error('AMAPI error (503): Service Unavailable'));

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command: 'LOCK' }),
      {} as never
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to issue command. Please try again or contact support.',
    });
  });

  it('records AMAPI operation metadata in audit details for issued commands', async () => {
    seedBaseLookups();
    mockAmapiCall.mockResolvedValue({ name: 'operations/cmd-123', done: false } as never);

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command: 'REBOOT' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'device.command.reboot',
      details: expect.objectContaining({
        command: 'REBOOT',
        amapi_result: { name: 'operations/cmd-123', done: false },
      }),
    }));
  });
});

describe('device-command state commands', () => {
  it('PATCHes AMAPI and updates local state for DISABLE', async () => {
    seedBaseLookups();
    mockAmapiCall.mockResolvedValue({ name: 'operations/op1', done: false } as never);
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command: 'DISABLE' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      'command'
    );
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/devices/d1?updateMask=state',
      'ws_1',
      expect.objectContaining({
        method: 'PATCH',
        body: { state: 'DISABLED' },
        projectId: 'proj-123',
        enterpriseName: 'enterprises/e1',
      })
    );
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE devices SET state = $1, updated_at = now() WHERE id = $2',
      ['DISABLED', 'dev_1']
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'device.command.disable',
        device_id: 'dev_1',
        details: expect.objectContaining({
          command: 'DISABLE',
          target_state: 'DISABLED',
          amapi_result: { name: 'operations/op1', done: false },
        }),
      })
    );
    await expect(res.json()).resolves.toEqual({
      result: { name: 'operations/op1', done: false },
      message: 'Device disabled successfully',
    });
  });

  it('returns AMAPI status and skips DB update when DISABLE fails upstream', async () => {
    seedBaseLookups();
    mockAmapiCall.mockRejectedValue(new Error('AMAPI error (503): Service Unavailable'));

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command: 'DISABLE' }),
      {} as never
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to disable device. Please try again.',
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('requires destructive device command permission for WIPE', async () => {
    seedBaseLookups();
    mockAmapiCall.mockResolvedValue({ name: 'operations/wipe-1', done: false } as never);

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command: 'WIPE' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      'command_destructive'
    );
  });
});

describe('device-command command coverage', () => {
  it.each([
    {
      command: 'LOCK',
      params: undefined,
      expectedBody: { type: 'LOCK' },
      expectedPermission: 'command',
    },
    {
      command: 'RESET_PASSWORD',
      params: { newPassword: '1234', resetPasswordFlags: ['LOCK_NOW'] },
      expectedBody: {
        type: 'RESET_PASSWORD',
        newPassword: '1234',
        resetPasswordFlags: ['LOCK_NOW'],
      },
      expectedPermission: 'command',
    },
    {
      command: 'REBOOT',
      params: undefined,
      expectedBody: { type: 'REBOOT' },
      expectedPermission: 'command',
    },
    {
      command: 'RELINQUISH_OWNERSHIP',
      params: undefined,
      expectedBody: { type: 'RELINQUISH_OWNERSHIP' },
      expectedPermission: 'command_destructive',
    },
    {
      command: 'CLEAR_APP_DATA',
      params: { packageName: 'com.example.app' },
      expectedBody: {
        type: 'CLEAR_APP_DATA',
        clearAppsDataParams: { packageNames: ['com.example.app'] },
      },
      expectedPermission: 'command',
    },
    {
      command: 'START_LOST_MODE',
      params: { lostMessage: 'Please contact IT' },
      expectedBody: {
        type: 'START_LOST_MODE',
        startLostModeParams: {
          lostMessage: { defaultMessage: 'Please contact IT' },
        },
      },
      expectedPermission: 'command',
    },
    {
      command: 'STOP_LOST_MODE',
      params: undefined,
      expectedBody: {
        type: 'STOP_LOST_MODE',
        stopLostModeParams: {},
      },
      expectedPermission: 'command',
    },
    {
      command: 'ADD_ESIM',
      params: { activationCode: 'LPA:1$example.com$abc123' },
      expectedBody: {
        type: 'ADD_ESIM',
        addEsimParams: {
          activationCode: 'LPA:1$example.com$abc123',
          activationState: 'ACTIVATION_STATE_UNSPECIFIED',
        },
      },
      expectedPermission: 'command',
    },
    {
      command: 'REMOVE_ESIM',
      params: { iccId: '8901234567890123456' },
      expectedBody: {
        type: 'REMOVE_ESIM',
        removeEsimParams: { iccId: '8901234567890123456' },
      },
      expectedPermission: 'command',
    },
    {
      command: 'REQUEST_DEVICE_INFO',
      params: undefined,
      expectedBody: {
        type: 'REQUEST_DEVICE_INFO',
        requestDeviceInfoParams: { deviceInfo: 'EID' },
      },
      expectedPermission: 'command',
    },
    {
      command: 'WIPE',
      params: { wipeReason: 'Retired', wipeDataFlags: ['WIPE_ESIMS'] },
      expectedBody: {
        type: 'WIPE',
        wipeParams: {
          wipeReason: { defaultMessage: 'Retired' },
          wipeDataFlags: ['WIPE_ESIMS'],
        },
      },
      expectedPermission: 'command_destructive',
    },
  ])('issues $command with expected payload', async ({ command, params, expectedBody, expectedPermission }) => {
    seedBaseLookups();
    mockAmapiCall.mockResolvedValue({ name: 'operations/op1', done: false } as never);

    const res = await handler(
      makeRequest({ device_id: VALID_DEVICE_ID, command, ...(params ? { params } : {}) }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      expectedPermission
    );
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/devices/d1:issueCommand',
      'ws_1',
      expect.objectContaining({
        method: 'POST',
        body: expectedBody,
        projectId: 'proj-123',
        enterpriseName: 'enterprises/e1',
      })
    );
  });
});
