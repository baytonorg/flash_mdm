import * as dns from 'node:dns/promises';
import { isIP } from 'node:net';

export function validateWebhookUrlForOutbound(urlValue: unknown): { ok: true; url: URL } | { ok: false; error: string } {
  if (typeof urlValue !== 'string' || !urlValue.trim()) {
    return { ok: false, error: 'Invalid webhook URL' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    return { ok: false, error: 'Invalid webhook URL' };
  }

  if (parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'Webhook URL must use HTTPS' };
  }

  const hostname = parsedUrl.hostname.toLowerCase().replace(/\.$/, '');
  const normalizedHost = hostname.replace(/^\[(.*)\]$/, '$1');

  const blockedPatterns = [
    /^localhost$/,
    /\.localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^(fc|fd)[0-9a-f:]*$/i,
    /^fe80:[0-9a-f:]*$/i,
    /^metadata\.google\.internal$/,
    /^internal$/,
    /\.internal$/,
  ];

  if (blockedPatterns.some((pattern) => pattern.test(normalizedHost))) {
    return { ok: false, error: 'Webhook URL points to a blocked address' };
  }

  return { ok: true, url: parsedUrl };
}

type WebhookValidationResult = { ok: true; url: URL } | { ok: false; error: string };
type DnsLookupRecord = { address: string; family: number };
type WebhookDnsResolver = (hostname: string) => Promise<DnsLookupRecord[]>;

function parseIPv4(value: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const octets = value.split('.').map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

function ipv4FromMappedIpv6(value: string): string | null {
  const normalized = value.toLowerCase();
  if (!normalized.startsWith('::ffff:')) return null;
  const suffix = normalized.slice('::ffff:'.length);

  const dotted = parseIPv4(suffix);
  if (dotted) return suffix;

  const parts = suffix.split(':');
  if (parts.length !== 2 || !parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return null;
  const first = Number.parseInt(parts[0], 16);
  const second = Number.parseInt(parts[1], 16);
  return [
    (first >> 8) & 0xff,
    first & 0xff,
    (second >> 8) & 0xff,
    second & 0xff,
  ].join('.');
}

function isBlockedIpv4(ip: string): boolean {
  const octets = parseIPv4(ip);
  if (!octets) return true;
  const [a, b, c, d] = octets;

  const asInt = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
  const inRange = (start: number, end: number) => asInt >= start && asInt <= end;
  const ipToInt = (x: number, y: number, z: number, w: number) =>
    (((x << 24) >>> 0) + (y << 16) + (z << 8) + w) >>> 0;

  return (
    a === 0 || // includes 0.0.0.0/8 and unspecified/bad routes
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local + common metadata endpoint range
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 || // multicast/reserved
    inRange(ipToInt(100, 100, 100, 200), ipToInt(100, 100, 100, 200)) || // Alibaba metadata
    inRange(ipToInt(192, 0, 0, 192), ipToInt(192, 0, 0, 192)) // OCI metadata
  );
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local incl AWS IMDS IPv6
  if (/^fe[89ab][0-9a-f:]*$/i.test(normalized)) return true; // fe80::/10 link-local
  if (normalized.startsWith('ff')) return true; // multicast
  return false;
}

export function isBlockedResolvedIp(ip: string): boolean {
  const mappedIpv4 = ipv4FromMappedIpv6(ip);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4);

  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

export const resolveWebhookHostnameForOutbound: WebhookDnsResolver = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((record) => ({ address: record.address, family: record.family }));
};

export async function validateResolvedWebhookUrlForOutbound(
  urlValue: unknown,
  resolveHostname: WebhookDnsResolver = resolveWebhookHostnameForOutbound
): Promise<WebhookValidationResult> {
  const basicValidation = validateWebhookUrlForOutbound(urlValue);
  if (!basicValidation.ok) return basicValidation;

  const hostname = basicValidation.url.hostname.replace(/^\[(.*)\]$/, '$1');
  const literalIpFamily = isIP(hostname);
  let resolvedAddresses: DnsLookupRecord[];
  try {
    resolvedAddresses = literalIpFamily
      ? [{ address: hostname, family: literalIpFamily }]
      : await resolveHostname(hostname);
  } catch {
    return { ok: false, error: 'Webhook host could not be resolved' };
  }

  if (!resolvedAddresses.length) {
    return { ok: false, error: 'Webhook host did not resolve to an address' };
  }

  for (const record of resolvedAddresses) {
    if (isBlockedResolvedIp(record.address)) {
      return { ok: false, error: 'Webhook URL resolves to a blocked address' };
    }
  }

  return basicValidation;
}
