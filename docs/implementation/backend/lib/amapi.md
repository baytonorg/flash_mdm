# `netlify/functions/_lib/amapi.ts`

> Core HTTP client for making authenticated requests to the Google Android Management API (AMAPI).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `getAmapiErrorHttpStatus` | `(err: unknown) => number \| null` | Extracts the HTTP status code from an AMAPI error message, returns null if not an AMAPI error |
| `amapiCall` | `<T>(path: string, workspaceId: string, options: AmapiCallOptions) => Promise<T>` | Makes an authenticated HTTP request to the AMAPI v1 endpoint with rate limiting, retry, and error handling |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getAccessToken` | 25-73 | Retrieves a Google OAuth2 access token for a workspace, using a per-workspace in-memory cache with 55-minute TTL. Decrypts stored service account credentials from the database and mints tokens via `google-auth-library`. |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `checkAmapiRateLimit` | `_lib/rate-limiter.ts` | Pre-flight rate limit check per enterprise/resource before calling AMAPI |
| `decrypt` | `_lib/crypto.ts` | Decrypting stored Google service account credentials |
| `queryOne` | `_lib/db.ts` | Fetching workspace credentials from the database |

## Key Logic

1. **Token caching**: Maintains a `Map<workspaceId, {token, expiresAt}>` to avoid re-minting tokens. Tokens are cached for ~55 minutes with a 1-minute safety margin before expiry.
2. **Rate limiting**: When an `enterpriseName` is provided, checks the internal rate limiter before making the request. If denied, waits the suggested retry interval and checks once more before throwing.
3. **Request execution**: Builds a fetch request to `https://androidmanagement.googleapis.com/v1/{path}` with Bearer auth. On a 503 response (Google-side rate limit), retries once after a 2-second delay.
4. **Error handling**: Non-OK responses are parsed for a Google API error message and thrown as `Error` with the format `AMAPI error ({status}): {message}`, which `getAmapiErrorHttpStatus` can later extract.
5. **204 handling**: Returns an empty object for 204 No Content responses.
