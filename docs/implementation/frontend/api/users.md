# `src/api/queries/users.ts`

> React Query hooks for managing workspace users -- listing, inviting, updating roles/access, removing, and bulk operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkspaceUser` | `interface` | User record with role, access_scope, environment/group assignments, invite/join timestamps |
| `userKeys` | `object` | Query key factory: `all` and `list(workspaceId)` |
| `useWorkspaceUsers` | `(workspaceId: string) => UseQueryResult<WorkspaceUser[]>` | Lists all users in a workspace |
| `useInviteUser` | `() => UseMutationResult` | Invites a user by email with optional role and environment/group assignments |
| `useUpdateWorkspaceUserAccess` | `() => UseMutationResult` | Updates a user's access scope (workspace-wide or scoped), optional scoped role, and environment/group assignments |
| `useUpdateWorkspaceUserRole` | `() => UseMutationResult` | Updates a user's workspace role |
| `useRemoveWorkspaceUser` | `() => UseMutationResult` | Removes a user from the workspace |
| `useBulkWorkspaceUsersAction` | `() => UseMutationResult` | Bulk remove or overwrite access for multiple users |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Users have two layers of access control: a workspace `role` (viewer/member/admin/owner) and an `access_scope` that is either `workspace`-wide or `scoped` to specific environments and groups.
- `useUpdateWorkspaceUserAccess` accepts optional `scoped_role` so environment/group membership role can differ from workspace membership role.
- `useInviteUser` sends an invitation email and optionally pre-assigns environment/group access.
- `useRemoveWorkspaceUser` sends the user_id as a URL path param and workspace_id as a query param.
- Bulk operations support `remove` and `access_overwrite` with flexible selection/exclusion and optional role/scope options.
