import { describe, expect, it } from 'vitest';
import { classifyAmapiCommandOperation } from '../amapi-command-result.js';

function operation(metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    name: 'enterprises/e1/devices/d1/operations/op1',
    done: true,
    response: { '@type': 'type.googleapis.com/google.android.devicemanagement.v1.IssueCommandResponse' },
    metadata: {
      '@type': 'type.googleapis.com/google.android.devicemanagement.v1.Command',
      ...metadata,
    },
    ...extra,
  };
}

describe('classifyAmapiCommandOperation', () => {
  it.each([
    ['START_LOST_MODE', 'startLostModeStatus', 'SUCCESS', 'SUCCEEDED'],
    ['START_LOST_MODE', 'startLostModeStatus', 'ALREADY_IN_LOST_MODE', 'SUCCEEDED'],
    ['START_LOST_MODE', 'startLostModeStatus', 'RESET_PASSWORD_RECENTLY', 'FAILED'],
    ['START_LOST_MODE', 'startLostModeStatus', 'USER_EXIT_LOST_MODE_RECENTLY', 'FAILED'],
    ['STOP_LOST_MODE', 'stopLostModeStatus', 'SUCCESS', 'SUCCEEDED'],
    ['STOP_LOST_MODE', 'stopLostModeStatus', 'NOT_IN_LOST_MODE', 'SUCCEEDED'],
    ['ADD_ESIM', 'esimStatus', 'SUCCESS', 'SUCCEEDED'],
    ['ADD_ESIM', 'esimStatus', 'IN_PROGRESS', 'RUNNING'],
    ['REMOVE_ESIM', 'esimStatus', 'PENDING_USER_ACTION', 'RUNNING'],
    ['REMOVE_ESIM', 'esimStatus', 'ERROR_ICC_ID_NOT_FOUND', 'FAILED'],
    ['REQUEST_DEVICE_INFO', 'requestDeviceInfoStatus', 'SUCCEEDED', 'SUCCEEDED'],
    ['REQUEST_DEVICE_INFO', 'requestDeviceInfoStatus', 'PENDING_USER_ACTION', 'RUNNING'],
    ['REQUEST_DEVICE_INFO', 'requestDeviceInfoStatus', 'USER_DECLINED', 'FAILED'],
    ['REQUEST_DEVICE_INFO', 'requestDeviceInfoStatus', 'UNSUPPORTED', 'FAILED'],
  ])('classifies %s %s=%s as %s', (type, field, status, expected) => {
    const result = classifyAmapiCommandOperation(operation({
      type,
      [field]: { status },
    }));

    expect(result.status).toBe(expected);
    expect(result.succeeded).toBe(expected === 'SUCCEEDED');
  });

  it('treats any failed clear-app-data result as a command failure', () => {
    const result = classifyAmapiCommandOperation(operation({
      type: 'CLEAR_APP_DATA',
      clearAppsDataStatus: {
        results: {
          'com.example.ok': { clearingResult: 'SUCCESS' },
          'com.example.protected': { clearingResult: 'APP_PROTECTED' },
        },
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      status: 'FAILED',
      error: 'clearAppsDataStatus: com.example.protected=APP_PROTECTED',
      succeeded: false,
    }));
  });

  it('uses command-specific status before Command.errorCode and Operation.error', () => {
    const result = classifyAmapiCommandOperation(operation({
      type: 'START_LOST_MODE',
      startLostModeStatus: { status: 'ALREADY_IN_LOST_MODE' },
      errorCode: 'INVALID_VALUE',
    }, {
      error: { code: 3, message: 'lower-priority operation error' },
    }));

    expect(result).toEqual({
      status: 'SUCCEEDED',
      error: null,
      commandType: 'START_LOST_MODE',
      succeeded: true,
    });
  });

  it('uses Command.errorCode before Operation.error', () => {
    const result = classifyAmapiCommandOperation(operation({
      type: 'REBOOT',
      errorCode: 'MANAGEMENT_MODE',
    }, {
      error: { code: 13, message: 'generic failure' },
    }));

    expect(result.error).toBe('Command.errorCode: MANAGEMENT_MODE');
    expect(result.status).toBe('FAILED');
  });

  it('falls back to Operation.error when there is no command-level result', () => {
    const result = classifyAmapiCommandOperation(operation({ type: 'REBOOT' }, {
      error: { code: 13, message: 'generic failure' },
    }));

    expect(result.error).toBe('Operation.error: code 13 - generic failure');
    expect(result.status).toBe('FAILED');
  });

  it('does not turn an unspecified command-specific status into success from done=true', () => {
    const result = classifyAmapiCommandOperation(operation({
      type: 'START_LOST_MODE',
      startLostModeStatus: { status: 'STATUS_UNSPECIFIED' },
      errorCode: 'COMMAND_ERROR_CODE_UNSPECIFIED',
    }));

    expect(result.status).toBe('UNKNOWN');
    expect(result.succeeded).toBe(false);
  });

  it('requires a response before generic done=true is considered successful', () => {
    const result = classifyAmapiCommandOperation({
      name: 'enterprises/e1/devices/d1/operations/op1',
      done: true,
      metadata: { type: 'REBOOT' },
    });

    expect(result.status).toBe('UNKNOWN');
    expect(result.succeeded).toBe(false);
  });
});
