# `src/api/queries/dashboard.ts`

> React Query hook for fetching dashboard statistics for an environment.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DashboardStats` | `interface` | Open-ended stats object (`Record<string, unknown>`) |
| `dashboardKeys` | `object` | Query key factory: `all` and `data(environmentId)` |
| `useDashboardData` | `(environmentId: string) => UseQueryResult<DashboardStats>` | Fetches dashboard stats for the given environment |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- Simple single-query module. The `select` function extracts `stats` from the response envelope.
- Disabled when `environmentId` is falsy.
