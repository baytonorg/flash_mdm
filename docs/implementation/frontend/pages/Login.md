# `src/pages/Login.tsx`

> Authentication page supporting magic link, password, and TOTP two-factor login flows.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Login` | `React.FC` (default) | Login page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useAuthStore` | `@/stores/auth` | Login methods (password, magic link, MFA), error state |
| `apiClient` | `@/api/client` | Fetching public auth config |
| `sanitizeInAppRedirect` | `@/lib/redirect` | Sanitizing the redirect URL from query params |

## Key Logic

The page implements a multi-mode login flow controlled by a `mode` state variable:

- **choose** (default): Email input with a "Send magic link" button. A secondary link switches to password mode.
- **password**: Email and password inputs with a "Sign in" button. If the server responds with a TOTP requirement, the mode switches to `totp`. Links to password reset and back to magic link mode.
- **magic-link-sent**: Confirmation message showing the email address the link was sent to.
- **totp**: Six-digit authenticator code input. Supports both password-initiated MFA and magic-link-initiated MFA (via `mfa_pending` URL param that triggers `completeMagicLinkMfa`).

On mount, the page fetches `/api/auth/config` to check if registration is invite-only, conditionally showing either a registration link or an informational message. A `redirect` query parameter is preserved through all flows via `sanitizeInAppRedirect` and used after successful authentication.
