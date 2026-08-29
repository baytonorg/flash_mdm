export type AmapiCommandResultStatus = 'SUCCEEDED' | 'FAILED' | 'RUNNING' | 'UNKNOWN';

export interface AmapiCommandResult {
  status: AmapiCommandResultStatus;
  error: string | null;
  commandType: string | null;
  succeeded: boolean;
}

interface SpecificResult {
  status: AmapiCommandResultStatus;
  detail: string;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function enumValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

export function extractAmapiCommandType(operation: Record<string, unknown>): string | null {
  const metadata = parseObject(operation.metadata);
  const payloadCommand = parseObject(operation.command);
  const responseCommand = parseObject(parseObject(operation.response)?.command);
  for (const candidate of [metadata?.type, operation.type, payloadCommand?.type, responseCommand?.type]) {
    const normalized = enumValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function statusResult(
  field: string,
  value: unknown,
  succeeded: ReadonlySet<string>,
  running: ReadonlySet<string> = new Set(),
): SpecificResult | null {
  const status = enumValue(parseObject(value)?.status);
  if (!status) return null;
  const detail = `${field}: ${status}`;
  if (succeeded.has(status)) return { status: 'SUCCEEDED', detail };
  if (running.has(status)) return { status: 'RUNNING', detail };
  if (status === 'STATUS_UNSPECIFIED') return { status: 'UNKNOWN', detail };
  return { status: 'FAILED', detail };
}

function clearAppsDataResult(value: unknown): SpecificResult | null {
  const results = parseObject(parseObject(value)?.results);
  if (!results) return null;

  const entries = Object.entries(results);
  if (entries.length === 0) {
    return { status: 'UNKNOWN', detail: 'clearAppsDataStatus: no per-app results' };
  }

  const outcomes = entries.map(([packageName, result]) => ({
    packageName,
    status: enumValue(parseObject(result)?.clearingResult),
  }));
  const failures = outcomes.filter(({ status }) =>
    status !== null && status !== 'SUCCESS' && status !== 'CLEARING_RESULT_UNSPECIFIED'
  );
  if (failures.length > 0) {
    return {
      status: 'FAILED',
      detail: `clearAppsDataStatus: ${failures.map(({ packageName, status }) => `${packageName}=${status}`).join(', ')}`,
    };
  }
  if (outcomes.every(({ status }) => status === 'SUCCESS')) {
    return { status: 'SUCCEEDED', detail: 'clearAppsDataStatus: all apps succeeded' };
  }
  return { status: 'UNKNOWN', detail: 'clearAppsDataStatus: incomplete per-app results' };
}

function classifySpecificResult(
  commandType: string | null,
  metadata: Record<string, unknown>,
): SpecificResult | null {
  switch (commandType) {
    case 'CLEAR_APP_DATA':
      return clearAppsDataResult(metadata.clearAppsDataStatus);
    case 'START_LOST_MODE':
      return statusResult(
        'startLostModeStatus',
        metadata.startLostModeStatus,
        new Set(['SUCCESS', 'ALREADY_IN_LOST_MODE']),
      );
    case 'STOP_LOST_MODE':
      return statusResult(
        'stopLostModeStatus',
        metadata.stopLostModeStatus,
        new Set(['SUCCESS', 'NOT_IN_LOST_MODE']),
      );
    case 'ADD_ESIM':
    case 'REMOVE_ESIM':
      return statusResult(
        'esimStatus',
        metadata.esimStatus,
        new Set(['SUCCESS']),
        new Set(['IN_PROGRESS', 'PENDING_USER_ACTION']),
      );
    case 'REQUEST_DEVICE_INFO':
      return statusResult(
        'requestDeviceInfoStatus',
        metadata.requestDeviceInfoStatus,
        new Set(['SUCCEEDED']),
        new Set(['PENDING_USER_ACTION']),
      );
    default:
      return null;
  }
}

function operationErrorDetail(value: unknown): string {
  const error = parseObject(value);
  if (!error) return 'Operation.error';
  const code = typeof error.code === 'number' ? `code ${error.code}` : null;
  const message = typeof error.message === 'string' && error.message.trim()
    ? error.message.trim()
    : null;
  return `Operation.error: ${[code, message].filter(Boolean).join(' - ') || 'unspecified error'}`;
}

function legacyCommandState(value: unknown): SpecificResult | null {
  const state = enumValue(value);
  if (!state) return null;
  if (new Set(['SUCCEEDED', 'EXECUTED', 'SUCCESS']).has(state)) {
    return { status: 'SUCCEEDED', detail: `commandState: ${state}` };
  }
  if (new Set(['FAILED', 'ERROR']).has(state)) {
    return { status: 'FAILED', detail: `commandState: ${state}` };
  }
  if (new Set(['RUNNING', 'PENDING', 'IN_PROGRESS']).has(state)) {
    return { status: 'RUNNING', detail: `commandState: ${state}` };
  }
  return { status: 'UNKNOWN', detail: `commandState: ${state}` };
}

export function classifyAmapiCommandOperation(
  operation: Record<string, unknown>,
): AmapiCommandResult {
  const metadata = parseObject(operation.metadata) ?? {};
  const commandType = extractAmapiCommandType(operation);
  const specific = classifySpecificResult(commandType, metadata);

  if (specific && specific.status !== 'UNKNOWN') {
    return {
      status: specific.status,
      error: specific.status === 'FAILED' ? specific.detail : null,
      commandType,
      succeeded: specific.status === 'SUCCEEDED',
    };
  }

  const commandErrorCode = enumValue(metadata.errorCode);
  if (commandErrorCode && commandErrorCode !== 'COMMAND_ERROR_CODE_UNSPECIFIED') {
    return {
      status: 'FAILED',
      error: `Command.errorCode: ${commandErrorCode}`,
      commandType,
      succeeded: false,
    };
  }

  if (parseObject(operation.error)) {
    return {
      status: 'FAILED',
      error: operationErrorDetail(operation.error),
      commandType,
      succeeded: false,
    };
  }

  if (specific) {
    return { status: 'UNKNOWN', error: null, commandType, succeeded: false };
  }

  const legacy = legacyCommandState(operation.commandState);
  if (legacy) {
    return {
      status: legacy.status,
      error: legacy.status === 'FAILED' ? legacy.detail : null,
      commandType,
      succeeded: legacy.status === 'SUCCEEDED',
    };
  }

  if (operation.done === false) {
    return { status: 'RUNNING', error: null, commandType, succeeded: false };
  }
  if (operation.done === true && parseObject(operation.response)) {
    return { status: 'SUCCEEDED', error: null, commandType, succeeded: true };
  }
  return { status: 'UNKNOWN', error: null, commandType, succeeded: false };
}
