const PERSONAL_USAGE_MAP: Record<string, string> = {
  PERSONAL_USAGE_UNSPECIFIED: 'PERSONAL_USAGE_UNSPECIFIED',
  UNSPECIFIED: 'PERSONAL_USAGE_UNSPECIFIED',
  DEFAULT: 'PERSONAL_USAGE_UNSPECIFIED',

  PERSONAL_USAGE_ALLOWED: 'PERSONAL_USAGE_ALLOWED',
  ALLOWED: 'PERSONAL_USAGE_ALLOWED',

  PERSONAL_USAGE_DISALLOWED: 'PERSONAL_USAGE_DISALLOWED',
  DISALLOWED: 'PERSONAL_USAGE_DISALLOWED',

  PERSONAL_USAGE_DISALLOWED_USERLESS: 'PERSONAL_USAGE_DISALLOWED_USERLESS',
  DEDICATED_DEVICE_USERLESS: 'PERSONAL_USAGE_DISALLOWED_USERLESS',
  DEDICATED_DEVICE: 'PERSONAL_USAGE_DISALLOWED_USERLESS',
  DEDICATED: 'PERSONAL_USAGE_DISALLOWED_USERLESS',
  USERLESS: 'PERSONAL_USAGE_DISALLOWED_USERLESS',
};

export type NormalizedPersonalUsage =
  | 'PERSONAL_USAGE_UNSPECIFIED'
  | 'PERSONAL_USAGE_ALLOWED'
  | 'PERSONAL_USAGE_DISALLOWED'
  | 'PERSONAL_USAGE_DISALLOWED_USERLESS';

export function normalizeAllowPersonalUsage(input: unknown): NormalizedPersonalUsage {
  if (typeof input !== 'string' || !input.trim()) {
    return 'PERSONAL_USAGE_UNSPECIFIED';
  }
  const normalizedKey = input
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
  return (PERSONAL_USAGE_MAP[normalizedKey] as NormalizedPersonalUsage | undefined)
    ?? 'PERSONAL_USAGE_UNSPECIFIED';
}

export function normalizeOneTimeUse(input: unknown): boolean {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') return input !== 0;
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return false;
}

function clampDays(value: number): number {
  return Math.max(1, Math.min(365, Math.trunc(value)));
}

export const AMAPI_MAX_ENROLLMENT_TOKEN_DURATION = '315576000000s';

/**
 * PostgreSQL timestamptz stores at most six fractional-second digits. Truncate,
 * rather than round, so AMAPI's maximum timestamp does not roll into year 10000.
 * The original AMAPI string is stored separately for exact API round-tripping.
 */
export function toPostgresTimestampPrecision(timestamp: string): string {
  return timestamp.replace(/(\.\d{6})\d+(Z|[+-]\d{2}:\d{2})$/i, '$1$2');
}

export interface ResolvedEnrollmentTokenDuration {
  duration: string;
  expiryDays: number | null;
  isMaximum: boolean;
}

function parseDurationSecondsFromDurationValue(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(1, Math.trunc(input));
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const secondsMatch = /^(\d+)\s*s$/i.exec(trimmed);
  if (secondsMatch) return Math.max(1, Number(secondsMatch[1]));

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.trunc(numeric));
  }
  return null;
}

export function resolveEnrollmentDurationDays(input: {
  expiryDays?: unknown;
  durationDays?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
  defaultDays?: number;
}): number {
  if (typeof input.expiryDays === 'number' && Number.isFinite(input.expiryDays)) {
    return clampDays(input.expiryDays);
  }
  if (typeof input.durationDays === 'number' && Number.isFinite(input.durationDays)) {
    return clampDays(input.durationDays);
  }

  const durationSeconds = parseDurationSecondsFromDurationValue(input.duration)
    ?? parseDurationSecondsFromDurationValue(input.durationSeconds);
  if (durationSeconds) {
    return clampDays(Math.ceil(durationSeconds / 86400));
  }

  const fallback = typeof input.defaultDays === 'number' && Number.isFinite(input.defaultDays)
    ? input.defaultDays
    : 30;
  return clampDays(fallback);
}

export function resolveEnrollmentTokenDuration(input: {
  expiryDays?: unknown;
  durationDays?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
  defaultDays?: number;
}): ResolvedEnrollmentTokenDuration {
  if (
    typeof input.duration === 'string'
    && input.duration.trim() === AMAPI_MAX_ENROLLMENT_TOKEN_DURATION
  ) {
    return {
      duration: AMAPI_MAX_ENROLLMENT_TOKEN_DURATION,
      expiryDays: null,
      isMaximum: true,
    };
  }

  const expiryDays = resolveEnrollmentDurationDays(input);
  return {
    duration: `${expiryDays * 24 * 60 * 60}s`,
    expiryDays,
    isMaximum: false,
  };
}
