import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  query: vi.fn(),
}));
vi.mock('../blobs.js', () => ({
  getBlob: vi.fn(),
}));

import { query } from '../db.js';
import { getBlob } from '../blobs.js';
import { validateAmapiPolicyAgainstDiscovery } from '../amapi-discovery-validation.js';
import { buildGeneratedPolicyPayload, computePolicyGenerationHash, detectDeviceScopedVariables } from '../policy-generation.js';
import { TEST_CA_PEM } from '../../__tests__/fixtures/test-certificates.js';

const mockQuery = vi.mocked(query);
const mockGetBlob = vi.mocked(getBlob);

describe('policy-generation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetBlob.mockReset();
  });

  it('detects namespaced variables in braced placeholder style only', () => {
    expect(
      detectDeviceScopedVariables({
        a: 'Hello ${device.name}',
        b: 'Owner ${USER.EMAIL}',
        c: '$legacy_style_is_ignored',
        d: 'legacy_style_is_ignored$',
        e: 'Env: ${environment.name}',
      })
    ).toEqual(['device.name', 'environment.name', 'user.email']);
  });

  it('computes a deterministic generation hash and ignores self-field recursion', () => {
    const payload = { cameraDisabled: true, nested: { a: 1 } };
    const metadata = {
      model: 'layered_overrides' as const,
      assignments_considered: [{ scope_type: 'environment' as const, scope_id: 'env_1' }],
      resolved_target: { scope_type: 'environment' as const, scope_id: 'env_1' },
      ambiguous_assignment_targets: false,
      ambiguous_reason: null,
      device_scoped_variables: [],
      requires_per_device_derivative: false,
      device_variable_interpolation_supported: false,
      group_overrides_applied: [],
      device_overrides_applied: [],
      locked_sections: [],
    };

    const first = computePolicyGenerationHash(payload, metadata);
    const withSelf = { ...metadata, generation_hash: first };
    const second = computePolicyGenerationHash(payload, withSelf);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it('flags generated payloads that require per-device derivation', async () => {
    // assignments, env apps, legacy app_deployments fallback, env networks, env-lock check
    mockQuery
      .mockResolvedValueOnce([{ scope_type: 'environment', scope_id: 'env_1' }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: { kioskCustomLauncherEnabled: true, supportMessage: 'Assigned to ${user.firstname} on ${device.name}' },
    });

    expect(result.metadata.device_scoped_variables).toEqual(['device.name', 'user.firstname']);
    expect(result.metadata.requires_per_device_derivative).toBe(true);
    expect(result.metadata.device_variable_interpolation_supported).toBe(false);
    expect(result.metadata.generation_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('includes legacy group and device app deployments when generating a device derivative', async () => {
    mockQuery
      .mockResolvedValueOnce([] as never) // policy_assignments
      .mockResolvedValueOnce([{ id: 'dev_1', group_id: 'grp_1' }] as never) // assertTargetInEnvironment(device)
      .mockResolvedValueOnce([] as never) // env apps
      .mockResolvedValueOnce([{ id: 'dev_1', group_id: 'grp_1' }] as never) // getDeviceGroupId (new group app configs)
      .mockResolvedValueOnce([] as never) // group app configs
      .mockResolvedValueOnce([] as never) // device app configs
      .mockResolvedValueOnce([] as never) // legacy env app_deployments
      .mockResolvedValueOnce([{ id: 'dev_1', group_id: 'grp_1' }] as never) // getDeviceGroupId (legacy group app_deployments)
      .mockResolvedValueOnce([
        {
          id: 'legacy_group_1',
          package_name: 'com.example.group.legacy',
          install_type: 'FORCE_INSTALLED',
          managed_config: null,
          auto_update_mode: 'AUTO_UPDATE_DEFAULT',
        },
      ] as never) // legacy group app_deployments
      .mockResolvedValueOnce([
        {
          id: 'legacy_device_1',
          package_name: 'com.example.device.legacy',
          install_type: 'FORCE_INSTALLED',
          managed_config: { source: 'device' },
          auto_update_mode: 'AUTO_UPDATE_HIGH_PRIORITY',
        },
      ] as never) // legacy device app_deployments
      .mockResolvedValueOnce([] as never) // env networks
      .mockResolvedValueOnce([{ id: 'dev_1', group_id: 'grp_1' }] as never) // getDeviceGroupId (group networks)
      .mockResolvedValueOnce([] as never) // group networks
      .mockResolvedValueOnce([] as never) // device networks
      .mockResolvedValueOnce([] as never) // env lock rows
      .mockResolvedValueOnce([{ id: 'dev_1', group_id: 'grp_1' }] as never) // getDeviceGroupId (group overrides)
      .mockResolvedValueOnce([] as never) // group override rows
      .mockResolvedValueOnce([] as never); // device override row

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {},
      target: { mode: 'scope', scope_type: 'device', scope_id: 'dev_1' },
    });

    expect(result.payload).toMatchObject({
      applications: expect.arrayContaining([
        expect.objectContaining({ packageName: 'com.example.group.legacy' }),
        expect.objectContaining({
          packageName: 'com.example.device.legacy',
          autoUpdateMode: 'AUTO_UPDATE_HIGH_PRIORITY',
          managedConfiguration: { source: 'device' },
        }),
      ]),
    });
  });

  it('merges app_scope_config app_policy fields into generated AMAPI applications entries', async () => {
    mockQuery
      .mockResolvedValueOnce([] as never) // policy_assignments
      .mockResolvedValueOnce([
        {
          id: 'app_cfg_1',
          package_name: 'com.example.rich',
          install_type: 'FORCE_INSTALLED',
          managed_config: { mode: 'prod' },
          auto_update_mode: 'AUTO_UPDATE_HIGH_PRIORITY',
          app_policy: {
            defaultPermissionPolicy: 'DENY',
            delegatedScopes: ['MANAGED_CONFIGURATIONS'],
            permissionGrants: [{ permission: 'android.permission.CAMERA', policy: 'GRANT' }],
          },
        },
      ] as never) // env apps
      .mockResolvedValueOnce([] as never) // legacy env app_deployments
      .mockResolvedValueOnce([] as never) // env networks
      .mockResolvedValueOnce([] as never); // env lock rows

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {},
    });

    expect(result.payload).toMatchObject({
      applications: [
        expect.objectContaining({
          packageName: 'com.example.rich',
          installType: 'FORCE_INSTALLED',
          autoUpdateMode: 'AUTO_UPDATE_HIGH_PRIORITY',
          defaultPermissionPolicy: 'DENY',
          delegatedScopes: ['MANAGED_CONFIGURATIONS'],
          permissionGrants: [{ permission: 'android.permission.CAMERA', policy: 'GRANT' }],
          managedConfiguration: { mode: 'prod' },
        }),
      ],
    });
  });

  it('strips Play-managed app policy fields for CUSTOM installType entries', async () => {
    mockQuery
      .mockResolvedValueOnce([] as never) // policy_assignments
      .mockResolvedValueOnce([
        {
          id: 'app_cfg_custom_1',
          package_name: 'com.example.custom',
          install_type: 'CUSTOM',
          managed_config: { some: 'value' },
          auto_update_mode: 'AUTO_UPDATE_HIGH_PRIORITY',
          app_policy: {
            installPriority: 5,
            minimumVersionCode: 123,
            installConstraint: [{ chargingConstraint: 'INSTALL_ONLY_WHEN_CHARGING' }],
            accessibleTrackIds: ['beta'],
            customAppConfig: { foo: 'bar' },
          },
        },
      ] as never) // env apps
      .mockResolvedValueOnce([] as never) // legacy env app_deployments
      .mockResolvedValueOnce([] as never) // env networks
      .mockResolvedValueOnce([] as never); // env lock rows

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {},
    });

    const app = (result.payload.applications as Array<Record<string, unknown>>)[0];
    expect(app).toMatchObject({
      packageName: 'com.example.custom',
      installType: 'CUSTOM',
      customAppConfig: { foo: 'bar' },
      managedConfiguration: { some: 'value' },
    });
    expect(app).not.toHaveProperty('autoUpdateMode');
    expect(app).not.toHaveProperty('installPriority');
    expect(app).not.toHaveProperty('minimumVersionCode');
    expect(app).not.toHaveProperty('installConstraint');
    expect(app).not.toHaveProperty('accessibleTrackIds');
  });

  it('migrates legacy top-level privateDnsSettings into deviceConnectivityManagement for AMAPI payloads', async () => {
    // assignments, env apps, legacy app fallback, env networks, env lock check
    mockQuery
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {
        privateDnsSettings: {
          privateDnsMode: 'PRIVATE_DNS_AUTOMATIC',
        },
        cameraDisabled: true,
      },
    });

    expect(result.payload).not.toHaveProperty('privateDnsSettings');
    expect(result.payload).toMatchObject({
      cameraDisabled: true,
      deviceConnectivityManagement: {
        privateDnsSettings: {
          privateDnsMode: 'PRIVATE_DNS_AUTOMATIC',
        },
      },
    });
  });

  it('removes policy fields that were never part of the AMAPI schema', async () => {
    mockQuery
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {
        deviceConnectivityManagement: {
          wifiRoamingPolicy: {
            wifiRoamingMode: 'WIFI_ROAMING_AGGRESSIVE',
            wifiRoamingSettings: [{
              wifiSsid: 'Corporate',
              wifiRoamingMode: 'WIFI_ROAMING_DEFAULT',
            }],
          },
        },
        personalUsagePolicies: {
          cameraAccessForPersonalProfile: 'CAMERA_ACCESS_DISABLED',
          microphoneAccessForPersonalProfile: 'MICROPHONE_ACCESS_DISABLED',
          personalGoogleAccountsAllowed: 'PERSONAL_GOOGLE_ACCOUNTS_DISALLOWED',
          cameraDisabled: true,
        },
      },
    });

    expect(result.payload).toMatchObject({
      deviceConnectivityManagement: {
        wifiRoamingPolicy: {
          wifiRoamingSettings: [{
            wifiSsid: 'Corporate',
            wifiRoamingMode: 'WIFI_ROAMING_DEFAULT',
          }],
        },
      },
      personalUsagePolicies: { cameraDisabled: true },
    });
    expect(result.payload).not.toHaveProperty('deviceConnectivityManagement.wifiRoamingPolicy.wifiRoamingMode');
    expect(result.payload).not.toHaveProperty('personalUsagePolicies.cameraAccessForPersonalProfile');
    expect(result.payload).not.toHaveProperty('personalUsagePolicies.microphoneAccessForPersonalProfile');
    expect(result.payload).not.toHaveProperty('personalUsagePolicies.personalGoogleAccountsAllowed');
    expect(validateAmapiPolicyAgainstDiscovery(result.payload)).toEqual([]);
  });

  it('embeds only referenced trusted CAs in the generated ONC policy', async () => {
    mockQuery
      .mockResolvedValueOnce([{ scope_type: 'environment', scope_id: 'env_1' }] as never)
      .mockResolvedValueOnce([] as never) // environment app configs
      .mockResolvedValueOnce([] as never) // legacy environment app deployments
      .mockResolvedValueOnce([{
        id: 'network_1',
        onc_profile: {
          Type: 'UnencryptedConfiguration',
          NetworkConfigurations: [{
            GUID: 'corp-wifi',
            Name: 'Corporate Wi-Fi',
            Type: 'WiFi',
            WiFi: {
              SSID: 'Corporate',
              Security: 'WPA-EAP',
              EAP: {
                Outer: 'PEAP',
                Inner: 'MSCHAPv2',
                DomainSuffixMatch: ['example.com'],
                ServerCARefs: ['flash-ca-cert_1'],
              },
            },
          }],
        },
      }] as never)
      .mockResolvedValueOnce([] as never) // environment lock rows
      .mockResolvedValueOnce([{ id: 'cert_1', blob_key: 'env_1/cert_1.pem' }] as never);
    mockGetBlob.mockResolvedValueOnce(TEST_CA_PEM);

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {},
    });

    expect(result.payload.openNetworkConfiguration).toMatchObject({
      NetworkConfigurations: [{
        WiFi: { EAP: { ServerCARefs: ['flash-ca-cert_1'] } },
      }],
      Certificates: [{
        GUID: 'flash-ca-cert_1',
        Type: 'Server',
        X509: expect.stringMatching(/^[A-Za-z0-9+/=]+$/),
      }],
    });
    expect(mockGetBlob).toHaveBeenCalledWith('certificates', 'env_1/cert_1.pem');
  });

  it('enriches the effective ONC document after a group override is applied', async () => {
    const overriddenOnc = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [{
        GUID: 'override-wifi',
        Name: 'Override Wi-Fi',
        Type: 'WiFi',
        WiFi: {
          SSID: 'Override',
          Security: 'WPA-EAP',
          EAP: {
            Outer: 'PEAP',
            DomainSuffixMatch: ['example.com'],
            ServerCARefs: ['flash-ca-cert_1'],
          },
        },
      }],
    };
    mockQuery.mockImplementation((sql) => {
      const statement = String(sql);
      if (statement.includes('FROM policy_assignments')) return Promise.resolve([] as never);
      if (statement.includes('SELECT id FROM groups')) return Promise.resolve([{ id: 'grp_1' }] as never);
      if (statement.includes('FROM app_scope_configs') || statement.includes('FROM app_deployments')) return Promise.resolve([] as never);
      if (statement.includes('FROM network_deployments')) return Promise.resolve([] as never);
      if (statement.includes('FROM group_closures gc\n     JOIN network_deployments')) return Promise.resolve([] as never);
      if (statement.includes('FROM group_closures gc\n     JOIN groups')) {
        return Promise.resolve([{
          ancestor_id: 'grp_1',
          group_name: 'Override group',
          depth: 0,
          override_config: { openNetworkConfiguration: overriddenOnc },
          pa_locked: false,
          pa_locked_sections: null,
        }] as never);
      }
      if (statement.includes('FROM certificates')) {
        return Promise.resolve([{ id: 'cert_1', blob_key: 'env_1/cert_1.pem' }] as never);
      }
      return Promise.resolve([] as never);
    });
    mockGetBlob.mockResolvedValueOnce(TEST_CA_PEM);

    const result = await buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {},
      target: { mode: 'scope', scope_type: 'group', scope_id: 'grp_1' },
    });

    expect(result.payload.openNetworkConfiguration).toMatchObject({
      NetworkConfigurations: [{ GUID: 'override-wifi' }],
      Certificates: [{ GUID: 'flash-ca-cert_1', Type: 'Server' }],
    });
  });

  it('rejects a Wi-Fi profile that references an unknown trusted CA', async () => {
    mockQuery
      .mockResolvedValueOnce([] as never) // policy assignments
      .mockResolvedValueOnce([] as never) // environment app configs
      .mockResolvedValueOnce([] as never) // legacy environment app deployments
      .mockResolvedValueOnce([{
        id: 'network_1',
        onc_profile: {
          Type: 'UnencryptedConfiguration',
          NetworkConfigurations: [{
            GUID: 'corp-wifi',
            Name: 'Corporate Wi-Fi',
            Type: 'WiFi',
            WiFi: {
              SSID: 'Corporate',
              Security: 'WPA-EAP',
              EAP: {
                Outer: 'PEAP',
                Inner: 'MSCHAPv2',
                DomainSuffixMatch: ['example.com'],
                ServerCARefs: ['flash-ca-deleted_cert'],
              },
            },
          }],
        },
      }] as never)
      .mockResolvedValueOnce([] as never) // environment lock rows
      .mockResolvedValueOnce([] as never); // active trusted CAs

    await expect(buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {},
    })).rejects.toThrow('Wi-Fi profile references unknown trusted CA: flash-ca-deleted_cert');
    expect(mockGetBlob).not.toHaveBeenCalled();
  });

  it('rejects a referenced trusted CA whose blob is missing', async () => {
    mockQuery
      .mockResolvedValueOnce([] as never) // policy assignments
      .mockResolvedValueOnce([] as never) // environment app configs
      .mockResolvedValueOnce([] as never) // legacy environment app deployments
      .mockResolvedValueOnce([{
        id: 'network_1',
        onc_profile: {
          Type: 'UnencryptedConfiguration',
          NetworkConfigurations: [{
            GUID: 'corp-wifi',
            Name: 'Corporate Wi-Fi',
            Type: 'WiFi',
            WiFi: {
              SSID: 'Corporate',
              Security: 'WPA-EAP',
              EAP: {
                Outer: 'PEAP',
                Inner: 'MSCHAPv2',
                DomainSuffixMatch: ['example.com'],
                ServerCARefs: ['flash-ca-cert_1'],
              },
            },
          }],
        },
      }] as never)
      .mockResolvedValueOnce([] as never) // environment lock rows
      .mockResolvedValueOnce([{ id: 'cert_1', blob_key: 'env_1/cert_1.pem' }] as never);
    mockGetBlob.mockResolvedValueOnce(null);

    await expect(buildGeneratedPolicyPayload({
      policyId: 'pol_1',
      environmentId: 'env_1',
      baseConfig: {},
    })).rejects.toThrow('Trusted CA blob is missing: flash-ca-cert_1');
  });
});
