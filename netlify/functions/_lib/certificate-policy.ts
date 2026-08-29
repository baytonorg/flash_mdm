import { X509Certificate } from 'node:crypto';

export type ParsedServerCaCertificate = {
  pem: string;
  fingerprint_sha256: string;
  not_after: string;
  subject: string;
  issuer_name: string;
  x509_base64: string;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

export function normalizeCertificatePem(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) return `${trimmed}\n`;

  const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
  if (!decoded.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Expected a PEM-encoded X.509 certificate');
  }
  return `${decoded}\n`;
}

export function parseServerCaCertificate(input: string): ParsedServerCaCertificate {
  const inputPem = normalizeCertificatePem(input);
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(inputPem);
  } catch {
    throw new Error('Certificate data is not a valid X.509 certificate');
  }

  if (!certificate.ca) {
    throw new Error('Certificate must be a CA certificate suitable for Wi-Fi server trust');
  }

  const now = Date.now();
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)) {
    throw new Error('Certificate validity period is invalid');
  }
  if (validFrom > now) throw new Error('Certificate is not yet valid');
  if (validTo <= now) throw new Error('Certificate has expired');

  const base64 = certificate.raw.toString('base64');
  const canonicalPem = `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g)?.join('\n') ?? base64}\n-----END CERTIFICATE-----\n`;

  return {
    pem: canonicalPem,
    fingerprint_sha256: certificate.fingerprint256,
    not_after: new Date(certificate.validTo).toISOString(),
    subject: certificate.subject,
    issuer_name: certificate.issuer,
    x509_base64: certificate.raw.toString('base64'),
  };
}

export function buildOncCertificateGuid(certificateId: string): string {
  return `flash-ca-${certificateId}`;
}

export function collectOncServerCaRefs(openNetworkConfiguration: unknown): string[] {
  if (!openNetworkConfiguration || typeof openNetworkConfiguration !== 'object' || Array.isArray(openNetworkConfiguration)) {
    return [];
  }

  const document = openNetworkConfiguration as JsonObject;
  const refs = new Set<string>();
  const networks = Array.isArray(document.NetworkConfigurations)
    ? document.NetworkConfigurations
    : [];

  for (const network of networks) {
    const eap = asObject(asObject(asObject(network)?.WiFi)?.EAP);
    if (!eap) continue;
    if (eap.ServerCARef && eap.ServerCARefs) {
      throw new Error('ServerCARef and ServerCARefs are mutually exclusive; use ServerCARefs');
    }
    if (typeof eap.ServerCARef === 'string' && eap.ServerCARef.trim()) refs.add(eap.ServerCARef.trim());
    if (Array.isArray(eap.ServerCARefs)) {
      for (const ref of eap.ServerCARefs) {
        if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
      }
    }
  }

  return [...refs].sort();
}

export function assertSupportedWifiCertificateReferences(openNetworkConfiguration: unknown): void {
  if (!openNetworkConfiguration || typeof openNetworkConfiguration !== 'object' || Array.isArray(openNetworkConfiguration)) return;
  const document = openNetworkConfiguration as Record<string, unknown>;
  const certificates = Array.isArray(document.Certificates) ? document.Certificates : [];
  if (certificates.length > 0) {
    throw new Error('Inline ONC certificates are not supported; upload a trusted CA in Networks and select it by reference');
  }

  const networks = Array.isArray(document.NetworkConfigurations) ? document.NetworkConfigurations : [];
  for (const network of networks) {
    const eap = asObject(asObject(asObject(network)?.WiFi)?.EAP);
    if (!eap) continue;
    if (eap.ServerCARef && eap.ServerCARefs) {
      throw new Error('ServerCARef and ServerCARefs are mutually exclusive; use ServerCARefs');
    }
    if (eap.Outer === 'EAP-TLS' || eap.ClientCertRef || eap.ClientCertKeyPairAlias || eap.ClientCertType) {
      throw new Error('Client identity certificates and EAP-TLS are not supported');
    }
    if (eap.Inner && !['MSCHAPv2', 'PAP'].includes(eap.Inner)) {
      throw new Error('AMAPI supports only MSCHAPv2 or PAP as the EAP inner method');
    }
    const domains = Array.isArray(eap.DomainSuffixMatch)
      ? eap.DomainSuffixMatch.filter((value: unknown) => typeof value === 'string' && value.trim())
      : [];
    if (domains.length === 0) {
      throw new Error('Enterprise Wi-Fi requires at least one DomainSuffixMatch value');
    }
  }
}
