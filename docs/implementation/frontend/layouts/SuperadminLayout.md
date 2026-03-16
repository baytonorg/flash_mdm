# `src/layouts/SuperadminLayout.tsx`

> Dark-themed layout for the superadmin panel with access gating, dedicated sidebar navigation, and a "Back to Console" link.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SuperadminLayout` | `default function` | Superadmin shell with dark sidebar, header, and content area |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useAuthStore` | `@/stores/auth` | User session and `is_superadmin` check |
| `BRAND` | `@/lib/brand` | Brand short name in sidebar |

## Key Logic

**Access gating**: if `isLoading`, shows a centered spinner. If `user.is_superadmin` is false, redirects to `/` via `<Navigate to="/" replace />`.

**Sidebar** (dark `bg-gray-900` theme): displays the brand name with a red "Superadmin" badge. Four navigation items: Dashboard (`/superadmin`), Workspaces (`/superadmin/workspaces`), Users (`/superadmin/users`), and Platform Stats (`/superadmin/stats`). Active links use `bg-gray-800 text-white`; inactive use `text-gray-400`. A "Back to Console" button at the bottom navigates to `/`. The current user's email is shown below.

**Responsive behaviour**: on mobile, the sidebar is hidden by default and slides in via a hamburger menu button in the header. A backdrop overlay closes it on click. On desktop, the sidebar is always visible.

**Header**: dark-themed (`bg-gray-900`) with a "Superadmin Panel" title and mobile menu button.
