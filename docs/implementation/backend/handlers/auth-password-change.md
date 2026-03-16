# `netlify/functions/auth-password-change.ts`

> Allows an authenticated user to change their password by providing their current password and a new one.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db.js` | Database queries |
| `requireSessionAuth`, `clearSessionCookie`, `getSessionTokenFromCookie` | `_lib/auth.js` | Session authentication and cookie management |
| `hashToken` | `_lib/crypto.js` | Hashing the current session token for audit details |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `hashPassword`, `_verifyPassword` | `auth-login.js` | Password hashing and verification (imported from sibling handler) |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `_lib/password-policy.js` | Password length constraints |

## Key Logic

1. Rejects non-POST requests with 405.
2. Requires an active session via `requireSessionAuth`.
3. Validates `current_password` and `new_password` are present and that the new password meets length constraints.
4. Fetches the user's stored `password_hash`. Returns 400 if the account has no password set (e.g. magic-link-only).
5. Verifies the current password. On failure, logs `auth.password_change_failed` and returns 401.
6. Hashes the new password and updates the user row.
7. **Invalidates all sessions** for the user (including the current one) by deleting all rows from `sessions`.
8. Logs `auth.password_changed` with the current session ID in the details.
9. Returns success with a cleared session cookie, forcing the user to re-authenticate.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-password-change` | Session cookie | Change the authenticated user's password |
