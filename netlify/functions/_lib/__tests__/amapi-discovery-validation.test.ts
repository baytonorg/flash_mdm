import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AMAPI_POLICY_DISCOVERY_REVISION,
  AMAPI_POLICY_DISCOVERY_SOURCE,
  isAmapiPolicyDiscoveryPath,
  validateAmapiPolicyAgainstDiscovery,
} from '../amapi-discovery-validation.js';

describe('pinned AMAPI Discovery policy validation', () => {
  it('records the official source and audited revision', () => {
    expect(AMAPI_POLICY_DISCOVERY_SOURCE).toBe(
      'https://androidmanagement.googleapis.com/$discovery/rest?version=v1'
    );
    expect(AMAPI_POLICY_DISCOVERY_REVISION).toBe('20260916');
  });

  it('rejects unknown policy fields, nested fields, and enum values', () => {
    const errors = validateAmapiPolicyAgainstDiscovery({
      unknownPolicyField: true,
      personalUsagePolicies: { personalGoogleAccountsAllowed: 'DISALLOWED' },
      applications: [{
        packageName: 'com.example.app',
        installType: 'NOT_AN_INSTALL_TYPE',
        unknownApplicationField: true,
      }],
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('unknownPolicyField is not defined'),
      expect.stringContaining('personalUsagePolicies.personalGoogleAccountsAllowed is not defined'),
      expect.stringContaining('applications[0].installType="NOT_AN_INSTALL_TYPE" is not a valid AMAPI value'),
      expect.stringContaining('applications[0].unknownApplicationField is not defined'),
    ]));
  });

  it('accepts documented nested fields and leaves protobuf Struct payloads open', () => {
    const errors = validateAmapiPolicyAgainstDiscovery({
      maximumTimeToLock: 30_000,
      personalUsagePolicies: {
        cameraDisabled: true,
        personalPlayStoreMode: 'BLOCKLIST',
      },
      deviceConnectivityManagement: {
        wifiRoamingPolicy: {
          wifiRoamingSettings: [{
            wifiSsid: 'Corporate',
            wifiRoamingMode: 'WIFI_ROAMING_AGGRESSIVE',
          }],
        },
      },
      applications: [{
        packageName: 'com.example.app',
        installType: 'FORCE_INSTALLED',
        managedConfiguration: {
          vendorDefinedBoolean: true,
          vendorDefinedBundle: { nested: ['anything', 42] },
        },
      }],
      openNetworkConfiguration: {
        Type: 'UnencryptedConfiguration',
        NetworkConfigurations: [{ GUID: 'corp', WiFi: { SSID: 'Corporate' } }],
      },
    });

    expect(errors).toEqual([]);
  });

  it('keeps every policy editor path aligned with Discovery or an explicit generation alias', () => {
    const source = readFileSync('src/components/policy/PolicyFormSection.tsx', 'utf8');
    const pathPattern = /(?:getPath\(config,\s*|onChange\()[^\n]*?['"]([A-Za-z][A-Za-z0-9_.]*)['"]/g;
    const paths = [...new Set([...source.matchAll(pathPattern)].map((match) => match[1]))];
    const generationAliases: Record<string, string> = {
      'privateDnsSettings.privateDnsHost': 'deviceConnectivityManagement.privateDnsSettings.privateDnsHost',
      'privateDnsSettings.privateDnsMode': 'deviceConnectivityManagement.privateDnsSettings.privateDnsMode',
    };
    const invalidPaths = paths.filter((path) => !isAmapiPolicyDiscoveryPath(generationAliases[path] ?? path));

    expect(paths.length).toBeGreaterThan(130);
    expect(invalidPaths).toEqual([]);
  });

  it('does not expose the four removed audit paths', () => {
    const source = readFileSync('src/components/policy/PolicyFormSection.tsx', 'utf8');
    expect(source).not.toContain('deviceConnectivityManagement.wifiRoamingPolicy.wifiRoamingMode');
    expect(source).not.toContain('personalUsagePolicies.cameraAccessForPersonalProfile');
    expect(source).not.toContain('personalUsagePolicies.microphoneAccessForPersonalProfile');
    expect(source).not.toContain('personalUsagePolicies.personalGoogleAccountsAllowed');
  });
});
