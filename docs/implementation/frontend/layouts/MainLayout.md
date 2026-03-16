# `src/layouts/MainLayout.tsx`

> Primary authenticated layout with collapsible sidebar navigation, global search, context switcher, impersonation banner, and user menu.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `MainLayout` | `default function` | Full application shell with sidebar, header, and content area |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useAuthStore` | `@/stores/auth` | User session, logout, impersonation state |
| `useContextStore` | `@/stores/context` | Workspace/environment context, `fetchWorkspaces` |
| `useUiStore` | `@/stores/ui` | Sidebar open/close state |
| `apiClient` | `@/api/client` | License settings query, stop impersonation action |
| `ContextSwitcher` | `@/components/common/ContextSwitcher` | Workspace/environment switcher widget |
| `GlobalSearch` | `@/components/common/GlobalSearch` | Cmd+K search modal |
| `BRAND` | `@/lib/brand` | Brand short name for sidebar logo |

## Key Logic

**Sidebar** (15 nav items): Dashboard, Devices, Policies, Applications, Networks, Enrolment, Groups, Users, Roles, Geofencing, Audit Log, Workflows, Licences, Reports, Settings. The "Licences" item is conditionally hidden based on a workspace licensing settings query (`/api/licenses/settings`). A "Superadmin" link appears if `user.is_superadmin` is true.

The sidebar is responsive: on mobile it slides in as an overlay (with backdrop) triggered by a hamburger button; on desktop it toggles between 64px (icons only) and 256px (full) widths. The `ContextSwitcher` is rendered in the sidebar below the logo.

**Header**: contains the sidebar toggle button and a global search trigger button with Cmd/Ctrl+K shortcut. The `GlobalSearch` modal is opened via state or keyboard shortcut.

**Impersonation banner**: when `user.impersonation.active` is true, an amber banner shows the impersonated user's email, mode (read-only or full), ticket ref, reason, and a "Return to Superadmin" button that POSTs to `/api/superadmin/actions`.

**Initialization**: `useEffect` calls `fetchSession()` and `fetchWorkspaces()` on mount. A second `useEffect` redirects to `/setup/environment` if `user.needs_environment_setup` is true.

**BrandMark**: internal sub-component rendering the favicon SVG and brand short name, with a `compact` prop for icon-only mode.
