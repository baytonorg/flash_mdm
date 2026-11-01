import { describe, expect, it } from 'vitest';
import { normalizeAppPolicyForInstallType } from '@/components/apps/amapiApplicationPolicy';

describe('normalizeAppPolicyForInstallType', () => {
  it('creates the required customAppConfig object when CUSTOM is selected', () => {
    expect(normalizeAppPolicyForInstallType({ roles: [] }, 'CUSTOM')).toEqual({
      roles: [],
      customAppConfig: {},
    });
  });

  it('replaces invalid customAppConfig values for CUSTOM installs', () => {
    expect(normalizeAppPolicyForInstallType({ customAppConfig: [] }, 'CUSTOM')).toEqual({
      customAppConfig: {},
    });
  });

  it('preserves a valid customAppConfig object for CUSTOM installs', () => {
    const customAppConfig = { userUninstallSettings: 'USER_UNINSTALL_ALLOWED' };
    expect(normalizeAppPolicyForInstallType({ customAppConfig }, 'CUSTOM')).toEqual({ customAppConfig });
  });

  it('removes customAppConfig when changing away from CUSTOM', () => {
    expect(normalizeAppPolicyForInstallType({
      roles: [],
      customAppConfig: { userUninstallSettings: 'USER_UNINSTALL_ALLOWED' },
    }, 'AVAILABLE')).toEqual({ roles: [] });
  });
});
