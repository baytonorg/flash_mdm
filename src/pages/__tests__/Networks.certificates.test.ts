import { describe, expect, it } from 'vitest';
import { buildAmapiSyncNotice, buildStructuredWifiOncDoc, validateOncJson } from '@/pages/Networks';

describe('Networks trusted CA policy shape', () => {
  it('builds enterprise Wi-Fi with domain suffixes and selected trusted CA references', () => {
    const document = buildStructuredWifiOncDoc({
      scopeType: 'environment',
      scopeId: 'env_1',
      ssid: 'Corporate',
      name: 'Corporate Wi-Fi',
      hiddenSsid: false,
      autoConnect: true,
      securityMode: 'WPA_EAP',
      passphrase: '',
      eapOuter: 'PEAP',
      eapInner: 'MSCHAPv2',
      eapIdentity: 'user@example.com',
      eapAnonymousIdentity: '',
      eapPassword: 'password',
      eapServerCaRefs: 'flash-ca-cert_1, flash-ca-cert_2',
      eapDomainSuffixMatch: 'example.com, wifi.example.com',
    });

    expect(document).toMatchObject({
      NetworkConfigurations: [{
        WiFi: {
          EAP: {
            Outer: 'PEAP',
            Inner: 'MSCHAPv2',
            DomainSuffixMatch: ['example.com', 'wifi.example.com'],
            ServerCARefs: ['flash-ca-cert_1', 'flash-ca-cert_2'],
          },
        },
      }],
    });
    expect(validateOncJson(JSON.stringify(document))).toMatchObject({ ok: true });
  });

  it('rejects raw EAP-TLS, inline certificates, and missing server domains', () => {
    const base = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [{
        GUID: 'wifi-1',
        Name: 'Corporate',
        Type: 'WiFi',
        WiFi: { SSID: 'Corporate', Security: 'WPA-EAP', EAP: { Outer: 'PEAP', Inner: 'MSCHAPv2' } },
      }],
    };

    expect(validateOncJson(JSON.stringify(base))).toMatchObject({ ok: false, error: expect.stringContaining('DomainSuffixMatch') });
    expect(validateOncJson(JSON.stringify({ ...base, Certificates: [{ GUID: 'inline', Type: 'Client', PKCS12: 'secret' }] })))
      .toMatchObject({ ok: false, error: expect.stringContaining('Inline certificates') });
    expect(validateOncJson(JSON.stringify({
      ...base,
      NetworkConfigurations: [{
        ...base.NetworkConfigurations[0],
        WiFi: { ...base.NetworkConfigurations[0].WiFi, EAP: { Outer: 'EAP-TLS', DomainSuffixMatch: ['example.com'] } },
      }],
    }))).toMatchObject({ ok: false, error: expect.stringContaining('EAP-TLS') });
    expect(validateOncJson(JSON.stringify({
      ...base,
      NetworkConfigurations: [{
        ...base.NetworkConfigurations[0],
        WiFi: {
          ...base.NetworkConfigurations[0].WiFi,
          EAP: {
            Outer: 'PEAP',
            Inner: 'MSCHAPv2',
            DomainSuffixMatch: ['example.com'],
            ServerCARef: 'legacy-ca',
            ServerCARefs: ['current-ca'],
          },
        },
      }],
    }))).toMatchObject({ ok: false, error: expect.stringContaining('mutually exclusive') });
  });

  it('surfaces AMAPI failure detail as an error notice', () => {
    expect(buildAmapiSyncNotice('Updated', {
      attempted: 1,
      synced: 0,
      failed: 1,
      skipped_reason: null,
      failures: [{ policy_id: 'pol_1', error: 'Unknown trusted CA', amapi_status: null }],
    })).toEqual({
      tone: 'error',
      message: 'Updated: AMAPI sync: 0/1 policies synced, 1 failed - Unknown trusted CA',
    });
  });
});
