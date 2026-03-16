# `src/components/device/CommandModal.tsx`

> Modal dialog for sending AMAPI device management commands (single or bulk) with command-specific input fields and confirmation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `CommandModal` | `default function` | Renders the command modal overlay |
| `CommandModalProps` | `interface` | Props type for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `open` | `boolean` | Yes | Controls modal visibility |
| `onClose` | `() => void` | Yes | Callback when the modal is dismissed |
| `deviceId` | `string` | No | Single device target ID |
| `deviceIds` | `string[]` | No | Array of device IDs for bulk operations |
| `deviceName` | `string` | No | Display name for the target device |
| `initialCommand` | `string` | No | Pre-selects a command (hides the dropdown, used for quick-action buttons) |
| `onSuccess` | `() => void` | No | Callback fired after a command succeeds |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `toggleWipeFlag` | 294-301 | Toggles a wipe data flag in/out of the `wipeDataFlags` state set |
| `handleClose` | 269-276 | Resets all local state and calls `onClose` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | Sending POST requests to `/api/devices/command` and `/api/devices/bulk` |

## Key Logic

The component maintains local state for the selected command, dynamic field values, and wipe-specific flags. It derives whether the operation is bulk from `deviceIds` and filters available commands accordingly (e.g., `DELETE` is `bulkOnly`). A `useMutation` from TanStack Query handles the API call -- posting to `/api/devices/bulk` for multi-device operations or `/api/devices/command` for single devices. On success, a green confirmation banner is shown for 2 seconds before auto-closing. The modal supports 14 command options (LOCK, REBOOT, RESET_PASSWORD, START/STOP_LOST_MODE, RELINQUISH_OWNERSHIP, CLEAR_APP_DATA, REQUEST_DEVICE_INFO, ADD/REMOVE_ESIM, DISABLE, ENABLE, WIPE, DELETE), each with optional dynamic form fields and danger-level styling. The WIPE command additionally renders checkbox options for `wipeDataFlags` (preserve reset protection, wipe external storage, remove eSIMs). Escape key and overlay click dismiss the modal.
