# `netlify/functions/_lib/device-command-permissions.ts`

> Maps device commands to permission actions, distinguishing standard commands from destructive ones.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DEVICE_COMMAND_PERMISSION_ACTIONS` | `{ standard: 'command'; destructive: 'command_destructive' }` | Permission action constants for standard and destructive device commands |
| `isDestructiveDeviceCommand` | `(command: string) => boolean` | Returns true if the command is classified as destructive (`WIPE` or `RELINQUISH_OWNERSHIP`) |
| `getDeviceCommandPermissionAction` | `(command: string) => 'command' \| 'command_destructive'` | Returns the appropriate permission action string for a given command type |

## Key Logic

Commands are classified into two permission tiers:

- **Destructive** (`command_destructive`): `WIPE` and `RELINQUISH_OWNERSHIP` -- these commands cause irreversible data loss or ownership changes.
- **Standard** (`command`): All other commands (e.g., `LOCK`, `REBOOT`, `RESET_PASSWORD`).

This classification is used by the RBAC system to require elevated permissions for destructive operations. Command comparison is case-insensitive (uppercased before lookup).
