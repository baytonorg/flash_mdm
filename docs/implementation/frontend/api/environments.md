# `src/api/queries/environments.ts`

> React Query hooks for CRUD on environments, enterprise binding (2-step flow), enterprise upgrade, and device import reconciliation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Environment` | `interface` | Environment record with workspace, enterprise binding info, default policy, and feature flags |
| `environmentKeys` | `object` | Query key factory: `all`, `list(workspaceId)`, `enterpriseUpgradeStatus(envId)` |
| `useEnvironments` | `(workspaceId: string) => UseQueryResult<Environment[]>` | Lists environments for a workspace |
| `useCreateEnvironment` | `() => UseMutationResult` | Creates a new environment in a workspace |
| `useUpdateEnvironment` | `() => UseMutationResult` | Updates environment name or pubsub topic |
| `useDeleteEnvironment` | `() => UseMutationResult` | Deletes an environment |
| `useDeleteEnterprise` | `() => UseMutationResult` | Unbinds/deletes the enterprise from an environment |
| `useGenerateUpgradeUrl` | `() => UseMutationResult` | Generates an enterprise upgrade URL for managed Google Play to Google Workspace migration |
| `useReconcileEnvironmentDeviceImport` | `() => UseMutationResult` | Triggers server-side scan of AMAPI devices and enqueues import jobs |
| `useEnterpriseUpgradeStatus` | `(environmentId?, enabled?) => UseQueryResult` | Fetches enterprise type and upgrade eligibility; staleTime 60s |
| `useBindEnvironmentStep1` | `() => UseMutationResult<{signup_url}>` | Initiates enterprise binding; returns Google signup URL |
| `useBindEnvironmentStep2` | `() => UseMutationResult<{enterprise_name}>` | Completes enterprise binding with the enterprise token |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Enterprise binding is a 2-step flow: Step 1 returns a `signup_url` the user opens in a new tab, Step 2 completes the binding with the resulting `enterprise_token`.
- `useEnterpriseUpgradeStatus` uses a 60-second `staleTime` to avoid excessive checks.
- `useReconcileEnvironmentDeviceImport` returns counts of `devices_found`, `jobs_enqueued`, and `pages_scanned` for feedback.
- `useDeleteEnterprise` posts to the bind endpoint with `action: 'delete_enterprise'`.
