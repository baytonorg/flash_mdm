# `src/api/queries/rbac.ts`

> React Query hooks for reading and updating the workspace RBAC permission matrix, and clearing custom overrides.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkspaceRole` | `type` | Union: `'viewer' \| 'member' \| 'admin' \| 'owner'` |
| `PermissionMatrix` | `type` | `Record<string, Record<string, WorkspaceRole>>` -- resource -> action -> minimum required role |
| `RbacMatrixMeta` | `interface` | Metadata: ordered lists of roles, resources, and actions |
| `WorkspaceRbacResponse` | `interface` | Full RBAC response: defaults, custom matrix, has_override flag, view scope, can_manage flag, meta |
| `useWorkspaceRbacMatrix` | `(workspaceId?, environmentId?) => UseQueryResult<WorkspaceRbacResponse>` | Fetches the RBAC matrix for a workspace, optionally scoped to an environment |
| `useUpdateWorkspaceRbacMatrix` | `() => UseMutationResult` | Updates the custom permission matrix for a workspace |
| `useClearWorkspaceRbacOverride` | `() => UseMutationResult` | Deletes the custom matrix, reverting to platform defaults |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- The RBAC matrix maps `resource` -> `action` -> minimum `WorkspaceRole` required. The response includes both `defaults` (platform-wide) and `matrix` (workspace custom override).
- `has_override` indicates whether the workspace has customized the default matrix.
- `useClearWorkspaceRbacOverride` sends a DELETE to revert to defaults.
- `can_manage` in the response indicates whether the current user has permission to modify the RBAC matrix.
