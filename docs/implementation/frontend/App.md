# `src/App.tsx`

> Root application component defining all routes, lazy-loaded page components, and route protection guards.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (App) | `() => JSX.Element` | Root component that bootstraps the auth session and renders the route tree |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `ProtectedRoute` | 45-50 | Wrapper that redirects unauthenticated users to `/login`; shows a spinner while auth is loading |
| `GuestRoute` | 52-57 | Wrapper that redirects authenticated users to `/`; shows a spinner while auth is loading |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useAuthStore` | `@/stores/auth` | Reading auth state (`user`, `isLoading`) and calling `fetchSession` |
| `MainLayout` | `@/layouts/MainLayout` | Layout shell for authenticated pages |
| `GuestLayout` | `@/layouts/GuestLayout` | Layout shell for login/register pages |
| `SuperadminLayout` | `@/layouts/SuperadminLayout` | Layout shell for superadmin pages |
| `ErrorBoundary` | `@/components/common/ErrorBoundary` | Top-level error boundary wrapping the entire app |
| `NotFound` | `@/components/common/NotFound` | Catch-all 404 page |

## Key Logic

- **Session bootstrap**: `useEffect` calls `fetchSession` on mount to restore the authenticated session.
- **Code splitting**: All page components are loaded via `React.lazy` for route-based code splitting. Named exports from the Superadmin module use the `.then(m => ({ default: m.X }))` pattern.
- **Route groups**:
  - **Guest routes** (`/login`, `/register`): Wrapped in `GuestRoute` + `GuestLayout`. Authenticated users are redirected away.
  - **Public routes** (`/reset-password`, `/invite/:token`, `/join/w/:token`, `/join/e/:token`, `/signin/enroll`): Accessible regardless of auth state.
  - **Setup route** (`/setup/environment`): Protected but outside `MainLayout`, for the post-registration environment setup wizard.
  - **Protected routes** (main app): Wrapped in `ProtectedRoute` + `MainLayout`. Includes Dashboard, Devices, Policies, Apps, Networks, Enrollment, Groups, Users, Roles, Settings, Audit Log, Workflows, Geofencing, Licenses, Reports, and Enterprise Callback.
  - **Superadmin routes** (`/superadmin/*`): Protected with `SuperadminLayout`. Includes Dashboard, Workspaces, Users, and Stats.
  - **Catch-all**: `*` renders `NotFound`.
- **Suspense**: The entire route tree is wrapped in a `Suspense` boundary with a spinner fallback.
