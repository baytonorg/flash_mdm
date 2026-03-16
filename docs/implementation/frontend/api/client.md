# `src/api/client.ts`

> Provides a singleton HTTP client (`apiClient`) that wraps `fetch` with JSON serialization, credentials, error handling, and automatic 401 redirect-to-login.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `apiClient` | `ApiClient` | Singleton instance used by all query/mutation hooks to make API requests |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `ApiError.constructor` | 4-9 | Custom error class carrying HTTP `status` and parsed response `data` |
| `ApiClient.request` | 19-78 | Core fetch wrapper: sets credentials/headers, parses errors, handles MFA 401s, redirects expired sessions to `/login` |
| `ApiClient.get` | 80-82 | GET shorthand |
| `ApiClient.post` | 84-89 | POST shorthand, JSON-stringifies body |
| `ApiClient.put` | 91-96 | PUT shorthand, JSON-stringifies body |
| `ApiClient.patch` | 98-103 | PATCH shorthand, JSON-stringifies body |
| `ApiClient.delete` | 105-107 | DELETE shorthand |

## Key Logic

- Every request includes `credentials: 'include'` and `X-Requested-With: XMLHttpRequest` headers for CSRF/session cookie handling.
- On non-OK responses the body is read as text first, then parsed as JSON if possible, to avoid "body stream already read" errors.
- 401 responses containing `needs_totp` or `needs_mfa` are re-thrown as `ApiError` without triggering a redirect, so the login flow can handle MFA challenges.
- All other 401 responses redirect the browser to `/login?redirect=<current_path>`, except for auth-related endpoints (`/api/auth/session`, `/api/auth/login`, `/api/auth/magic-link-complete`, `/api/auth/password-reset-complete`) which are suppressed.
- 204 responses return an empty object cast to the expected type.
