# `src/stores/auth.ts`

> Zustand store managing user authentication state, login/logout flows, and session lifecycle.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `useAuthStore` | `UseBoundStore<StoreApi<AuthState>>` | Zustand hook providing auth state and actions |

## Internal Types

| Name | Description |
|------|-------------|
| `User` | Shape of the authenticated user object, including impersonation metadata |
| `AuthState` | Full store interface: `user`, `isLoading`, `error`, and all auth action methods |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Making HTTP requests to auth API endpoints |

## Key Logic

- **Session bootstrap**: `fetchSession` calls `GET /api/auth/session`. On success, stores the user; on failure, clears user without setting an error (session simply not present).
- **Login**: `login` posts email, password, and optional TOTP code to `/api/auth/login`. Stores user on success; sets `error` and re-throws on failure.
- **Magic link flow**: Two-step process -- `loginWithMagicLink` triggers the email via `/api/auth/magic-link-start`, then `completeMagicLinkMfa` exchanges the token and TOTP code via `/api/auth/magic-link-complete`.
- **Logout**: `logout` posts to `/api/auth/logout`, then unconditionally clears the `flash_context` localStorage key and nulls the user (even if the API call fails).
- **Impersonation**: The `User` type includes an `impersonation` block with mode (`full` or `read_only`), originating user info, and support ticket metadata.
- **Initial state**: `isLoading` starts as `true` so consuming components can show a loading spinner until `fetchSession` completes.
