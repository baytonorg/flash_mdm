# `src/pages/Register.tsx`

> User registration page supporting self-serve and invite-based onboarding with workspace creation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Register` | `React.FC` (default) | Registration page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | API calls for auth config, invite lookup, and registration |
| `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` | `@/constants/auth` | Password validation constraints |
| `redirectBrowserToInApp`, `sanitizeInAppRedirect` | `@/lib/redirect` | Safe redirect handling after registration |

## Key Logic

On mount, the page fetches `/api/auth/config` to check if registration is invite-only. If invite-only and no invite redirect is present, a message is shown directing the user to request an invitation.

When the URL contains a `redirect` query param starting with `/invite/`, the page enters invite onboarding mode. It fetches the invite details from `/api/invites/{token}` to determine the invite type (`workspace_access` or `platform_access`). For workspace access invites, the workspace name field is hidden since the user will join an existing workspace.

The registration form collects first name, last name, email, password, and optionally workspace name. On submit, it calls `/api/auth/register` with the form data and redirect path. If the response includes `session_set: true`, the page performs a full browser redirect (to pick up the session cookie). Otherwise, it shows a success message directing the user to check their email for a sign-in link.

Password validation enforces minimum and maximum length constraints from the `@/constants/auth` module.
