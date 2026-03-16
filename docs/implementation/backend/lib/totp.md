# `netlify/functions/_lib/totp.ts`

> TOTP (Time-based One-Time Password) verification and backup code consumption for two-factor authentication.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `verifyTOTP` | `(secret: string, code: string) => boolean` | Verifies a 6-digit TOTP code against a base32-encoded secret, allowing +/- 1 time step (30s) window |
| `consumeBackupCode` | `(backupCodes: string[], candidate: string) => { matched: boolean; remainingCodes: string[] }` | Checks if candidate matches any backup code; returns match result and remaining unused codes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `base32Decode` | 5-24 | Decodes a base32-encoded string (RFC 4648) into a Buffer |
| `generateTOTP` | 26-41 | Generates a 6-digit TOTP code for a given secret and time step using HMAC-SHA1 |
| `timingSafeStringEqual` | 43-49 | Constant-time string comparison to prevent timing attacks |
| `normalizeBackupCode` | 52-54 | Trims, uppercases, and strips non-alphanumeric characters (except hyphens) from backup codes |

## Key Logic

TOTP follows RFC 6238 with a 30-second time step and 6-digit codes. Verification checks the current time step plus one step before and after to accommodate clock drift.

Backup code matching uses constant-time comparison via `timingSafeStringEqual` to prevent timing side-channel attacks. When a backup code is matched, it is removed from the returned array, allowing the caller to persist the reduced set.

All string comparisons (TOTP codes and backup codes) use constant-time algorithms.
