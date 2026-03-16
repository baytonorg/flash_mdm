# `src/pages/Roles.tsx`

> RBAC permission matrix editor with role-first and raw matrix views for workspace-level access control.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Roles` | `React.FC` (default) | Roles and RBAC management page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `cloneMatrix` | 66-68 | Deep clones a permission matrix via JSON round-trip |
| `matrixEqual` | 70-73 | Compares two permission matrices for equality |
| `titleCase` | 75-77 | Converts snake_case to Title Case |
| `isRoleAllowedForThreshold` | 79-81 | Checks if a role meets or exceeds a minimum role threshold |
| `nextHigherRole` | 83-87 | Returns the next role up in the hierarchy |
| `permissionStatus` | 89-91 | Returns "Active" or "Defined" based on whether a permission is actively enforced |
| `statusBadgeClasses` | 93-97 | Returns CSS classes for Active/Defined status badges |
| `getRoleLedActionSets` | 99-104 | Splits actions into standard (read/write/delete) and advanced groups |
| `Roles` | 106-581 | Main page component with role view and matrix view |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useAuthStore` | `@/stores/auth` | Current user info for superadmin check |
| `useContextStore` | `@/stores/context` | Active workspace and environment |
| `useWorkspaceRbacMatrix`, `useUpdateWorkspaceRbacMatrix`, `useClearWorkspaceRbacOverride`, `PermissionMatrix` (type), `WorkspaceRole` (type) | `@/api/queries/rbac` | RBAC matrix CRUD hooks and types |

## Key Logic

The page loads the workspace RBAC permission matrix from the API, which includes the effective matrix, platform defaults, and metadata (roles, resource order, action order). Owners and superadmins can edit; other roles see a read-only view.

Two view modes are available:

1. **Role View**: Displays a card per role (owner, admin, member, viewer) showing what each role can do per resource. Each resource section lists standard actions (read, write, delete) as checkboxes and expandable advanced actions (manage_users, manage_settings, etc.). Toggling a checkbox adjusts the minimum role threshold for that permission.

2. **Raw Matrix View**: Displays resource cards with dropdown selectors for each action's minimum role threshold. Modified cells are highlighted.

The toolbar shows the count of thresholds changed from defaults, and provides buttons to reset to defaults, revert unsaved changes, clear the workspace override entirely, and save. Each permission is tagged as "Active" (enforced in the backend) or "Defined" (present in the matrix but not yet wired to authorization).

The `MATRIX_ACTIVE_PERMISSIONS` set tracks which resource:action pairs are actively enforced. A role level hierarchy (viewer=25, member=50, admin=75, owner=100) governs inheritance -- higher roles automatically inherit lower-role permissions.
