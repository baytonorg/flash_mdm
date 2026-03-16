# `src/api/queries/components.ts`

> React Query hooks for managing reusable policy components (config fragments) that can be assigned to policies with priority ordering.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyComponent` | `interface` | A reusable config fragment with name, category, and JSON config |
| `ComponentAssignment` | `interface` | A component assigned to a policy, including priority and assignment metadata |
| `componentKeys` | `object` | Query key factory: `all`, `list(envId)`, `detail(id)`, `policyAssignments(policyId)` |
| `useComponents` | `(environmentId) => UseQueryResult<PolicyComponent[]>` | Lists all components for an environment |
| `useComponent` | `(id) => UseQueryResult<PolicyComponent>` | Fetches a single component by id |
| `usePolicyComponents` | `(policyId) => UseQueryResult<ComponentAssignment[]>` | Lists components assigned to a specific policy |
| `useCreateComponent` | `() => UseMutationResult` | Creates a new component; invalidates environment list |
| `useUpdateComponent` | `() => UseMutationResult` | Updates a component; invalidates detail and all lists |
| `useDeleteComponent` | `() => UseMutationResult` | Deletes a component; invalidates all component queries |
| `useAssignComponent` | `() => UseMutationResult` | Assigns a component to a policy with optional priority; invalidates policy assignments |
| `useUnassignComponent` | `() => UseMutationResult` | Removes a component assignment from a policy |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | HTTP requests |

## Key Logic

- Components are reusable JSON config fragments categorized by type (e.g., security, apps, networking).
- Assignment and unassignment mutations invalidate both the component-policy assignments cache and the parent policy cache.
- Components support priority ordering when assigned to a policy.
