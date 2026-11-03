# `src/pages/JoinSignup.tsx`

> Public signup page for users joining via a signup link, with configured public context and an account creation form.

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

## Key Logic

The page reads a signup link token from the URL params and resolves it via `GET /api/signup-links/resolve/:token` on mount. The resolved link provides scope context (workspace or environment), display name, description, default role, and optionally allowed email domains. The page handles several states:

- **Loading**: Spinner while the link is being resolved.
- **Error/Invalid link**: Error message with a link back to sign-in.
- **Already signed in**: Message with a link to the dashboard.
- **Success (post-registration)**: Confirmation message directing the user to check their email.
- **Registration form**: Displays the configured signup-link display name and description, then collects first name, last name, and email. Workspace/environment names, role, assignment details, and allowed email domains remain hidden. Submits to `POST /api/auth/register` with the `signup_link_token`; the registration flow sends a magic sign-in link.

While mounted, the page adds a `robots` meta directive with `noindex, nofollow, noarchive`. Hosting configuration also sends the equivalent `X-Robots-Tag` header for every `/join/*` path so crawlers receive the directive without executing JavaScript.
