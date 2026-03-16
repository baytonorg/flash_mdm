# `netlify/functions/auth-magic-link-start.ts`

> Initiates a magic-link login flow by generating a token, storing it, and emailing the link to the user.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `sanitizeRedirectPath` | 79-83 | Validates that a redirect path starts with `/` and is not a protocol-relative URL (`//`) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database queries |
| `generateToken`, `hashToken` | `_lib/crypto.js` | Token generation and hashing |
| `sendEmail`, `magicLinkEmail` | `_lib/resend.js` | Email delivery and magic-link email template |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `consumeToken` | `_lib/rate-limiter.js` | Token-bucket rate limiting |

## Key Logic

1. Rejects non-POST requests with 405.
2. Requires `email` in the body; optionally accepts `redirect_path`.
3. **Rate limiting**: per-IP, 10 requests per hour.
4. Looks up the user by email. If not found, returns the same success message to prevent email enumeration.
5. Generates a cryptographic token, hashes it, and stores it in `magic_links` with a 15-minute expiry.
6. Builds the magic link URL using `URL` / `DEPLOY_PRIME_URL` env vars, appending the optional redirect path.
7. Sends the email via `sendEmail` with the `magicLinkEmail` template.
8. Logs `auth.magic_link_sent` to the audit log.
9. Returns a generic success message regardless of whether the user exists.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-magic-link-start` | None | Request a magic-link login email |
