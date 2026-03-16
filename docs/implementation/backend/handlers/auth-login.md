# `netlify/functions/auth-login.ts`

> Authenticates a user with email and password, with optional TOTP/backup-code MFA, and issues a session cookie.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |
| `hashPassword` | `(password: string) => string` | Hashes a password using scrypt (also exported as `_hashPassword`) |
| `_verifyPassword` | `(password: string, hash: string) => Promise<boolean>` | Verifies a password against a stored hash |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `hashPasswordScrypt` | 16-24 | Generates a scrypt hash with random salt in `$flash2$salt$hash` format |
| `verifyPassword` | 28-58 | Verifies a password against both the new scrypt (`$flash2$`) and legacy SHA-256 (`$flash$`) hash formats using timing-safe comparison |
| `normalizeLoginEmail` | 70-72 | Lowercases and trims the email |
| `retryAfterHeader` | 74-77 | Builds a `Retry-After` header from milliseconds |
| `throttledLoginResponse` | 79-85 | Returns a 429 response with rate-limit messaging |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database queries |
| `setSessionCookie`, `SESSION_MAX_AGE_MILLISECONDS` | `_lib/auth.js` | Session cookie creation and TTL constant |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `decrypt`, `encrypt`, `generateToken`, `hashToken` | `_lib/crypto.js` | Token generation, hashing, and encryption |
| `consumeBackupCode`, `verifyTOTP` | `_lib/totp.js` | TOTP and backup code verification |
| `consumeToken` | `_lib/rate-limiter.js` | Token-bucket rate limiting |

## Key Logic

1. Rejects non-POST requests with 405.
2. Validates required `email` and `password` fields.
3. **Rate limiting** -- two layers:
   - Per-IP: 10 attempts per 15 minutes.
   - Per-account (normalised email): 5 attempts per 15 minutes.
4. Looks up the user by normalised email. If not found, runs a dummy password hash to prevent timing-based enumeration, then returns 401.
5. Verifies the password. On failure, logs `auth.login_failed` and returns 401.
6. **Legacy hash migration**: if the stored hash uses the old `$flash$` SHA-256 format, it is transparently upgraded to scrypt on successful login.
7. **TOTP/MFA check** (when `totp_enabled` is true):
   - If no `totp_code` is provided, returns `{ needs_totp: true }` with 401 so the client can prompt.
   - Applies separate TOTP rate limits (per-IP and per-user, 10/5 per 5 minutes).
   - Tries the TOTP secret first; falls back to backup codes. Backup code consumption is CAS-guarded.
   - On failure, logs `auth.login_failed` with reason `invalid_totp`.
8. Creates a session row (token hash stored in DB, plaintext token in cookie).
9. Updates `last_login_at`, `last_login_ip`, and `last_login_method` on the user.
10. Logs `auth.login` and returns the user object with a `Set-Cookie` header.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-login` | None | Authenticate with email/password (+ optional TOTP) |
