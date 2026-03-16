export const AMAPI_ISSUE_COMMAND_TYPES = [
  'LOCK',
  'RESET_PASSWORD',
  'REBOOT',
  'RELINQUISH_OWNERSHIP',
  'CLEAR_APP_DATA',
  'START_LOST_MODE',
  'STOP_LOST_MODE',
  'ADD_ESIM',
  'REMOVE_ESIM',
  'REQUEST_DEVICE_INFO',
  'WIPE',
] as const;

export const PATCH_STATE_COMMAND_TYPES = [
  'DISABLE',
  'ENABLE',
] as const;

export const DEVICE_COMMAND_TYPES = [
  ...AMAPI_ISSUE_COMMAND_TYPES,
  ...PATCH_STATE_COMMAND_TYPES,
] as const;

export const BULK_DEVICE_COMMAND_TYPES = [
  ...DEVICE_COMMAND_TYPES,
  'DELETE',
] as const;

export const DEVICE_BULK_COMMAND_ALIAS_MAP: Record<string, (typeof BULK_DEVICE_COMMAND_TYPES)[number]> = {
  lock: 'LOCK',
  reset_password: 'RESET_PASSWORD',
  reboot: 'REBOOT',
  start_lost_mode: 'START_LOST_MODE',
  stop_lost_mode: 'STOP_LOST_MODE',
  relinquish_ownership: 'RELINQUISH_OWNERSHIP',
  clear_app_data: 'CLEAR_APP_DATA',
  wipe: 'WIPE',
  delete: 'DELETE',
  enable: 'ENABLE',
  disable: 'DISABLE',
  request_device_info: 'REQUEST_DEVICE_INFO',
  add_esim: 'ADD_ESIM',
  remove_esim: 'REMOVE_ESIM',
};

export const RESET_PASSWORD_FLAGS = [
  'RESET_PASSWORD_FLAG_UNSPECIFIED',
  'REQUIRE_ENTRY',
  'DO_NOT_ASK_CREDENTIALS_ON_BOOT',
  'LOCK_NOW',
] as const;

export const DEVICE_INFO_TYPES = [
  'DEVICE_INFO_UNSPECIFIED',
  'EID',
] as const;

export const ESIM_ACTIVATION_STATES = [
  'ACTIVATION_STATE_UNSPECIFIED',
  'ACTIVATED',
  'NOT_ACTIVATED',
] as const;

export const WIPE_DATA_FLAGS = [
  'WIPE_DATA_FLAG_UNSPECIFIED',
  'PRESERVE_RESET_PROTECTION_DATA',
  'WIPE_EXTERNAL_STORAGE',
  'WIPE_ESIMS',
] as const;

export type AmapiIssueCommandType = (typeof AMAPI_ISSUE_COMMAND_TYPES)[number];
export type PatchStateCommandType = (typeof PATCH_STATE_COMMAND_TYPES)[number];
export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];
export type BulkDeviceCommandType = (typeof BULK_DEVICE_COMMAND_TYPES)[number];
export type ResetPasswordFlag = (typeof RESET_PASSWORD_FLAGS)[number];
export type DeviceInfoType = (typeof DEVICE_INFO_TYPES)[number];
export type EsimActivationState = (typeof ESIM_ACTIVATION_STATES)[number];
export type WipeDataFlag = (typeof WIPE_DATA_FLAGS)[number];

const AMAPI_ISSUE_COMMAND_SET = new Set<string>(AMAPI_ISSUE_COMMAND_TYPES);
const PATCH_STATE_COMMAND_SET = new Set<string>(PATCH_STATE_COMMAND_TYPES);
const DEVICE_COMMAND_SET = new Set<string>(DEVICE_COMMAND_TYPES);
const BULK_DEVICE_COMMAND_SET = new Set<string>(BULK_DEVICE_COMMAND_TYPES);
const RESET_PASSWORD_FLAG_SET = new Set<string>(RESET_PASSWORD_FLAGS);
const DEVICE_INFO_TYPE_SET = new Set<string>(DEVICE_INFO_TYPES);
const ESIM_ACTIVATION_STATE_SET = new Set<string>(ESIM_ACTIVATION_STATES);
const WIPE_DATA_FLAG_SET = new Set<string>(WIPE_DATA_FLAGS);

export function isAmapiIssueCommandType(value: string): value is AmapiIssueCommandType {
  return AMAPI_ISSUE_COMMAND_SET.has(value);
}

export function isPatchStateCommandType(value: string): value is PatchStateCommandType {
  return PATCH_STATE_COMMAND_SET.has(value);
}

export function isDeviceCommandType(value: string): value is DeviceCommandType {
  return DEVICE_COMMAND_SET.has(value);
}

export function isBulkDeviceCommandType(value: string): value is BulkDeviceCommandType {
  return BULK_DEVICE_COMMAND_SET.has(value);
}

export function normalizeBulkDeviceCommand(requested: string): string {
  const trimmed = requested.trim();
  if (!trimmed) return trimmed;
  return DEVICE_BULK_COMMAND_ALIAS_MAP[trimmed.toLowerCase()] ?? trimmed.toUpperCase();
}

export function isResetPasswordFlag(value: string): value is ResetPasswordFlag {
  return RESET_PASSWORD_FLAG_SET.has(value);
}

export function isDeviceInfoType(value: string): value is DeviceInfoType {
  return DEVICE_INFO_TYPE_SET.has(value);
}

export function isEsimActivationState(value: string): value is EsimActivationState {
  return ESIM_ACTIVATION_STATE_SET.has(value);
}

export function isWipeDataFlag(value: string): value is WipeDataFlag {
  return WIPE_DATA_FLAG_SET.has(value);
}
