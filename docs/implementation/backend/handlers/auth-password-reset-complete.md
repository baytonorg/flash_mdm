# `netlify/functions/auth-password-reset-complete.ts`

> Completes a password-reset flow by consuming the reset token and setting a new password, with an MFA gate for TOTP-enabled users.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `transaction` | `_lib/db.js` | Transactional token consumption and password update |
| `hashToken`, `generateToken`, `encrypt` | `_lib/crypto.js` | Token hashing, generation, and encryption of pending password hash |
| `clearSessionCookie` | `_lib/auth.js` | Builds a Set-Cookie header to clear the session |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `hashPassword` | `auth-login.js` | Password hashing (imported from sibling handler) |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `_lib/password-policy.js` | Password length constraints |

## Key Logic

1. Rejects non-POST requests with 405.
2. Requires `token` and `new_password` in the body; validates password length constraints.
3. Hashes the new password up front.
4. Runs an atomic transaction:
   a. Consumes the reset token (`UPDATE magic_links SET used_at = now() WHERE ... AND email LIKE 'password_reset:%'`). Only the first concurrent request succeeds.
   b. Extracts the user ID from the token's `email` field (`password_reset:<userId>`).
   c. **TOTP branch**: if the user has `totp_enabled`, generates a short-lived MFA-pending token, encrypts the pending password hash, stores it as a `password_reset_mfa_pending_v2:<userId>:<encryptedHash>` magic link (5-minute TTL), and returns `{ needs_mfa: true, mfa_pending_token }` with 401.
   d. **Non-TOTP branch**: updates the password directly, deletes all sessions for the user, and returns success.
5. Logs `auth.password_reset_completed` for non-TOTP completions.
6. Returns success with a cleared session cookie.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-password-reset-complete` | None (token-based) | Complete a password reset with a new password |
