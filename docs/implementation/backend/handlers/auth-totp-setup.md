# `netlify/functions/auth-totp-setup.ts`

> Initiates TOTP two-factor authentication setup by generating a secret, backup codes, and an otpauth:// URI for QR code display.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `base32Encode` | 14-34 | Encodes a Buffer as a base32 string per RFC 4648 |
| `generateBackupCodes` | 39-47 | Generates 10 one-time backup codes in `XXXX-XXXX` format using random bytes |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `queryOne` | `_lib/db.js` | Database queries |
| `requireSessionAuth` | `_lib/auth.js` | Session authentication |
| `encrypt` | `_lib/crypto.js` | Encrypts the pending TOTP data for storage |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |

## Key Logic

1. Rejects non-POST requests with 405.
2. Requires an active session via `requireSessionAuth`.
3. Checks if TOTP is already enabled; returns an error if so (must disable first).
4. Generates a 20-byte (160-bit) random secret and base32-encodes it.
5. Generates 10 one-time backup codes in `XXXX-XXXX` format.
6. Builds an `otpauth://totp/` URI with issuer `FlashMDM`, SHA1 algorithm, 6 digits, 30-second period.
7. Encrypts the secret, backup codes, and a timestamp as a JSON payload using context `totp_pending:<userId>`, and stores it in the `totp_pending_enc` column.
8. Logs `auth.totp_setup_initiated` to the audit log.
9. Returns the `secret`, `qr_url`, and `backup_codes` to the client for display. The setup is not finalised until verified via `auth-totp-verify`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/auth-totp-setup` | Session cookie | Initiate TOTP setup and receive secret + backup codes |
