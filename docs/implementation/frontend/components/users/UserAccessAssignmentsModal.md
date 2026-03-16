# `src/components/users/UserAccessAssignmentsModal.tsx`

> Modal for managing a user's workspace role, scoped role, access scope, environment grants, and group grants within a workspace.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `UserAccessAssignmentsModal` | `default function` | Full-screen modal for editing user access assignments |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `open` | `boolean` | Yes | Controls modal visibility |
| `workspaceId` | `string` | Yes | Workspace ID to manage access within |
| `workspaceName` | `string` | No | Display name for the workspace |
| `userId` | `string` | Yes | User ID to manage |
| `userEmail` | `string` | No | Display email for the user |
| `currentUserRole` | `string` | Yes | Role of the currently logged-in user (affects available role options) |
| `currentEnvironmentRole` | `string \| null` | No | Active-environment role of the logged-in user, used to gate scoped owner assignment |
| `isSuperadmin` | `boolean` | Yes | Whether the current user is a superadmin |
| `canManageWorkspaceUsers` | `boolean` | Yes | Whether the current user can manage workspace-level users (controls workspace-role editor visibility) |
| `actingEnvironmentId` | `string \| null` | No | Active environment context for scoped managers |
| `viewerAccessScope` | `'workspace' \| 'scoped'` | No | Current viewer's access scope; hides workspace role detail when viewer is scoped |
| `onClose` | `() => void` | Yes | Callback to close the modal |
| `onSaved` | `() => void` | No | Callback after successful save |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleSave` | 114-136 | Updates role (if changed) then updates access scope, environment IDs, and group IDs |
| `handleRemoveFromWorkspace` | 138-154 | Confirms via `window.confirm`, then removes the user from the workspace entirely |
| `toggleId` | 111-112 | Helper to add/remove an ID from an array |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Fetching environments and groups lists |
| `useRemoveWorkspaceUser`, `useUpdateWorkspaceUserAccess`, `useUpdateWorkspaceUserRole`, `WorkspaceUser` | `@/api/queries/users` | Mutation hooks and type for user management |

## Key Logic

The modal fetches three data sets on open: workspace users (to find the target user), environments (for grant checkboxes), and groups per environment (for hierarchical grant checkboxes). Groups are fetched by iterating over all environments and calling `/api/groups/list` for each.

The form has four sections:

1. **Role** -- one or two selectors depending on caller scope:
   - **Workspace Role**: visible for workspace-level managers.
   - **Scoped Role**: visible for scoped managers and for scoped-access editing.
   Owners/superadmins can assign `owner`; non-owners cannot assign owner.
2. **Scope Mode** -- radio: "workspace-wide" (all environments) or "scoped" (explicit grants only).
3. **Environment Grants** -- checkbox list of all environments in the workspace.
4. **Group Grants** -- checkbox list grouped by environment, with depth-based indentation. Includes a note that direct grants include descendant groups.

A danger zone at the bottom allows removing the user from the workspace entirely (with confirmation). A summary line shows the current assignment count. Feedback messages display success/error states.

## Known Limitation

- In workspace-level edit mode, one scoped role value is applied across all selected scoped grants in that save.
- To give different roles in different environments, admins must manage the user from each environment context separately.
