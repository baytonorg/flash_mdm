import { describe, expect, it } from 'vitest';

import {
  normalizeAllowPersonalUsage,
  normalizeOneTimeUse,
  resolveEnrollmentDurationDays,
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
});
