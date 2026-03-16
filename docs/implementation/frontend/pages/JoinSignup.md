# `src/pages/JoinSignup.tsx`

> Public signup page for users joining via a signup link, with scope context display and account creation form.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `JoinSignup` | `React.FC` (default) | Signup link registration page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Resolving signup links and registering users |
| `useAuthStore` | `@/stores/auth` | Checking if user is already authenticated |
| `ResolvedSignupLink` | `@/api/queries/signupLinks` | TypeScript type for resolved link data |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `@/constants/auth` | Password validation constraints |

## Key Logic

The page reads a signup link token from the URL params and resolves it via `GET /api/signup-links/resolve/:token` on mount. The resolved link provides scope context (workspace or environment), display name, description, default role, and optionally allowed email domains. The page handles several states:

- **Loading**: Spinner while the link is being resolved.
- **Error/Invalid link**: Error message with a link back to sign-in.
- **Already signed in**: Message with a link to the dashboard.
- **Success (post-registration)**: Confirmation message directing the user to check their email.
- **Registration form**: Collects first name, last name, email, and password. Displays allowed email domains if configured. Submits to `POST /api/auth/register` with the `signup_link_token`. A link to sign in is provided for existing users.
