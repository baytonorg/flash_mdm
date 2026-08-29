export const AMAPI_ISSUE_COMMAND_DOCUMENTATION =
  'https://developers.google.com/android/management/reference/rest/v1/enterprises.devices/issueCommand';

export type WorkflowCommandField = {
  key: string;
  label: string;
  input: 'text' | 'textarea';
  placeholder?: string;
  required?: boolean;
};

export const WORKFLOW_AMAPI_COMMANDS = [
  { type: 'LOCK', label: 'Lock Device', fields: [] },
  {
    type: 'RESET_PASSWORD',
    label: 'Reset Password',
    fields: [
      {
        key: 'newPassword',
        label: 'New Password (optional)',
        input: 'text',
        placeholder: 'Optional new password',
      },
    ],
  },
  { type: 'REBOOT', label: 'Reboot', fields: [] },
  { type: 'WIPE', label: 'Factory Reset (Wipe)', fields: [] },
  {
    type: 'CLEAR_APP_DATA',
    label: 'Clear App Data',
    fields: [
      {
        key: 'packageName',
        label: 'Package Name',
        input: 'text',
        placeholder: 'com.example.app',
        required: true,
      },
    ],
  },
  {
    type: 'START_LOST_MODE',
    label: 'Start Lost Mode',
    fields: [
      {
        key: 'lostMessage',
        label: 'Lock Screen Message',
        input: 'textarea',
        placeholder: 'This device has been lost. Please contact...',
      },
      {
        key: 'lostPhoneNumber',
        label: 'Contact Phone Number',
        input: 'text',
        placeholder: '+1234567890',
      },
      {
        key: 'lostEmailAddress',
        label: 'Contact Email',
        input: 'text',
        placeholder: 'admin@example.com',
      },
      {
        key: 'lostStreetAddress',
        label: 'Street Address',
        input: 'textarea',
        placeholder: 'Address where the device can be returned',
      },
      {
        key: 'lostOrganization',
        label: 'Organization (optional)',
        input: 'text',
        placeholder: 'Organization name displayed in lost mode',
      },
    ],
  },
  { type: 'STOP_LOST_MODE', label: 'Stop Lost Mode', fields: [] },
] as const satisfies ReadonlyArray<{
  type: string;
  label: string;
  fields: ReadonlyArray<WorkflowCommandField>;
}>;

export type WorkflowAmapiCommandType = (typeof WORKFLOW_AMAPI_COMMANDS)[number]['type'];

const WORKFLOW_AMAPI_COMMAND_SET = new Set<string>(
  WORKFLOW_AMAPI_COMMANDS.map((command) => command.type)
);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasText(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return hasText((value as Record<string, unknown>).defaultMessage);
}

function hasAnyText(values: unknown[]): boolean {
  return values.some(hasText);
}

export function isWorkflowAmapiCommandType(value: unknown): value is WorkflowAmapiCommandType {
  return typeof value === 'string' && WORKFLOW_AMAPI_COMMAND_SET.has(value);
}

export function validateWorkflowCommandConfig(actionConfig: unknown): string | null {
  const config = asObject(actionConfig);
  const commandType = config.command_type;

  if (typeof commandType !== 'string' || !commandType.trim()) {
    return 'device.command requires action_config.command_type';
  }
  if (!isWorkflowAmapiCommandType(commandType)) {
    return `Unsupported workflow command type: ${commandType}`;
  }

  const commandData = asObject(config.command_data);

  if (commandType === 'CLEAR_APP_DATA') {
    const nested = asObject(commandData.clearAppsDataParams);
    const packageNames = Array.isArray(nested.packageNames) ? nested.packageNames : [];
    if (!hasText(commandData.packageName) && !hasAnyText(packageNames)) {
      return 'CLEAR_APP_DATA requires a package name';
    }
  }

  if (commandType === 'START_LOST_MODE') {
    const nested = asObject(commandData.startLostModeParams);
    const requiredValues = [
      commandData.message,
      commandData.lostMessage,
      nested.lostMessage,
      commandData.phone,
      commandData.lostPhoneNumber,
      nested.lostPhoneNumber,
      commandData.email,
      commandData.lostEmailAddress,
      nested.lostEmailAddress,
      commandData.address,
      commandData.lostStreetAddress,
      nested.lostStreetAddress,
    ];
    if (!hasAnyText(requiredValues)) {
      return 'START_LOST_MODE requires a message, phone number, email address, or street address; organization alone is not sufficient';
    }
  }

  return null;
}
