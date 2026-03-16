# Authentication & sessions

## Login methods

Flash MDM supports three login methods:

- **Password** — email + password (scrypt-hashed, `$flash2$` format, N=16384 r=8 p=1). Legacy SHA-256 hashes (`$flash$` format) are migrated to scrypt on next successful login.
- **Magic link** — email-based one-time link; consumed atomically via `UPDATE … RETURNING` to prevent TOCTOU races.
- **API key** — `Bearer` token or `X-API-Key` header; token hash stored in DB, last-used IP tracked on each call.

## Session tokens

- Generated using `randomBytes(32).toString('hex')` (256-bit entropy).
- The plaintext token is sent to the browser in a `Set-Cookie` header; only a SHA-256 hash is stored in the `sessions` table.
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` (in non-development environments), `Max-Age=1209600` (14 days).
- Sliding expiration: sessions are renewed in the background when fewer than 7 days remain.
- All existing sessions are invalidated on password reset.

Source: `netlify/functions/_lib/auth.ts`, `netlify/functions/auth-login.ts`

## CSRF protection

Session-authenticated mutation requests (POST/PUT/PATCH/DELETE) must pass both checks:

1. If an `Origin` header is present, it must match the request origin (`assertSameOriginRequest()`). Requests without an `Origin` header (same-origin non-browser clients) pass this check.
2. `X-Requested-With: XMLHttpRequest` must be present (always required for session mutations).
3. `POST /api/auth/logout` is stricter: it requires a present `Origin` header that exactly matches the request origin, plus `X-Requested-With: XMLHttpRequest`.

API key authenticated requests bypass these checks (CSRF does not apply to non-browser token auth).

Source: `netlify/functions/_lib/auth.ts` (`requireAuth`), `netlify/functions/_lib/helpers.ts` (`assertSameOriginRequest`, `parseJsonBody`)

## MFA / TOTP

- TOTP is optional per-user (RFC 6238, SHA1, 6-digit, 30-second step with +/-1 step drift tolerance).
- Setup flow: `POST /api/auth/totp/setup` generates a 160-bit secret + 10 backup codes; both are stored encrypted (`AES-256-GCM`) in `totp_pending_enc` until confirmed. Setup creation time is tracked in `totp_pending_created_at`.
- Confirmation flow: `POST /api/auth/totp/verify` verifies a 6-digit code against the pending secret, then promotes the pending data to permanent `totp_secret_enc` / `totp_backup_codes_enc`.
- Pending TOTP setups expire after 15 minutes.
- Stale pending TOTP setup data is cleaned daily by `cleanup-scheduled` (pending blob + pending timestamp cleared).
- Disabling TOTP requires either a valid authenticator code or a backup code (both accepted in the disable flow).

## Backup codes

- 10 codes generated on TOTP setup (format `XXXX-XXXX`).
- Stored encrypted in `totp_backup_codes_enc`.
- Single-use: code is removed from the array on consumption via a compare-and-swap (`UPDATE … WHERE totp_backup_codes_enc = $old`).
- Backup codes are accepted in the login flow, TOTP disable flow, and magic-link MFA completion.

## Password reset flow

1. User requests a reset link via `POST /api/auth/password-reset/start`.
2. A magic link token is created in `magic_links` with the email field set to `password_reset:<user_id>`.
3. On completion (`POST /api/auth/password-reset/complete`), the token is atomically consumed.
4. If the user has TOTP enabled, an MFA-pending token is issued and the pre-hashed new password is stored encrypted in `magic_links.email` (format `password_reset_mfa_pending_v2:<user_id>:<encrypted_hash>`). MFA must be completed via `POST /api/auth/magic-link-complete` to finalize the password change.
5. On success, all existing sessions are deleted.

The pre-computed scrypt hash stored in `magic_links.email` during MFA-pending resets is AES-256-GCM encrypted before storage and expires with the 5-minute token lifetime.

## Rate limiting

All rate limits use a Postgres-backed token bucket (`netlify/functions/_lib/rate-limiter.ts`). Each `consumeToken()` call specifies:

- **Bucket key** — scoping (per-IP, per-user, per-token, etc.)
- **Cost** — tokens consumed per request (usually `1`)
- **Max tokens** — bucket capacity (burst limit)
- **Refill rate** — tokens restored per second

Rate limits are configured inline in each handler's `consumeToken()` call. To adjust a limit, find the relevant `consumeToken()` call in the handler file and change the `maxTokens` / `refillRate` arguments.

| Endpoint | Handler file | Buckets |
|---|---|---|
| Login | `auth-login.ts` | Per-IP, per-account |
| Login TOTP | `auth-login.ts` | Per-IP, per-user |
| Registration | `auth-register.ts` | Per-IP |
| Magic link start | `auth-magic-link-start.ts` | Per-IP |
| Magic-link MFA completion | `auth-magic-link-complete.ts` | Per-IP, per-token |
| Password reset start | `auth-password-reset-start.ts` | Per-IP |
| TOTP setup | `auth-totp-setup.ts` | Per-IP, per-user |
| TOTP verify / disable | `auth-totp-verify.ts` | Per-IP, per-user |
| MCP AMAPI proxy | `mcp-amapi.ts` | Per-IP, per-principal |
| FlashAgent chat | `flashagent-chat.ts` | Per-IP, per-principal |
