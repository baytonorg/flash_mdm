# `src/api/queries/workflows.ts`

> React Query hooks for managing automation workflows -- CRUD, toggle enable/disable, bulk operations, and test execution.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ConditionRow` | `interface` | A single condition: field, operator, value |
| `Workflow` | `interface` | Workflow record: trigger type/config, conditions, action type/config, scope, execution stats |
| `WorkflowExecution` | `interface` | Execution record: device, trigger data, status, result, device metadata |
| `CreateWorkflowParams` | `interface` | Parameters for creating a workflow |
| `UpdateWorkflowParams` | `interface` | Parameters for updating a workflow (extends CreateWorkflowParams with id) |
| `workflowKeys` | `object` | Query key factory: `all`, `list(envId)`, `detail(id)` |
| `useWorkflows` | `(environmentId) => UseQueryResult<Workflow[]>` | Lists workflows for an environment |
| `useWorkflow` | `(id) => UseQueryResult<{workflow, recent_executions}>` | Fetches workflow detail with recent execution history |
| `useCreateWorkflow` | `() => UseMutationResult` | Creates a new workflow |
| `useUpdateWorkflow` | `() => UseMutationResult` | Updates a workflow |
| `useDeleteWorkflow` | `() => UseMutationResult` | Deletes a workflow |
| `useToggleWorkflow` | `() => UseMutationResult` | Toggles a workflow enabled/disabled |
| `useBulkWorkflowAction` | `() => UseMutationResult` | Bulk enable, disable, or delete workflows |
| `useTestWorkflow` | `() => UseMutationResult` | Triggers a test execution of a workflow, optionally against a specific device |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Workflows are event-driven automations with a `trigger_type` (e.g., device event), optional `conditions` array for filtering, and an `action_type` with config.
- Scoping supports environment-wide or narrower scope via `scope_type` and `scope_id`.
- `useTestWorkflow` allows manual test execution against a specific `device_id`, returning the resulting `WorkflowExecution`.
- Workflow detail includes `recent_executions` for monitoring and debugging.
- Bulk operations support `enable`, `disable`, and `delete` with flexible selection.
