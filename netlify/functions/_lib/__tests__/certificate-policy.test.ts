import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSupportedWifiCertificateReferences,
  buildOncCertificateGuid,
  collectOncServerCaRefs,
  parseServerCaCertificate,
} from '../certificate-policy.js';
import { TEST_CA_PEM, TEST_NON_CA_PEM } from '../../__tests__/fixtures/test-certificates.js';

describe('certificate policy helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses a CA certificate into AMAPI ONC material', () => {
    const parsed = parseServerCaCertificate(TEST_CA_PEM);
    expect(parsed.fingerprint_sha256).toMatch(/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
    expect(parsed.subject).toContain('Flash Test Root CA');
    expect(parsed.x509_base64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('rejects non-CA certificates', () => {
    expect(() => parseServerCaCertificate(TEST_NON_CA_PEM)).toThrow('must be a CA certificate');
  });

  it('stores only canonical public certificate material when input has trailing data', () => {
    const parsed = parseServerCaCertificate(`${TEST_CA_PEM}\n-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n`);
    expect(parsed.pem).toContain('BEGIN CERTIFICATE');
    expect(parsed.pem).not.toContain('PRIVATE KEY');
    expect(parsed.pem.match(/BEGIN CERTIFICATE/g)).toHaveLength(1);
  });

  it('rejects expired certificates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'));
    expect(() => parseServerCaCertificate(TEST_CA_PEM)).toThrow('expired');
  });

  it('collects stable, unique server CA references', () => {
    expect(collectOncServerCaRefs({
      NetworkConfigurations: [
        { WiFi: { EAP: { ServerCARef: 'ca-b' } } },
        { WiFi: { EAP: { ServerCARefs: ['ca-a', 'ca-b'] } } },
      ],
    })).toEqual(['ca-a', 'ca-b']);
    expect(buildOncCertificateGuid('cert-1')).toBe('flash-ca-cert-1');
  });

  it('rejects unsupported client identity and incomplete enterprise Wi-Fi', () => {
    expect(() => assertSupportedWifiCertificateReferences({
      NetworkConfigurations: [{ WiFi: { EAP: { Outer: 'EAP-TLS', DomainSuffixMatch: ['example.com'] } } }],
    })).toThrow('EAP-TLS');
    expect(() => assertSupportedWifiCertificateReferences({
      NetworkConfigurations: [{ WiFi: { EAP: { Outer: 'PEAP', Inner: 'MSCHAPv2' } } }],
    })).toThrow('DomainSuffixMatch');
    expect(() => assertSupportedWifiCertificateReferences({
      Certificates: [{ GUID: 'inline' }],
      NetworkConfigurations: [],
    })).toThrow('Inline ONC certificates');
    expect(() => assertSupportedWifiCertificateReferences({
      NetworkConfigurations: [{
        WiFi: {
          EAP: {
            Outer: 'PEAP',
            Inner: 'MSCHAPv2',
            DomainSuffixMatch: ['example.com'],
            ServerCARef: 'legacy-ca',
            ServerCARefs: ['current-ca'],
          },
        },
      }],
    })).toThrow('mutually exclusive');
  });
});
