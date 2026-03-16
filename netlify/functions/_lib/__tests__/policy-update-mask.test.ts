import { describe, it, expect } from 'vitest';
import { buildPolicyUpdateMask } from '../policy-update-mask.js';

describe('buildPolicyUpdateMask', () => {
  it('returns null for empty configs', () => {
    expect(buildPolicyUpdateMask({}, {})).toBeNull();
  });

  it('includes top-level keys from both previous and next configs', () => {
    const previous = {
      applications: [{ packageName: 'com.example.one' }],
      statusReportingSettings: { applicationReportsEnabled: true },
    };
    const next = {
      applications: [{ packageName: 'com.example.two' }],
      passwordRequirements: { passwordMinimumLength: 8 },
    };

    expect(buildPolicyUpdateMask(previous, next))
      .toBe('applications,passwordRequirements,statusReportingSettings');
  });

  it('excludes unchanged top-level keys from the mask', () => {
    const previous = {
      applications: [{ packageName: 'com.example.one' }],
      statusReportingSettings: { applicationReportsEnabled: true },
      openNetworkConfiguration: { Type: 'UnencryptedConfiguration' },
    };
    const next = {
      applications: [{ packageName: 'com.example.one' }],
      statusReportingSettings: { applicationReportsEnabled: true },
      openNetworkConfiguration: { Type: 'UnencryptedConfiguration', NetworkConfigurations: [{ SSID: 'Office' }] },
    };

    // Only openNetworkConfiguration changed — applications and statusReportingSettings are identical
    expect(buildPolicyUpdateMask(previous, next)).toBe('openNetworkConfiguration');
  });

  it('returns null when configs are identical', () => {
    const config = {
      applications: [{ packageName: 'com.example.one' }],
      passwordRequirements: { passwordMinimumLength: 8 },
    };
    expect(buildPolicyUpdateMask(config, JSON.parse(JSON.stringify(config)))).toBeNull();
  });

  it('preserves top-level keys needed for deep nested clearing', () => {
    const previous = {
      kioskCustomization: {
        statusBar: 'NOTIFICATIONS_AND_SYSTEM_INFO_DISABLED',
        systemNavigation: 'NAVIGATION_DISABLED',
      },
    };
    const next = {
      kioskCustomization: {
        statusBar: 'NOTIFICATIONS_AND_SYSTEM_INFO_DISABLED',
      },
    };

    // We cannot encode nested deletion semantics in updateMask alone here.
    // The important behavior is that the top-level parent key remains included.
    expect(buildPolicyUpdateMask(previous, next)).toBe('kioskCustomization');
  });
});

