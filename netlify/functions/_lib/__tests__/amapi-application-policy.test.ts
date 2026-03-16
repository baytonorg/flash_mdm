import { describe, expect, it } from 'vitest';
import {
  AMAPI_APPLICATION_INSTALL_TYPES,
  isAmapiApplicationInstallType,
  validateAmapiApplicationPolicyFragment,
} from '../amapi-application-policy.js';

describe('amapi-application-policy helper', () => {
  it('includes the full AMAPI install type enum set used for application policies', () => {
    expect(AMAPI_APPLICATION_INSTALL_TYPES).toEqual([
      'INSTALL_TYPE_UNSPECIFIED',
      'PREINSTALLED',
      'FORCE_INSTALLED',
      'BLOCKED',
      'AVAILABLE',
      'REQUIRED_FOR_SETUP',
      'KIOSK',
      'CUSTOM',
    ]);
  });

  it('accepts CUSTOM, KIOSK and REQUIRED_FOR_SETUP install types', () => {
    expect(isAmapiApplicationInstallType('CUSTOM')).toBe(true);
    expect(isAmapiApplicationInstallType('KIOSK')).toBe(true);
    expect(isAmapiApplicationInstallType('REQUIRED_FOR_SETUP')).toBe(true);
  });

  it('rejects duplicate or unspecified roles and invalid signing fingerprints in app_policy', () => {
    const errors = validateAmapiApplicationPolicyFragment({
      roles: [{ roleType: 'KIOSK' }, { roleType: 'KIOSK' }, { roleType: 'ROLE_TYPE_UNSPECIFIED' }],
      signingKeyCerts: [{ signingKeyCertFingerprintSha256: 'abc' }],
    });

    expect(errors.some((e) => e.includes('duplicate roleType'))).toBe(true);
    expect(errors.some((e) => e.includes('ROLE_TYPE_UNSPECIFIED'))).toBe(true);
    expect(errors.some((e) => e.includes('64 hex chars'))).toBe(true);
  });

  it('rejects invalid signingKeyCerts string-array fingerprints (AMAPI accepted shape)', () => {
    const errors = validateAmapiApplicationPolicyFragment({
      signingKeyCerts: ['not-a-sha256'],
    });

    expect(errors.some((e) => e.includes('signingKeyCerts[0]'))).toBe(true);
    expect(errors.some((e) => e.includes('SHA-256'))).toBe(true);
  });

  it('accepts a valid app_policy fragment with roles and signing certs', () => {
    const fp = 'a'.repeat(64);
    const errors = validateAmapiApplicationPolicyFragment({
      roles: [{ roleType: 'KIOSK' }, { roleType: 'COMPANION_APP' }],
      signingKeyCerts: [{ signingKeyCertFingerprintSha256: fp }],
      installConstraint: [{ networkTypeConstraint: 'NETWORK_TYPE_CONSTRAINT_UNSPECIFIED' }],
      installPriority: 42,
    });

    expect(errors).toEqual([]);
  });
});
