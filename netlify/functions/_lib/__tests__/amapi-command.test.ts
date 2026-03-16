import { describe, it, expect } from 'vitest';
import { buildAmapiCommandPayload, AmapiCommandValidationError } from '../amapi-command.js';
import { AMAPI_ISSUE_COMMAND_TYPES } from '../device-commands.js';

describe('buildAmapiCommandPayload', () => {
  it('builds START_LOST_MODE with UserFacingMessage wrappers', () => {
    const payload = buildAmapiCommandPayload('START_LOST_MODE', {
      organization: 'Acme IT',
      message: 'Call support',
      phone: '+15555550123',
      address: '1 Main St',
      email: 'it@example.com',
    });

    expect(payload).toEqual({
      type: 'START_LOST_MODE',
      startLostModeParams: {
        lostOrganization: { defaultMessage: 'Acme IT' },
        lostMessage: { defaultMessage: 'Call support' },
        lostPhoneNumber: { defaultMessage: '+15555550123' },
        lostStreetAddress: { defaultMessage: '1 Main St' },
        lostEmailAddress: 'it@example.com',
      },
    });
  });

  it('builds START_LOST_MODE from command modal field names', () => {
    const payload = buildAmapiCommandPayload('START_LOST_MODE', {
      lostMessage: 'Please return this device',
      lostPhoneNumber: '+15551234567',
      lostEmailAddress: 'helpdesk@example.com',
    });

    expect(payload).toEqual({
      type: 'START_LOST_MODE',
      startLostModeParams: {
        lostMessage: { defaultMessage: 'Please return this device' },
        lostPhoneNumber: { defaultMessage: '+15551234567' },
        lostEmailAddress: 'helpdesk@example.com',
      },
    });
  });

  it('supports pre-wrapped UserFacingMessage objects for START_LOST_MODE', () => {
    const payload = buildAmapiCommandPayload('START_LOST_MODE', {
      startLostModeParams: {
        lostMessage: { defaultMessage: 'Managed by IT' },
      },
    });

    expect(payload).toEqual({
      type: 'START_LOST_MODE',
      startLostModeParams: {
        lostMessage: { defaultMessage: 'Managed by IT' },
      },
    });
  });

  it('validates START_LOST_MODE has at least one user-facing field', () => {
    expect(() => buildAmapiCommandPayload('START_LOST_MODE', {}))
      .toThrow('START_LOST_MODE requires at least one of');
  });

  it('builds REQUEST_DEVICE_INFO with default EID', () => {
    const payload = buildAmapiCommandPayload('REQUEST_DEVICE_INFO', {});
    expect(payload).toEqual({
      type: 'REQUEST_DEVICE_INFO',
      requestDeviceInfoParams: { deviceInfo: 'EID' },
    });
  });

  it('accepts DEVICE_INFO_UNSPECIFIED for REQUEST_DEVICE_INFO', () => {
    const payload = buildAmapiCommandPayload('REQUEST_DEVICE_INFO', {
      deviceInfo: 'DEVICE_INFO_UNSPECIFIED',
    });
    expect(payload).toEqual({
      type: 'REQUEST_DEVICE_INFO',
      requestDeviceInfoParams: { deviceInfo: 'DEVICE_INFO_UNSPECIFIED' },
    });
  });

  it('builds STOP_LOST_MODE with explicit empty params object', () => {
    const payload = buildAmapiCommandPayload('STOP_LOST_MODE', {});
    expect(payload).toEqual({
      type: 'STOP_LOST_MODE',
      stopLostModeParams: {},
    });
  });

  it('builds ADD_ESIM using camelCase or snake_case params', () => {
    const payload = buildAmapiCommandPayload('ADD_ESIM', {
      activation_code: 'LPA:1$example.com$abc123',
      activation_state: 'ACTIVATED',
    });

    expect(payload).toEqual({
      type: 'ADD_ESIM',
      addEsimParams: {
        activationCode: 'LPA:1$example.com$abc123',
        activationState: 'ACTIVATED',
      },
    });
  });

  it('builds REMOVE_ESIM', () => {
    const payload = buildAmapiCommandPayload('REMOVE_ESIM', {
      iccId: '8901234567890123456',
    });

    expect(payload).toEqual({
      type: 'REMOVE_ESIM',
      removeEsimParams: {
        iccId: '8901234567890123456',
      },
    });
  });

  it('throws on invalid eSIM params', () => {
    expect(() => buildAmapiCommandPayload('ADD_ESIM', {})).toThrow(AmapiCommandValidationError);
    expect(() => buildAmapiCommandPayload('REMOVE_ESIM', {})).toThrow('REMOVE_ESIM requires params.iccId');
  });

  it('validates RESET_PASSWORD resetPasswordFlags values', () => {
    expect(() => buildAmapiCommandPayload('RESET_PASSWORD', { resetPasswordFlags: 'LOCK_NOW' as unknown as string[] }))
      .toThrow('RESET_PASSWORD params.resetPasswordFlags must be an array');
    expect(() => buildAmapiCommandPayload('RESET_PASSWORD', { resetPasswordFlags: ['INVALID_FLAG'] }))
      .toThrow('Invalid RESET_PASSWORD resetPasswordFlags');
  });

  it('builds WIPE command and filters invalid wipeDataFlags', () => {
    expect(buildAmapiCommandPayload('WIPE', { wipeDataFlags: ['WIPE_RESET_PROTECTION_DATA'] }))
      .toEqual({ type: 'WIPE' });
  });

  it('passes through unknown commands only when allowUnknown is enabled', () => {
    expect(() => buildAmapiCommandPayload('FUTURE_COMMAND', {})).toThrow('Unsupported command type: FUTURE_COMMAND');

    expect(buildAmapiCommandPayload('FUTURE_COMMAND', { wipeDataFlags: ['WIPE_RESET_PROTECTION_DATA'] }, { allowUnknown: true }))
      .toEqual({
        type: 'FUTURE_COMMAND',
        wipeDataFlags: ['WIPE_RESET_PROTECTION_DATA'],
      });
  });

  it('accepts raw nested params for workflow/bulk compatibility', () => {
    const payload = buildAmapiCommandPayload('CLEAR_APP_DATA', {
      clearAppsDataParams: { packageNames: ['com.example.app'] },
    });
    expect(payload).toEqual({
      type: 'CLEAR_APP_DATA',
      clearAppsDataParams: { packageNames: ['com.example.app'] },
    });
  });

  it('has explicit coverage for all AMAPI issueCommand types', () => {
    const covered = new Set<string>([
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
    expect(new Set(AMAPI_ISSUE_COMMAND_TYPES)).toEqual(covered);
  });
});
