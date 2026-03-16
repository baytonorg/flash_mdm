# `src/api/queries/workspaces.ts`

> React Query hooks for listing, creating, updating workspaces, and setting Google service account credentials.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Workspace` | `interface` | Workspace record with id, name, owner_id, timestamps |
| `workspaceKeys` | `object` | Query key factory: `all` and `list()` |
| `useWorkspaces` | `() => UseQueryResult<Workspace[]>` | Lists all workspaces accessible to the current user |
| `useCreateWorkspace` | `() => UseMutationResult` | Creates a new workspace |
| `useUpdateWorkspace` | `() => UseMutationResult` | Updates a workspace (name, etc.) |
| `useSetWorkspaceSecrets` | `() => UseMutationResult` | Uploads Google service account credentials JSON for the workspace |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- `useWorkspaces` has no `enabled` guard -- it always fetches, since it is called after authentication.
- `useSetWorkspaceSecrets` accepts `workspace_id` and `google_credentials_json` (as a string) for configuring the Google AMAPI service account used for enterprise management.
- All mutations invalidate the workspace list cache on success.
