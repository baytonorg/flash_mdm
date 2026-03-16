# `netlify/functions/auth-magic-link-verify.ts`

> Verifies a magic-link token from an email click, either creating a session directly or redirecting to MFA if TOTP is enabled.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `sanitizeRedirectPath` | 127-131 | Validates that a redirect path starts with `/` and is not a protocol-relative URL |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database queries and transactional token consumption |
| `hashToken`, `generateToken` | `_lib/crypto.js` | Token hashing and session token generation |
| `setSessionCookie`, `SESSION_MAX_AGE_MILLISECONDS` | `_lib/auth.js` | Session cookie creation and TTL constant |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `getClientIp` | `_lib/helpers.js` | Client IP extraction |

## Key Logic

1. This is a **GET** endpoint (clicked from an email link). Reads `token` and optional `redirect` from query parameters.
2. Hashes the token and atomically consumes the magic link inside a transaction (`UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING ...`) to prevent TOCTOU races.
3. If the link is invalid, expired, or already used, returns 400.
4. Looks up the user by email from the consumed link.
5. **TOTP branch**: if the user has `totp_enabled`, creates a short-lived (5-minute) MFA-pending token stored in `magic_links` with email set to `mfa_pending:<userId>`, and redirects (302) to `/login?mfa_pending=<token>`.
6. **Non-TOTP branch**: creates a full session, updates last login metadata, logs `auth.login`, and redirects (302) to the app root or the specified redirect path with a `Set-Cookie` header.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/auth-magic-link-verify` | None (token in query string) | Verify a magic-link token and establish a session or trigger MFA |
