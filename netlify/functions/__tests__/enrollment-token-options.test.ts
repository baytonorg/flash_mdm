import { describe, expect, it } from 'vitest';

import {
  AMAPI_MAX_ENROLLMENT_TOKEN_DURATION,
  normalizeAllowPersonalUsage,
  normalizeOneTimeUse,
  resolveEnrollmentDurationDays,
  resolveEnrollmentTokenDuration,
  toPostgresTimestampPrecision,
} from '../_lib/enrollment-token-options.ts';

describe('enrollment-token-options', () => {
  it('normalizes personal usage aliases', () => {
    expect(normalizeAllowPersonalUsage(undefined)).toBe('PERSONAL_USAGE_UNSPECIFIED');
    expect(normalizeAllowPersonalUsage('allowed')).toBe('PERSONAL_USAGE_ALLOWED');
    expect(normalizeAllowPersonalUsage('PERSONAL_USAGE_DISALLOWED')).toBe('PERSONAL_USAGE_DISALLOWED');
    expect(normalizeAllowPersonalUsage('dedicated device')).toBe('PERSONAL_USAGE_DISALLOWED_USERLESS');
    expect(normalizeAllowPersonalUsage('invalid-value')).toBe('PERSONAL_USAGE_UNSPECIFIED');
  });

  it('normalizes one-time-use flags from boolean-like inputs', () => {
    expect(normalizeOneTimeUse(true)).toBe(true);
    expect(normalizeOneTimeUse('true')).toBe(true);
    expect(normalizeOneTimeUse('1')).toBe(true);
    expect(normalizeOneTimeUse('false')).toBe(false);
    expect(normalizeOneTimeUse(0)).toBe(false);
    expect(normalizeOneTimeUse(undefined)).toBe(false);
  });

  it('resolves duration from supported aliases with clamping', () => {
    expect(resolveEnrollmentDurationDays({ expiryDays: 14 })).toBe(14);
    expect(resolveEnrollmentDurationDays({ durationDays: 5 })).toBe(5);
    expect(resolveEnrollmentDurationDays({ duration: '172800s' })).toBe(2);
    expect(resolveEnrollmentDurationDays({ durationSeconds: 3600 })).toBe(1);
    expect(resolveEnrollmentDurationDays({ duration: '999999999s' })).toBe(365);
    expect(resolveEnrollmentDurationDays({})).toBe(30);
  });

  it('preserves the exact AMAPI maximum while keeping ordinary durations bounded', () => {
    expect(resolveEnrollmentTokenDuration({ duration: AMAPI_MAX_ENROLLMENT_TOKEN_DURATION })).toEqual({
      duration: AMAPI_MAX_ENROLLMENT_TOKEN_DURATION,
      expiryDays: null,
      isMaximum: true,
    });
    expect(resolveEnrollmentTokenDuration({ expiryDays: 14 })).toEqual({
      duration: '1209600s',
      expiryDays: 14,
      isMaximum: false,
    });
    expect(resolveEnrollmentTokenDuration({ duration: 'invalid' })).toEqual({
      duration: '2592000s',
      expiryDays: 30,
      isMaximum: false,
    });
  });

  it('truncates AMAPI nanoseconds to PostgreSQL precision without rolling the date', () => {
    expect(toPostgresTimestampPrecision('9999-12-31T23:59:59.999999999Z'))
      .toBe('9999-12-31T23:59:59.999999Z');
    expect(toPostgresTimestampPrecision('2026-09-30T10:00:00.123Z'))
      .toBe('2026-09-30T10:00:00.123Z');
  });
});
