# `netlify/functions/_lib/workspace-credentials.ts`

> Shared workspace credential resolution. Decrypts Google service account credentials and mints an OAuth2 access token for AMAPI calls.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkspaceCredentials` | `interface` | Result shape: `{ accessToken: string; projectId: string }` |
| `resolveAccessTokenAndProject` | `(workspaceId: string) => Promise<WorkspaceCredentials>` | Decrypts workspace credentials and mints a Google access token |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db` | Fetches encrypted credentials from `workspaces` table |
| `decrypt` | `_lib/crypto` (dynamic import) | AES-256-GCM decryption of service account JSON |
| `GoogleAuth` | `google-auth-library` (dynamic import) | Mints an OAuth2 access token for AMAPI scope |

## Key Logic

1. Queries `workspaces` for `google_credentials_enc` and `gcp_project_id`.
2. Throws if no encrypted credentials are stored.
3. Decrypts using `workspace:{id}` as the encryption context. On failure, logs the internal error and throws a user-friendly message.
4. Parses the decrypted JSON. Throws on malformed input.
5. Creates a `GoogleAuth` client scoped to `androidmanagement` and mints an access token.
6. Returns the access token and resolved project ID (prefers DB column, falls back to credential file).

## Used By

| Consumer | Purpose |
|----------|---------|
| `mcp-amapi.ts` | Mints token to proxy JSON-RPC to AMAPI MCP |
| `flashagent-chat.ts` | Mints token for Flashi runtime AMAPI tool calls |

## Security Notes

- Credential decryption errors return a generic user-facing message; raw error details are logged server-side only.
- Dynamic imports (`crypto.js`, `google-auth-library`) keep cold-start cost lower for callers that may not need AMAPI.
