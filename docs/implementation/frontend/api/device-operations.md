# `src/api/queries/device-operations.ts`

> React Query hooks for listing and cancelling AMAPI device operations (long-running tasks like lock, wipe, etc.).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceOperation` | `interface` | AMAPI operation record with name, done flag, metadata, error, and response |
| `deviceOperationKeys` | `object` | Query key factory: `all` and `list(deviceId)` |
| `useDeviceOperations` | `(deviceId: string) => UseQueryResult<{operations, nextPageToken, unavailable?, message?}>` | Lists operations for a device |
| `useCancelOperation` | `() => UseMutationResult` | Cancels an operation by its AMAPI name; invalidates all operation queries |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- The operations list response may include an `unavailable` flag and `message` when the AMAPI endpoint is not reachable.
- Cancel mutation posts the `operation_name` (AMAPI resource name) to trigger cancellation.
