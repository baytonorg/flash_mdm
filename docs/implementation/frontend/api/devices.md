# `src/api/queries/devices.ts`

> React Query hooks for listing, viewing, commanding, deleting, and performing bulk actions on managed devices.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Device` | `interface` | Device record with id, environment_id, name, state, ownership, optional group/policy ids |
| `DeviceListParams` | `interface` | List query params: environment_id, pagination, search, state/ownership/group filters, sort |
| `deviceKeys` | `object` | Query key factory: `all`, `list(params)`, `detail(id)` |
| `useDevices` | `(params: DeviceListParams) => UseQueryResult<{devices, total, page, per_page}>` | Paginated device list with 5s polling |
| `useDevice` | `(id: string) => UseQueryResult<{device, applications, status_reports, locations, audit_log}>` | Single device detail with 5s polling |
| `useDeviceCommand` | `() => UseMutationResult` | Sends a command (lock, reboot, wipe, etc.) to a device; invalidates detail and list |
| `useDeleteDevice` | `() => UseMutationResult` | Deletes a device; invalidates all device queries |
| `useDeviceBulkAction` | `() => UseMutationResult` | Performs bulk actions on multiple devices by ids |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `../client` | HTTP requests |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `buildDeviceListQuery` | 75-87 | Builds URLSearchParams from `DeviceListParams` for the list endpoint |

## Key Logic

- Both `useDevices` and `useDevice` poll every 5 seconds (`refetchInterval: 5000`, `refetchIntervalInBackground: true`) to keep device state fresh.
- Device list supports filtering by state, ownership, group, and free-text search, plus configurable sort column and direction.
- `useDeviceCommand` accepts a `command_type` and optional `params` object for commands like lock, reboot, wipe, password reset, etc.
- `useDeviceBulkAction` sends an array of `device_ids` with an `action` string for batch operations.
