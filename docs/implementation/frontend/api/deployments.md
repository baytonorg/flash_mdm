# `src/api/queries/deployments.ts`

> React Query hooks for creating, monitoring, cancelling, and rolling back policy deployment jobs.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeploymentJob` | `interface` | Deployment job record with status, device counts, error log, and timestamps |
| `useDeploymentJob` | `(jobId: string \| null) => UseQueryResult<{job}>` | Fetches a single deployment job; polls every 2s while status is pending/running/rolling_back |
| `useDeploymentJobs` | `(environmentId: string) => UseQueryResult<{jobs}>` | Lists all deployment jobs for an environment |
| `useCreateDeployment` | `() => UseMutationResult` | Creates a new deployment for a policy; invalidates the jobs list |
| `useCancelDeployment` | `() => UseMutationResult` | Cancels a running deployment job |
| `useRollbackDeployment` | `() => UseMutationResult` | Rolls back a completed deployment job |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | HTTP requests |

## Key Logic

- `useDeploymentJob` uses a dynamic `refetchInterval` callback: it polls every 2 seconds while the job is in `pending`, `running`, or `rolling_back` status, and stops polling once the job reaches a terminal state.
- Deployment statuses include: `pending`, `running`, `completed`, `failed`, `cancelled`, `rolling_back`, `rolled_back`, `rollback_failed`.
- Cancel and rollback use the same `/api/deployments` endpoint with an `action` query parameter.
