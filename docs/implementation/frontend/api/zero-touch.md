# `src/api/queries/zero-touch.ts`

> React Query hooks for zero-touch provisioning configuration: fetching options, creating iframe tokens, and creating enrollment tokens.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ZeroTouchGroupOption` | `interface` | Group option shape: `{ id, name }` |
| `ZeroTouchTokenOption` | `interface` | Token option shape: `{ id, name, group_id, group_name, one_time_use, allow_personal_usage, expires_at, amapi_value }` |
| `ZeroTouchOptionsResponse` | `interface` | Response shape: `{ environment, groups, active_tokens }` |
| `zeroTouchKeys` | `object` | Query key factory: `all`, `options(environmentId)` |
| `useZeroTouchOptions` | `(environmentId?) => UseQueryResult` | Fetches environment context, groups, and active enrollment tokens |
| `useZeroTouchIframeToken` | `() => UseMutationResult` | Creates a zero-touch iframe web token for the embedded Google zero-touch portal |
| `useZeroTouchCreateEnrollmentToken` | `() => UseMutationResult` | Creates an enrollment token for zero-touch binding; invalidates zero-touch options and enrollment token queries |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | HTTP requests |
| `enrollmentKeys` | `@/api/queries/enrollment` | Invalidating enrollment token queries on token creation |
