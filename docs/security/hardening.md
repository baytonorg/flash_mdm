# Hardening & input validation

This page describes the main defence-in-depth controls in Flash MDM.

## 1) Request hardening

- **CSRF protection** on mutation endpoints: if an `Origin` header is present it must match the request origin, and `X-Requested-With: XMLHttpRequest` must always be present. API key authenticated requests are exempt (CSRF does not apply to non-browser token auth).
- **Logout CSRF hardening**: `auth-logout` requires an explicit `Origin` header that matches the request origin and enforces `X-Requested-With: XMLHttpRequest`.
- **UUID validation** helpers (`isValidUuid()`) used across CRUD endpoints to prevent accidental cross-scope lookups and clarify error messages.
- **Generic error responses**: top-level catch blocks return `'Internal server error'` rather than raw `err.message`. Some endpoints intentionally expose `err.message` in error responses to aid client-side debugging (e.g. validation errors).
- **Impersonation read-only enforcement**: mutating requests are blocked during read-only support sessions, enforced in `requireAuth()`.

## 2) Authentication hardening

- Rate limiting on all auth endpoints (Postgres token bucket — see [auth.md](./auth.md) for limits).
- Timing-safe password verification via `timingSafeEqual` (prevents timing-based username enumeration).
- Dummy password hash computation for non-existent users to normalise response timing.
- Optional MFA (TOTP + backup codes).

## 3) Outbound hardening

SSRF protections for outbound/webhook URL validation (`netlify/functions/_lib/webhook-ssrf.ts`):

- Requires `https://` scheme.
- Blocks loopback, private RFC-1918 ranges, link-local, CGNAT (`100.64.0.0/10`), cloud metadata endpoints (AWS/GCP/Azure/OCI/Alibaba).
- DNS-resolution-aware: resolves hostnames and checks all returned IPs against the blocklist (prevents DNS rebinding).
- IPv6-mapped IPv4 addresses are unwrapped before checking.
- Geofence webhooks are validated both at save-time and again immediately before outbound egress from background workers.
- Outbound webhook fetches enforce `redirect: 'error'` to block redirect-based SSRF bypasses.
- Queued outbound webhook jobs should use `executeValidatedOutboundWebhook()` rather than calling `fetch()` directly; this centralizes DNS-aware validation, redirect blocking, JSON request construction, and timeout handling.

| Claim | Evidence | Confidence |
|---|---|---|
| Webhook egress is revalidated immediately before network fetch. | `netlify/functions/_lib/outbound-webhook.ts`; `netlify/functions/_lib/webhook-ssrf.ts`; `netlify/functions/sync-process-background.ts` | high |
| Redirect-based SSRF bypasses are blocked for queued webhook jobs. | `netlify/functions/_lib/outbound-webhook.ts`; `netlify/functions/_lib/__tests__/outbound-webhook.test.ts` | high |

## 4) Log safety

The Flashi endpoints sanitize selected error payloads before logging through `sanitizeErrorForLog()`. The sanitizer redacts secret-like key names, bearer tokens, Stripe-style secret keys, JWT-looking strings, and common inline `key=value`/`key: value` assignments. It also walks `Error` objects, arrays, and nested objects with a depth cap.

This is a defence-in-depth control for error paths; it does not make arbitrary object logging safe. New handlers that may log provider errors, LLM/tool errors, authorization headers, API keys, or credential-bearing payloads should either avoid logging the raw value or pass it through `sanitizeErrorForLog()` first.

| Claim | Evidence | Confidence |
|---|---|---|
| The sanitizer redacts token/key patterns and nested sensitive keys. | `netlify/functions/_lib/log-safety.ts`; `netlify/functions/_lib/__tests__/log-safety.test.ts` | high |
| Current explicit consumers are Flashi chat/history/download handlers. | `netlify/functions/flashagent-chat.ts`; `netlify/functions/flashagent-chat-history.ts`; `netlify/functions/flashagent-download.ts` | high |

## 5) Secrets at rest

Sensitive values (TOTP secrets, backup codes, Google service account credentials) are encrypted using AES-256-GCM before storage. The encryption envelope format is `v1.<iv>.<tag>.<ciphertext>` (base64url). Domain-specific AAD is derived per secret type to prevent cross-domain ciphertext reuse.

Source: `netlify/functions/_lib/crypto.ts`

## 6) HTTP headers

Security headers are configured in `netlify.toml`:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: microphone=(), camera=(), geolocation=(self)`
- `Content-Security-Policy`: `default-src 'self'` with allowlists for Google APIs and Play Store frames.

CORS headers for `/api/*` routes are configured in `netlify.toml`:

- `Access-Control-Allow-Origin: <your-app-origin>` (configured in `netlify.toml`)
- `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Headers: Content-Type, X-Requested-With, Authorization, X-API-Key`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Vary: Origin`

The global CSP also includes `frame-ancestors 'none'` (redundant with `X-Frame-Options: DENY` but defence-in-depth).

Notes:

- `unsafe-eval` is present in the CSP for `/policies` and `/policies/*` routes only (needed for the Monaco JSON editor). The global CSP for `/*` does not include `unsafe-eval`.
- `object-src 'none'` is explicitly set in all CSP rules.
- HSTS includes `preload`. To complete preload eligibility, submit the domain at [hstspreload.org](https://hstspreload.org/).
