import { describe, expect, it } from 'vitest';

import { preparePolicyBaseForDerivativeGeneration } from '../policy-merge.js';
import { validateAmapiPolicyAgainstDiscovery } from '../amapi-discovery-validation.js';

describe('preparePolicyBaseForDerivativeGeneration', () => {
  it('preserves every documented connectivity sibling while removing derived APN state', () => {
    const config = {
      applications: [{ packageName: 'com.example.app' }],
      openNetworkConfiguration: { Type: 'UnencryptedConfiguration' },
      cameraDisabled: true,
      deviceConnectivityManagement: {
        usbDataAccess: 'DISALLOW_USB_DATA_TRANSFER',
        configureWifi: 'DISALLOW_CONFIGURING_WIFI',
        wifiDirectSettings: 'DISALLOW_WIFI_DIRECT',
        tetheringSettings: 'DISALLOW_ALL_TETHERING',
        wifiSsidPolicy: {
          wifiSsidPolicyType: 'WIFI_SSID_ALLOWLIST',
          wifiSsids: [{ wifiSsid: 'Corp' }],
        },
        wifiRoamingPolicy: { wifiRoamingSettings: [] },
        bluetoothSharing: 'BLUETOOTH_SHARING_DISALLOWED',
        preferentialNetworkServiceSettings: {
          defaultPreferentialNetworkId: 'NO_PREFERENTIAL_NETWORK',
          preferentialNetworkServiceConfigs: [],
        },
        privateDnsSettings: { privateDnsMode: 'PRIVATE_DNS_AUTOMATIC' },
        apnPolicy: {
          overrideApns: 'OVERRIDE_APNS_ENABLED',
          apnSettings: [{ displayName: 'Stale APN', apn: 'stale.example' }],
        },
      },
    };

    const prepared = preparePolicyBaseForDerivativeGeneration(config);

    expect(prepared).toEqual({
      cameraDisabled: true,
      deviceConnectivityManagement: {
        usbDataAccess: 'DISALLOW_USB_DATA_TRANSFER',
        configureWifi: 'DISALLOW_CONFIGURING_WIFI',
        wifiDirectSettings: 'DISALLOW_WIFI_DIRECT',
        tetheringSettings: 'DISALLOW_ALL_TETHERING',
        wifiSsidPolicy: {
          wifiSsidPolicyType: 'WIFI_SSID_ALLOWLIST',
          wifiSsids: [{ wifiSsid: 'Corp' }],
        },
        wifiRoamingPolicy: { wifiRoamingSettings: [] },
        bluetoothSharing: 'BLUETOOTH_SHARING_DISALLOWED',
        preferentialNetworkServiceSettings: {
          defaultPreferentialNetworkId: 'NO_PREFERENTIAL_NETWORK',
          preferentialNetworkServiceConfigs: [],
        },
        privateDnsSettings: { privateDnsMode: 'PRIVATE_DNS_AUTOMATIC' },
      },
    });
    expect(config.deviceConnectivityManagement).toHaveProperty('apnPolicy');
    expect(validateAmapiPolicyAgainstDiscovery(prepared)).toEqual([]);
  });

  it('removes deviceConnectivityManagement when it contained only derived APN state', () => {
    expect(preparePolicyBaseForDerivativeGeneration({
      deviceConnectivityManagement: {
        apnPolicy: { apnSettings: [] },
      },
    })).toEqual({});
  });

  it.each([null, 'invalid', [], true, 42])(
    'rejects malformed deviceConnectivityManagement value %j',
    (deviceConnectivityManagement) => {
      expect(() => preparePolicyBaseForDerivativeGeneration({
        deviceConnectivityManagement,
      })).toThrow('deviceConnectivityManagement must be a JSON object');
    }
  );
});
