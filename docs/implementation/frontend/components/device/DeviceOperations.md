# `src/components/device/DeviceOperations.tsx`

> Displays a list of AMAPI long-running operations for a device with status indicators and the ability to cancel in-progress operations.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceOperations` | `default function` | Renders the device operations list |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `deviceId` | `string` | Yes | The device ID to fetch operations for |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `formatOperationName` | 9-14 | Extracts the operation ID from a full AMAPI resource name |
| `getOperationStatus` | 16-20 | Derives status (`'error'`, `'done'`, or `'running'`) from operation fields |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useDeviceOperations` | `@/api/queries/device-operations` | Fetching the list of operations for the device |
| `useCancelOperation` | `@/api/queries/device-operations` | Mutation hook to cancel a running operation |

## Key Logic

The component uses `useDeviceOperations` to fetch operations from the API and renders each one in a bordered list with status icons (green checkmark for done, spinning loader for in-progress, warning triangle for error). In-progress operations show a "Cancel" button that triggers `useCancelOperation`. The component handles loading, error, and "unavailable" states with appropriate UI messages. Operation metadata (type, creation time) is displayed when available. Error details show the error code and message.
