# `src/stores/context.ts`

> Zustand store managing the active workspace, environment, and group selection hierarchy with localStorage persistence.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `useContextStore` | `UseBoundStore<StoreApi<ContextState>>` | Zustand hook providing workspace/environment/group context and actions |

## Internal Types

| Name | Description |
|------|-------------|
| `Workspace` | Workspace object with GCP project info, credentials flag, and user role |
| `Environment` | Environment belonging to a workspace, with enterprise binding and user role |
| `Group` | Hierarchical group within an environment |
| `SavedContext` | Shape persisted to localStorage: `workspaceId`, `environmentId`, `groupId` |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `loadSaved` | 41-48 | Reads and parses the `flash_context` key from localStorage, returning `{}` on failure |
| `saveContext` | 50-60 | Writes workspace/environment/group IDs to localStorage as JSON |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Fetching workspaces, environments, and groups from the API |

## Key Logic

- **Three-level hierarchy**: Workspace > Environment > Group. Switching a higher level clears all lower selections.
- **Persistence**: Current selection is saved to `localStorage` under the `flash_context` key. On initial `fetchWorkspaces`, saved IDs are restored if they still exist in the fetched data.
- **Auto-selection**: If no saved context exists, the first workspace is selected automatically. When a workspace or environment has exactly one child, that child is auto-selected.
- **`fetchWorkspaces`**: Fetches workspaces, restores saved context (workspace, then environment, then group), and cascades down the hierarchy.
- **`switchWorkspace`**: Sets active workspace, clears environments/groups, fetches environments, and auto-selects if only one exists.
- **`switchEnvironment`**: Sets active environment, clears groups, fetches groups, and auto-selects if only one exists.
- **`switchGroup`**: Sets active group; passing a falsy ID clears the group selection.
- **Refresh safety**: `fetchWorkspaces` and `fetchEnvironments` preserve the current active selection if it still exists in the refreshed data.
