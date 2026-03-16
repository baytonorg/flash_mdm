# `netlify/functions/auth-password-reset-start.ts`

> Initiates a password-reset flow by generating a reset token and emailing a reset link to the user.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `passwordResetEmail` | 15-28 | Builds the HTML email template and subject line for the password reset email |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database queries |
| `generateToken`, `hashToken` | `_lib/crypto.js` | Token generation and hashing |
| `sendEmail` | `_lib/resend.js` | Email delivery via Resend |
| `consumeToken` | `_lib/rate-limiter.js` | Token-bucket rate limiting |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `BRAND` | `_lib/brand.js` | Brand name for email subject |
| `escapeHtml` | `_lib/html.js` | HTML escaping for the reset URL in the email template |

## Key Logic

1. Rejects non-POST requests with 405.
2. Requires `email` in the body.
3. **Rate limiting**: per-IP, 5 requests per hour.
4. Looks up the user by email. If not found, returns a generic success message to prevent email enumeration.
5. Generates a cryptographic token, hashes it, and stores it in `magic_links` with `email` set to `password_reset:<userId>` and a 15-minute expiry.
6. Builds the reset URL pointing to `/reset-password?token=<token>`.
7. Sends the email using a branded HTML template with an XSS-safe URL.
8. Logs `auth.password_reset_requested` to the audit log.
9. Returns a generic success message regardless of whether the user exists.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-password-reset-start` | None | Request a password-reset email |
