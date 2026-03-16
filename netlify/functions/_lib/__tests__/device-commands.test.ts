import { describe, expect, it } from 'vitest';
import {
  AMAPI_ISSUE_COMMAND_TYPES,
  BULK_DEVICE_COMMAND_TYPES,
  DEVICE_BULK_COMMAND_ALIAS_MAP,
  DEVICE_COMMAND_TYPES,
  DEVICE_INFO_TYPES,
  ESIM_ACTIVATION_STATES,
  RESET_PASSWORD_FLAGS,
  WIPE_DATA_FLAGS,
  isBulkDeviceCommandType,
  isDeviceCommandType,
  normalizeBulkDeviceCommand,
} from '../device-commands.js';

describe('device command catalog', () => {
  it('matches AMAPI issueCommand types from the discovery schema', () => {
    expect(AMAPI_ISSUE_COMMAND_TYPES).toEqual([
      'LOCK',
      'RESET_PASSWORD',
      'REBOOT',
      'RELINQUISH_OWNERSHIP',
      'CLEAR_APP_DATA',
      'START_LOST_MODE',
      'STOP_LOST_MODE',
      'ADD_ESIM',
      'REMOVE_ESIM',
      'REQUEST_DEVICE_INFO',
      'WIPE',
    ]);
  });

  it('keeps command enums aligned with AMAPI discovery values', () => {
    expect(RESET_PASSWORD_FLAGS).toEqual([
      'RESET_PASSWORD_FLAG_UNSPECIFIED',
      'REQUIRE_ENTRY',
      'DO_NOT_ASK_CREDENTIALS_ON_BOOT',
      'LOCK_NOW',
    ]);
    expect(DEVICE_INFO_TYPES).toEqual([
      'DEVICE_INFO_UNSPECIFIED',
      'EID',
    ]);
    expect(ESIM_ACTIVATION_STATES).toEqual([
      'ACTIVATION_STATE_UNSPECIFIED',
      'ACTIVATED',
      'NOT_ACTIVATED',
    ]);
    expect(WIPE_DATA_FLAGS).toEqual([
      'WIPE_DATA_FLAG_UNSPECIFIED',
      'PRESERVE_RESET_PROTECTION_DATA',
      'WIPE_EXTERNAL_STORAGE',
      'WIPE_ESIMS',
    ]);
  });

  it('normalizes documented bulk aliases and uppercase passthrough', () => {
    for (const [alias, normalized] of Object.entries(DEVICE_BULK_COMMAND_ALIAS_MAP)) {
      expect(normalizeBulkDeviceCommand(alias)).toBe(normalized);
      expect(isBulkDeviceCommandType(normalized)).toBe(true);
    }
    expect(normalizeBulkDeviceCommand('wipe')).toBe('WIPE');
    expect(normalizeBulkDeviceCommand('ADD_ESIM')).toBe('ADD_ESIM');
    expect(isDeviceCommandType('DELETE')).toBe(false);
    expect(isBulkDeviceCommandType('DELETE')).toBe(true);
  });

  it('keeps command sets deduplicated', () => {
    expect(new Set(DEVICE_COMMAND_TYPES).size).toBe(DEVICE_COMMAND_TYPES.length);
    expect(new Set(BULK_DEVICE_COMMAND_TYPES).size).toBe(BULK_DEVICE_COMMAND_TYPES.length);
  });
});
