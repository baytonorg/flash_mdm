# `src/api/queries/groups.ts`

> React Query hooks for managing hierarchical device groups with parent-child relationships, including CRUD and bulk operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Group` | `interface` | Group record with parent_id, depth, optional policy assignment |
| `groupKeys` | `object` | Query key factory: `all`, `list(envId)`, `descendants(groupId)` |
| `useGroups` | `(environmentId: string) => UseQueryResult<Group[]>` | Lists groups for an environment; normalizes parent_id/parent_group_id |
| `useGroupDescendants` | `(groupId: string) => UseQueryResult<Group[]>` | Lists all descendants of a group |
| `useCreateGroup` | `() => UseMutationResult` | Creates a group; invalidates groups, devices, policies, enrollment caches |
| `useUpdateGroup` | `() => UseMutationResult` | Updates a group (name, parent); invalidates groups, devices, policies, enrollment |
| `useDeleteGroup` | `() => UseMutationResult` | Deletes a group; invalidates groups, devices, policies, enrollment |
| `useBulkGroupAction` | `() => UseMutationResult` | Bulk delete or move groups with selection/exclusion support |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Groups form a hierarchy via `parent_id` / `parent_group_id`. The `select` transform normalizes both fields for backward compatibility.
- All mutations (create, update, delete, bulk) aggressively invalidate `groups`, `devices`, `policies`, and `enrollment` caches because group changes affect policy resolution and enrollment token scoping.
- Bulk operations support `delete` and `move` with `target_parent_id` and `clear_direct_assignments` options.
