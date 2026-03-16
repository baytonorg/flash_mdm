# `netlify/functions/_lib/crypto.ts`

> AES-256-GCM authenticated encryption/decryption and SHA-256 token hashing utilities.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `encrypt` | `(plaintext: string, domain: string) => string` | Encrypts plaintext using AES-256-GCM with domain-scoped AAD; returns a `v1.<iv>.<tag>.<ciphertext>` envelope |
| `decrypt` | `(envelope: string, domain: string) => string` | Decrypts a `v1.*` envelope using the same domain for AAD verification |
| `hashToken` | `(token: string) => string` | Returns the SHA-256 hex digest of a token string |
| `generateToken` | `() => string` | Generates a cryptographically random 32-byte hex token |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getMasterKey` | 7-13 | Reads `ENCRYPTION_MASTER_KEY` env var, accepts hex (64 chars) or base64 (44 chars) encoding |
| `deriveAad` | 15-17 | Derives Additional Authenticated Data by SHA-256 hashing the domain string |

## Key Logic

Encryption uses AES-256-GCM with a 12-byte random IV and 16-byte auth tag. The `domain` parameter provides context-binding via AAD (Additional Authenticated Data), preventing ciphertext from being valid when decrypted in a different domain context.

The envelope format is versioned (`v1.`) to allow future algorithm changes. All binary components are encoded as base64url for safe storage and transport.

The master key is sourced from the `ENCRYPTION_MASTER_KEY` environment variable. The function auto-detects whether the key is hex-encoded (64 characters) or base64-encoded (44 characters).
