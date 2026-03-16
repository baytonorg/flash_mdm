import {
  DEVICE_INFO_TYPES,
  ESIM_ACTIVATION_STATES,
  RESET_PASSWORD_FLAGS,
  WIPE_DATA_FLAGS,
  isDeviceInfoType,
  isEsimActivationState,
  isResetPasswordFlag,
  isWipeDataFlag,
} from './device-commands.js';

export interface BuildAmapiCommandOptions {
  allowUnknown?: boolean;
}

export class AmapiCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmapiCommandValidationError';
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toUserFacingMessage(value: unknown): { defaultMessage: string } | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nested = toNonEmptyString((value as Record<string, unknown>).defaultMessage);
    return nested ? { defaultMessage: nested } : undefined;
  }
  const msg = toNonEmptyString(value);
  return msg ? { defaultMessage: msg } : undefined;
}

export function buildAmapiCommandPayload(
  type: string,
  params?: Record<string, unknown>,
  options: BuildAmapiCommandOptions = {}
): Record<string, unknown> {
  const { allowUnknown = false } = options;
  const input = asObject(params);
  const commandBody: Record<string, unknown> = { type };

  switch (type) {
    case 'LOCK':
    case 'REBOOT':
    case 'RELINQUISH_OWNERSHIP':
      return commandBody;

    case 'STOP_LOST_MODE':
      commandBody.stopLostModeParams = {};
      return commandBody;

    case 'RESET_PASSWORD': {
      const raw = asObject(input.resetPasswordParams);
      const newPassword = toNonEmptyString(input.newPassword ?? raw.newPassword);
      const rawResetPasswordFlags = input.resetPasswordFlags ?? raw.resetPasswordFlags;
      let resetPasswordFlags: string[] | undefined;
      if (rawResetPasswordFlags !== undefined) {
        if (!Array.isArray(rawResetPasswordFlags)) {
          throw new AmapiCommandValidationError('RESET_PASSWORD params.resetPasswordFlags must be an array');
        }
        const invalid = rawResetPasswordFlags.filter((flag) => typeof flag !== 'string' || !isResetPasswordFlag(flag));
        if (invalid.length > 0) {
          throw new AmapiCommandValidationError(
            `Invalid RESET_PASSWORD resetPasswordFlags. Valid values: ${RESET_PASSWORD_FLAGS.join(', ')}`
          );
        }
        resetPasswordFlags = rawResetPasswordFlags as string[];
      }
      if (newPassword) commandBody.newPassword = newPassword;
      if (resetPasswordFlags) commandBody.resetPasswordFlags = resetPasswordFlags;
      return commandBody;
    }

    case 'START_LOST_MODE': {
      const raw = asObject(input.startLostModeParams);
      const lostOrganization = toUserFacingMessage(input.organization ?? input.lostOrganization ?? raw.lostOrganization);
      const lostMessage = toUserFacingMessage(input.message ?? input.lostMessage ?? raw.lostMessage);
      const lostPhoneNumber = toUserFacingMessage(input.phone ?? input.lostPhoneNumber ?? raw.lostPhoneNumber);
      const lostStreetAddress = toUserFacingMessage(input.address ?? input.lostStreetAddress ?? raw.lostStreetAddress);
      const lostEmailAddress = toNonEmptyString(input.email ?? input.lostEmailAddress ?? raw.lostEmailAddress);

      const startLostModeParams = {
        ...(lostOrganization ? { lostOrganization } : {}),
        ...(lostMessage ? { lostMessage } : {}),
        ...(lostPhoneNumber ? { lostPhoneNumber } : {}),
        ...(lostStreetAddress ? { lostStreetAddress } : {}),
        ...(lostEmailAddress ? { lostEmailAddress } : {}),
      };
      if (Object.keys(startLostModeParams).length === 0) {
        throw new AmapiCommandValidationError(
          'START_LOST_MODE requires at least one of: lostMessage, lostPhoneNumber, lostEmailAddress, lostOrganization, lostStreetAddress'
        );
      }
      commandBody.startLostModeParams = startLostModeParams;
      return commandBody;
    }

    case 'CLEAR_APP_DATA': {
      const raw = asObject(input.clearAppsDataParams);
      const packageName = toNonEmptyString(input.packageName);
      const packageNames = Array.isArray(raw.packageNames) ? raw.packageNames : undefined;
      if (packageNames?.length) {
        commandBody.clearAppsDataParams = { packageNames };
        return commandBody;
      }
      if (!packageName) {
        throw new AmapiCommandValidationError('CLEAR_APP_DATA requires params.packageName');
      }
      commandBody.clearAppsDataParams = { packageNames: [packageName] };
      return commandBody;
    }

    case 'REQUEST_DEVICE_INFO': {
      const raw = asObject(input.requestDeviceInfoParams);
      const deviceInfo = toNonEmptyString(input.deviceInfo ?? raw.deviceInfo) ?? 'EID';
      if (!isDeviceInfoType(deviceInfo)) {
        throw new AmapiCommandValidationError(
          `Invalid REQUEST_DEVICE_INFO deviceInfo. Valid values: ${DEVICE_INFO_TYPES.join(', ')}`
        );
      }
      commandBody.requestDeviceInfoParams = { deviceInfo };
      return commandBody;
    }

    case 'ADD_ESIM': {
      const raw = asObject(input.addEsimParams);
      const activationCode = toNonEmptyString(
        input.activationCode ?? input.activation_code ?? raw.activationCode
      );
      if (!activationCode) {
        throw new AmapiCommandValidationError('ADD_ESIM requires params.activationCode');
      }

      const activationState = toNonEmptyString(
        input.activationState ?? input.activation_state ?? raw.activationState
      ) ?? 'ACTIVATION_STATE_UNSPECIFIED';

      if (!isEsimActivationState(activationState)) {
        throw new AmapiCommandValidationError(
          `Invalid ADD_ESIM activationState. Valid values: ${ESIM_ACTIVATION_STATES.join(', ')}`
        );
      }

      commandBody.addEsimParams = {
        activationCode,
        activationState,
      };
      return commandBody;
    }

    case 'WIPE': {
      const raw = asObject(input.wipeParams);
      const wipeReason = toUserFacingMessage(input.wipeReason ?? raw.wipeReason);
      const rawFlags = input.wipeDataFlags ?? raw.wipeDataFlags;
      const wipeDataFlags = Array.isArray(rawFlags)
        ? rawFlags.filter((f: unknown) => typeof f === 'string' && isWipeDataFlag(f))
        : undefined;

      const wipeParams: Record<string, unknown> = {};
      if (wipeReason) wipeParams.wipeReason = wipeReason;
      if (wipeDataFlags?.length) wipeParams.wipeDataFlags = wipeDataFlags;

      if (Object.keys(wipeParams).length) {
        commandBody.wipeParams = wipeParams;
      }
      return commandBody;
    }

    case 'REMOVE_ESIM': {
      const raw = asObject(input.removeEsimParams);
      const iccId = toNonEmptyString(input.iccId ?? input.icc_id ?? raw.iccId);
      if (!iccId) {
        throw new AmapiCommandValidationError('REMOVE_ESIM requires params.iccId');
      }
      commandBody.removeEsimParams = { iccId };
      return commandBody;
    }

    default: {
      if (!allowUnknown) {
        throw new AmapiCommandValidationError(`Unsupported command type: ${type}`);
      }
      const { type: _ignoredType, ...rest } = input;
      return { ...commandBody, ...rest };
    }
  }
}
