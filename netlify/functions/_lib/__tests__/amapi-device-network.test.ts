import { describe, expect, it } from 'vitest';
import { resolveAmapiDeviceImei } from '../amapi-device-network.js';

describe('resolveAmapiDeviceImei', () => {
  it('uses the current top-level IMEI and ignores plural SIM metadata for IMEI', () => {
    expect(resolveAmapiDeviceImei({
      imei: 'current-imei',
      telephonyInfos: [{ phoneNumber: '+441234567890', carrierName: 'Example Mobile' }],
      telephonyInfo: [{ imei: 'legacy-imei' }],
    })).toBe('current-imei');
  });

  it('retains compatibility with the obsolete singular shape', () => {
    expect(resolveAmapiDeviceImei({
      telephonyInfo: [{ imei: 'legacy-imei' }],
    })).toBe('legacy-imei');
  });

  it('does not invent IMEI from current telephonyInfos entries', () => {
    expect(resolveAmapiDeviceImei({
      telephonyInfos: [{ imei: 'not-a-current-telephony-field' }],
    })).toBeNull();
  });
});
