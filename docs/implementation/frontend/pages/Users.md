# `src/pages/Users.tsx`

> Workspace user management page with invite flow, access assignment editing, and bulk operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Users` | `React.FC` (default) | Users management page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `timeAgo` | 19-43 | Converts a date string to a human-readable relative time (e.g. "5m ago") |
| `RoleBadge` | 44-56 | Renders a color-coded role badge (owner/admin/member/viewer) |
| `accessSummary` | 57-108 | Returns a text summary of a user's access scope (workspace-wide or scoped with counts) |
| `InviteModal` | 109-441 | Modal dialog for inviting users with scope selection (workspace/environment/group) |
| `Users` | 442 | Main page component with user table, bulk actions, and modals |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Active workspace, environment, and group |
| `apiClient` | `@/api/client` | API calls for environment and group data |
| `useWorkspaceUsers`, `useInviteUser`, `useBulkWorkspaceUsersAction`, `WorkspaceUser` (type) | `@/api/queries/users` | User list, invite, and bulk action hooks |
| `useGroups`, `Group` (type) | `@/api/queries/groups` | Group data for invite scope |
| `useAuthStore` | `@/stores/auth` | Current user info for permission checks |
| `DataTable`, `ColumnDef` (type) | `@/components/common/DataTable` | Sortable data table |
| `BulkActionBar`, `BulkAction` (type) | `@/components/common/BulkActionBar` | Floating bulk action toolbar |
| `SelectAllMatchingNotice` | `@/components/common/SelectAllMatchingNotice` | "Select all matching" notice |
| `UserAccessAssignmentsModal` | `@/components/users/UserAccessAssignmentsModal` | Per-user access editing modal |
| `useBulkSelection` | `@/hooks/useBulkSelection` | Checkbox selection state |

## Key Logic

The page lists workspace users in a `DataTable` with columns for name/avatar, email, role, access assignment summary, join date, and a "Manage Access" action button (visible to owners/admins).  
For scoped users with different workspace vs environment role values, the role display is context-aware:
- workspace managers can see split `Env` / `Ws` role badges;
- scoped viewers only see the scoped/effective role.
The current user is excluded from selection and action targets.

The **InviteModal** supports three scope modes:
- **Workspace-wide**: Available to owners and workspace-scoped admins.
- **Environment**: Scopes the invite to the currently active environment.
- **Group**: Scopes the invite to a specific group (with descendant inheritance) selected from a dropdown sorted by depth.

Role options are dynamically filtered based on the inviter's role and scope. The modal auto-selects the most appropriate scope mode based on context.

**Bulk actions** include:
- **Bulk Access Edit**: Opens a modal to overwrite access scope (workspace-wide or scoped), role, environment grants, and group grants for all selected users.
- **Remove from Workspace**: Removes selected users with confirmation.

Per-user access is managed through `UserAccessAssignmentsModal` which opens when "Manage Access" is clicked. Permission to manage users is restricted to superadmins, owners, and admins.

## Known Limitation

- A workspace-level save applies one scoped role value across all selected scoped grants in that update.
- To assign different roles per environment for the same user, admins must switch to each environment and apply scoped-role changes per environment.
