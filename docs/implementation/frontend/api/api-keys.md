# `src/api/queries/api-keys.ts`

> React Query hooks for listing, creating, and revoking API keys scoped to workspaces or environments.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ApiKeyRecord` | `interface` | Shape of an API key record (id, name, scope, role, token prefix, timestamps, etc.) |
| `useWorkspaceApiKeys` | `(workspaceId?: string) => UseQueryResult<ApiKeyRecord[]>` | Fetches API keys for a workspace |
| `useEnvironmentApiKeys` | `(environmentId?: string) => UseQueryResult<ApiKeyRecord[]>` | Fetches API keys for an environment |
| `useCreateApiKey` | `() => UseMutationResult` | Creates a new API key; invalidates the relevant workspace or environment key list on success |
| `useRevokeApiKey` | `() => UseMutationResult` | Revokes an API key by id; invalidates the relevant key list on success |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Query keys are structured as `['api-keys', 'workspace'|'environment', id]` for targeted cache invalidation.
- `useCreateApiKey` accepts `scope_type`, optional `role`, `name`, and `expires_in_days`. On success it invalidates the cache for the matching scope.
- `useRevokeApiKey` posts only the key `id` but accepts `workspace_id`/`environment_id` in the mutation params for cache invalidation.
