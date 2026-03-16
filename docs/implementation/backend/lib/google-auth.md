# `netlify/functions/_lib/google-auth.ts`

> Provides Google OAuth2 token minting for AMAPI access and OAuth URL generation for the consent flow.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `getAmapiToken` | `(workspaceId: string) => Promise<string>` | Retrieves a cached or freshly minted Google access token for AMAPI, scoped to a workspace |
| `generateOAuthUrl` | `(clientId: string, redirectUri: string, state: string) => string` | Builds a Google OAuth2 authorization URL for the Android Management API consent flow |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `decrypt` | `_lib/crypto.ts` | Decrypting stored Google service account credentials |
| `queryOne` | `_lib/db.ts` | Fetching workspace credentials from the database |

## Key Logic

**`getAmapiToken`**: Uses a per-workspace in-memory `Map` cache with a 55-minute TTL (with 1-minute safety margin). On cache miss, it fetches the encrypted credentials from the `workspaces` table, decrypts them, and uses `google-auth-library`'s `GoogleAuth` to mint a new token scoped to `https://www.googleapis.com/auth/androidmanagement`.

**`generateOAuthUrl`**: Constructs a standard Google OAuth2 authorization URL with `response_type=code`, `access_type=offline`, and `prompt=consent` to ensure a refresh token is returned. The scope is `androidmanagement`.
