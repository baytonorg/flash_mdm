# `src/pages/ResetPassword.tsx`

> Multi-step password reset flow supporting email request, token-based reset, and MFA verification.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ResetPassword` | `React.FC` (default) | Password reset page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getApiErrorData` | 13-17 | Extracts the `data` property from an API error object |
| `getApiErrorStatus` | 19-24 | Extracts the HTTP status code from an API error object |
| `ResetPassword` | 26-285 | Main component with three modes: request, reset, and MFA |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | API calls for password reset flow |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `@/constants/auth` | Password validation constraints |

## Key Logic

The page operates in three modes determined by URL params and local state:

1. **Request mode** (no `token` param): Shows an email input form. Submits to `POST /api/auth/password-reset-start`. On success, displays a confirmation message.

2. **Reset mode** (`token` query param present): Shows new password and confirm password fields. Submits to `POST /api/auth/password-reset-complete`. Validates that passwords match before sending. If the server responds with a 401 status containing `needs_mfa: true` and a `mfa_pending_token`, transitions to MFA mode.

3. **MFA mode** (triggered by reset response): Shows a TOTP authenticator code input. Submits to `POST /api/auth/magic-link-complete` with the pending token and TOTP code. On success, displays a message directing the user to sign in.

All modes include a "Back to Sign in" link and display success/error messages inline.
