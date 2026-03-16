# `src/pages/InviteAccept.tsx`

> Invite acceptance page handling both workspace and platform invitations, with inline registration for new users.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `InviteAccept` | `React.FC` (default) | Invite acceptance page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Fetching invite info and accepting invites |
| `useAuthStore` | `@/stores/auth` | Accessing current user session and logout |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `@/constants/auth` | Password validation constraints |

## Key Logic

The page reads an invite token from the URL params and fetches invite details (`GET /api/invites/:token`) on mount, displaying the workspace name, invite type (workspace or platform), role, email, and inviter name. The flow branches based on auth state:

- **Logged-in user with matching email**: Auto-accepts the invite via `POST /api/invites/:token/accept` and redirects to the dashboard.
- **Logged-in user with different email**: Shows a warning and offers to sign out or sign in as the invited user.
- **Platform invite (no user)**: Redirects to the full registration page since workspace creation is required.
- **Workspace invite (no user)**: Renders an inline registration form (first name, last name, password) that calls `POST /api/auth/register` with the invite's email and a `redirect_path` back to this page. If the API sets a session cookie, the page reloads; otherwise, a fallback message directs the user to sign in.

Error states, loading indicators, and expired/invalid invite handling are all covered.
