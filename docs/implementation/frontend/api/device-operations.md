# `src/api/queries/device-operations.ts`

> React Query hooks for listing and cancelling AMAPI device operations (long-running tasks like lock, wipe, etc.).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceOperation` | `interface` | AMAPI operation record with name, done flag, metadata, error, and response |
| `deviceOperationKeys` | `object` | Query key factory: `all` and `list(deviceId)` |
| `useDeviceOperations` | `(deviceId: string) => infinite query result with flattened operations` | Lists persistent and AMAPI operations and loads older pages |
| `useCancelOperation` | `() => UseMutationResult` | Cancels an operation by its AMAPI name; invalidates all operation queries |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Key Logic

- The operations list response may include an `unavailable` flag and `message` when the AMAPI endpoint is not reachable.
- The hook follows `nextPageToken` through `fetchNextPage`, flattens pages, and deduplicates operation names.
- Ledger rows expose reconciliation state and page progress even when live AMAPI history is unavailable.
- Cancel mutation posts the `operation_name` (AMAPI resource name) to trigger cancellation.
