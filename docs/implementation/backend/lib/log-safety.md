# `netlify/functions/_lib/log-safety.ts`

> Redacts secrets and tokens from values before they are written to process logs.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `sanitizeErrorForLog` | `(err: unknown) => unknown` | Recursively sanitizes strings, objects, arrays, and `Error` instances for safer console logging |

## Internal Constants and Functions

| Name | Description |
|------|-------------|
| `SENSITIVE_KEY_PATTERN` | Matches key names that commonly hold credentials, including passwords, secrets, tokens, authorization values, API keys, private keys, TOTP/OTP values, and activation codes |
| `redactSensitiveText` | Replaces bearer tokens, Stripe-style secret keys, JWT-looking strings, and inline `key=value`/`key: value` secret assignments with `[REDACTED]` |
| `sanitizeValue` | Depth-limited recursive sanitizer; returns `[TRUNCATED]` past depth 6 |

## Key Logic

The sanitizer is defensive log hygiene, not a substitute for avoiding secret logging. It handles:

- `Error` objects by sanitizing `name`, `message`, `stack`, and nested `cause`.
- Objects and arrays recursively, with sensitive key names redacted regardless of value shape.
- Strings with common inline token/key patterns.
- `bigint` values by converting them to strings for JSON-safe output.

## Used By

| Consumer | Purpose |
|----------|---------|
| `netlify/functions/flashagent-chat.ts` | Redacts AI assistant request/runtime errors before logging |
| `netlify/functions/flashagent-chat-history.ts` | Redacts chat history errors before logging |
| `netlify/functions/flashagent-download.ts` | Redacts Flashi download errors before logging |

## Evidence

| Claim | Evidence | Confidence |
|---|---|---|
| The sanitizer redacts bearer tokens and secret-like nested fields. | `netlify/functions/_lib/log-safety.ts`; `netlify/functions/_lib/__tests__/log-safety.test.ts` | high |
| Current consumers are Flashi endpoints. | `netlify/functions/flashagent-chat.ts`; `netlify/functions/flashagent-chat-history.ts`; `netlify/functions/flashagent-download.ts` | high |
