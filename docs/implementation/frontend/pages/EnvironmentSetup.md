# `src/pages/EnvironmentSetup.tsx`

> Post-registration setup wizard for creating an environment and optionally binding an Android Enterprise.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnvironmentSetup` | `React.FC` (default) | Environment setup wizard page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useAuthStore` | `@/stores/auth` | Accessing current user and session management |
| `useContextStore` | `@/stores/context` | Fetching workspaces and environments after creation |
| `useCreateEnvironment`, `useBindEnvironmentStep1` | `@/api/queries/environments` | Creating an environment and initiating enterprise binding |
| `apiClient` | `@/api/client` | Clearing the setup flag via session endpoint |

## Key Logic

The page implements a two-step wizard shown to newly registered users. Step 1 ("name") collects an environment name and creates it via `useCreateEnvironment` using the user's workspace ID. Step 2 ("bind") offers to bind an Android Enterprise via `useBindEnvironmentStep1`, which returns a Google signup URL and redirects the browser to it. The user can skip binding. A progress indicator shows the current step. On completion (or skip), the page calls `POST /api/auth/session` with `clear_environment_setup: true` to dismiss the setup flag, refreshes the session and workspace data, then navigates to the dashboard.
