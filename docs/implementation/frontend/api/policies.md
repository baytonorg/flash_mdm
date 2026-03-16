# `src/api/queries/policies.ts`

> React Query hooks for CRUD on policies, fetching external AMAPI policies, managing policy-to-scope assignments (environment/group/device), setting locks, and bulk operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Policy` | `interface` | Policy record with version number and timestamps |
| `ExternalAmapiPolicyResponse` | `interface` | Raw AMAPI policy JSON plus local policy mapping |
| `PolicyAssignment` | `interface` | Policy-to-scope assignment with lock state |
| `EffectivePolicy` | `interface` | Resolved effective policy for a device, including source scope |
| `policyKeys` | `object` | Query key factory: `all`, `list(envId)`, `detail(id)` |
| `usePolicies` | `(environmentId) => UseQueryResult<Policy[]>` | Lists policies for an environment |
| `usePolicy` | `(id) => UseQueryResult<{policy, components}>` | Fetches policy detail with assigned components |
| `useExternalPolicy` | `(envId, amapiName, enabled?, deviceId?) => UseQueryResult` | Fetches raw AMAPI policy by name, optionally for a specific device |
| `useCreatePolicy` | `() => UseMutationResult` | Creates a new policy |
| `useUpdatePolicy` | `() => UseMutationResult` | Updates a policy; returns new version number |
| `useDeletePolicy` | `() => UseMutationResult` | Deletes a policy |
| `useBulkPolicyAction` | `() => UseMutationResult` | Bulk operations: copy, delete, set_draft, set_production, push_to_amapi |
| `usePolicyAssignments` | `(environmentId) => UseQueryResult<PolicyAssignment[]>` | Lists all policy assignments for an environment |
| `useEffectivePolicy` | `(deviceId) => UseQueryResult<EffectivePolicy>` | Resolves the effective policy for a device through the scope hierarchy |
| `useAssignPolicy` | `() => UseMutationResult` | Assigns a policy to a scope (environment/group/device) with optional locks |
| `useSetPolicyLocks` | `() => UseMutationResult` | Sets lock state and locked sections on a policy assignment |
| `useUnassignPolicy` | `() => UseMutationResult` | Removes a policy assignment from a scope |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Policies use optimistic versioning; `useUpdatePolicy` returns the new `version` number.
- Policy assignment supports hierarchical scoping: `environment` > `group` > `device`. `useEffectivePolicy` resolves which policy applies to a device by walking up the hierarchy, returning the `source` type and id.
- Lock support: assignments can be `locked` with specific `locked_sections`, preventing child scopes from overriding those sections. `useSetPolicyLocks` also invalidates `policy-override` cache.
- Bulk operations support flexible selection via `ids`, `all_matching` with `excluded_ids`, and optional `filters` (status, scenario, search).
- `useExternalPolicy` fetches the raw AMAPI policy representation, useful for debugging what Google sees.
