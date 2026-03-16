# `src/api/queries/networks.ts`

> React Query hooks for deploying, updating, deleting, and bulk-managing Wi-Fi and APN network configurations with AMAPI policy sync.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `NetworkDeployment` | `interface` | Network deployment record: type (wifi/apn), SSID, auto-connect, scope, ONC profile JSON |
| `NetworkAmapiSync` | `interface` | AMAPI sync result: attempted/synced/failed counts with per-policy failure details |
| `networkKeys` | `object` | Query key factory: `deployments(environmentId)` |
| `useNetworkDeployments` | `(environmentId) => UseQueryResult<NetworkDeployment[]>` | Lists network deployments for an environment |
| `useDeployNetwork` | `() => UseMutationResult` | Creates a network deployment; returns deployment + AMAPI sync result |
| `useUpdateNetworkDeployment` | `() => UseMutationResult` | Updates a network deployment |
| `useDeleteNetworkDeployment` | `() => UseMutationResult` | Deletes a network deployment |
| `useBulkNetworkAction` | `() => UseMutationResult` | Bulk delete network deployments |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | HTTP requests |

## Key Logic

- Network deployments support both `wifi` and `apn` types, stored as ONC (Open Network Configuration) profiles.
- All mutations return an `amapi_sync` object showing how many AMAPI policies were updated, which is useful for UI feedback.
- Mutations invalidate `networks`, `policies`, and `devices` caches because network configs are embedded in AMAPI policies.
- Scoping options: `environment`, `group`, or `device` level.
