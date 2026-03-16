# `netlify/functions/auth-totp-verify.ts`

> Handles TOTP verification (finalising setup) and TOTP disabling, routed by the last URL path segment.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `toRetryAfterHeader` | 10-13 | Builds a `Retry-After` header from milliseconds |
| `consumeTotpRateLimit` | 15-41 | Applies two-tier rate limiting (per-IP: 10/5 min, per-user: 5/5 min) and returns a 429 response if exceeded, or `null` if allowed |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `queryOne` | `_lib/db.js` | Database queries |
| `requireSessionAuth` | `_lib/auth.js` | Session authentication |
| `encrypt`, `decrypt` | `_lib/crypto.js` | Encryption/decryption of TOTP secrets and backup codes |
| `verifyTOTP`, `consumeBackupCode` | `_lib/totp.js` | TOTP verification and backup code consumption |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `consumeToken` | `_lib/rate-limiter.js` | Token-bucket rate limiting |

## Key Logic

This handler uses path-based routing. The last segment of the URL path determines the action.

### Action: `verify` -- Finalise TOTP Setup
1. Requires a 6-digit `code` in the body.
2. Applies TOTP rate limiting.
3. Fetches `totp_pending_enc` and `totp_enabled` from the user row. Returns an error if TOTP is already enabled or no pending setup exists.
4. Decrypts the pending TOTP data. Checks the pending setup has not expired (15-minute TTL).
5. Verifies the provided code against the pending secret using `verifyTOTP`.
6. On success, encrypts the secret and backup codes for permanent storage and updates the user row: sets `totp_enabled = true`, stores `totp_secret_enc` and `totp_backup_codes_enc`, clears `totp_pending_enc`.
7. Logs `auth.totp_enabled`.

### Action: `disable` -- Disable TOTP
1. Requires a `code` in the body (TOTP code or backup code).
2. Applies TOTP rate limiting.
3. Fetches the user's TOTP state. Returns an error if TOTP is not currently enabled.
4. Attempts TOTP verification first; falls back to backup code verification with CAS-guarded consumption.
5. On success, clears all TOTP columns (`totp_enabled = false`, nulls `totp_secret_enc`, `totp_backup_codes_enc`, `totp_pending_enc`).
6. If a backup code was used, logs `auth.backup_code_used` with the remaining count.
7. Logs `auth.totp_disabled`.

### Fallback
Returns 404 for any unrecognised action.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-totp-verify/verify` | Session cookie | Verify a TOTP code to finalise setup |
| POST | `/.netlify/functions/auth-totp-verify/disable` | Session cookie | Disable TOTP by providing a valid code or backup code |
