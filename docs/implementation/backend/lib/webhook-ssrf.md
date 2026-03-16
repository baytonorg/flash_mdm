# `netlify/functions/_lib/webhook-ssrf.ts`

> SSRF protection for outbound webhook URLs with hostname validation, DNS resolution checks, and blocked IP range detection.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `validateWebhookUrlForOutbound` | `(urlValue: unknown) => { ok: true; url: URL } \| { ok: false; error: string }` | Validates a webhook URL synchronously: checks it is a string, parseable, HTTPS-only, and hostname does not match blocked patterns (localhost, private ranges, metadata endpoints) |
| `isBlockedResolvedIp` | `(ip: string) => boolean` | Returns true if an IP address (v4, v6, or v4-mapped-v6) falls within a blocked range |
| `resolveWebhookHostnameForOutbound` | `(hostname: string) => Promise<DnsLookupRecord[]>` | Default DNS resolver using `dns.lookup` with `all: true` |
| `validateResolvedWebhookUrlForOutbound` | `(urlValue: unknown, resolveHostname?: WebhookDnsResolver) => Promise<WebhookValidationResult>` | Full validation: runs `validateWebhookUrlForOutbound`, then resolves the hostname via DNS and checks all resolved IPs against blocked ranges |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseIPv4` | 51-56 | Parses a dotted-decimal IPv4 string into an array of 4 octets; returns null on invalid input |
| `ipv4FromMappedIpv6` | 58-76 | Extracts the IPv4 address from a `::ffff:` mapped IPv6 address (dotted or hex notation) |
| `isBlockedIpv4` | 78-101 | Checks an IPv4 address against all blocked ranges including private, link-local, CGNAT, benchmarking, multicast, and cloud metadata IPs |
| `isBlockedIpv6` | 103-110 | Checks an IPv6 address against blocked ranges: loopback, unique local (fc/fd), link-local (fe80), multicast (ff) |

## Key Logic

SSRF protection is applied in two phases:

**Phase 1 -- Hostname validation** (`validateWebhookUrlForOutbound`): Rejects non-HTTPS URLs and hostnames matching regex patterns for localhost, RFC 1918 private ranges (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x), IPv6 loopback/private, and cloud metadata endpoints (`metadata.google.internal`, `.internal`).

**Phase 2 -- DNS resolution validation** (`validateResolvedWebhookUrlForOutbound`): Resolves the hostname to all IP addresses via DNS lookup, then checks every resolved address against a comprehensive blocklist including:
- All RFC 1918 private ranges
- Loopback (127.x)
- Link-local (169.254.x)
- CGNAT (100.64-127.x)
- Benchmarking (198.18-19.x)
- Multicast/reserved (224+)
- Cloud metadata IPs: Alibaba (100.100.100.200), OCI (192.0.0.192)
- IPv6: loopback, unique local (fc/fd, covers AWS IMDS IPv6), link-local (fe80), multicast (ff)

IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`) are normalized to IPv4 before checking. The DNS resolver is injectable for testing.
