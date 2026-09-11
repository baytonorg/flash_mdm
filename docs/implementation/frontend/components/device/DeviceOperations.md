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
| `getOperationStatus` | helper | Derives AMAPI and ledger states, including uncertain, reconciling, and unresolved |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useDeviceOperations` | `@/api/queries/device-operations` | Fetching the list of operations for the device |
| `useCancelOperation` | `@/api/queries/device-operations` | Mutation hook to cancel a running operation |

## Key Logic

The component renders the merged persistent/AMAPI history with explicit delivery-uncertain, reconciling, and unresolved badges. It shows the number of read-only pages scanned and states that the command was never replayed. A Load older operations control follows AMAPI continuation tokens. Live AMAPI failures leave persistent ledger rows visible. Only real running AMAPI operation names expose cancellation.
