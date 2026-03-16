# `netlify/functions/auth-magic-link-complete.ts`

> Completes a magic-link login or password-reset flow that requires TOTP MFA verification.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parsePendingMfaContext` | 249-270 | Parses the `email` field of a magic_links row to determine the pending MFA context type (`login` or `password_reset`) and extract the user ID and optional encrypted password hash |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database queries |
| `hashToken`, `generateToken` | `_lib/crypto.js` | Token hashing and generation |
| `setSessionCookie`, `clearSessionCookie`, `SESSION_MAX_AGE_MILLISECONDS` | `_lib/auth.js` | Session cookie management |
| `consumeBackupCode`, `verifyTOTP` | `_lib/totp.js` | TOTP and backup code verification |
| `decrypt`, `encrypt` | `_lib/crypto.js` | Encryption/decryption of TOTP secrets and backup codes |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `consumeToken` | `_lib/rate-limiter.js` | Token-bucket rate limiting |

## Key Logic

1. Rejects non-POST requests with 405.
2. Requires `token` (the MFA-pending token) and `totp_code` in the request body.
3. **Rate limiting**: per-IP (10/5 min) and per-token (5/5 min).
4. Looks up the MFA-pending magic link by token hash; validates it is unused and not expired.
5. Parses the pending MFA context from the magic link's `email` field to determine whether this is a **login** or **password reset** completion.
6. Fetches the user and verifies TOTP is enabled.
7. Attempts TOTP verification; falls back to backup codes with CAS-guarded consumption.
8. Marks the pending token as used (single-use, race-safe via `UPDATE ... WHERE used_at IS NULL`).
9. **Password reset path** (`kind === 'password_reset'`):
   - Decrypts the pending password hash.
   - Updates the user's password, invalidates all sessions, and logs `auth.password_reset_completed`.
   - Returns success with a cleared session cookie.
10. **Login path** (`kind === 'login'`):
    - Creates a new session, updates last login metadata, and logs `auth.login`.
    - Returns the user object with a session cookie.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-magic-link-complete` | None (token-based) | Complete MFA verification for a magic-link login or password reset |
