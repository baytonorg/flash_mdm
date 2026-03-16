export const DEVICE_COMMAND_PERMISSION_ACTIONS = {
  standard: 'command',
  destructive: 'command_destructive',
} as const;

const DESTRUCTIVE_DEVICE_COMMANDS = new Set([
  'WIPE',
  'RELINQUISH_OWNERSHIP',
]);

export function isDestructiveDeviceCommand(command: string): boolean {
  return DESTRUCTIVE_DEVICE_COMMANDS.has(command.toUpperCase());
}

export function getDeviceCommandPermissionAction(
  command: string
): typeof DEVICE_COMMAND_PERMISSION_ACTIONS[keyof typeof DEVICE_COMMAND_PERMISSION_ACTIONS] {
  return isDestructiveDeviceCommand(command)
    ? DEVICE_COMMAND_PERMISSION_ACTIONS.destructive
    : DEVICE_COMMAND_PERMISSION_ACTIONS.standard;
}
