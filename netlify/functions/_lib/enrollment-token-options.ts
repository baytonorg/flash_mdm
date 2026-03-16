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
