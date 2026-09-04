import { describe, expect, it } from 'vitest';
import { databaseBackoffDelayMs } from '../worker-backoff.js';

describe('database worker backoff', () => {
  it('honours Retry-After and uses deterministic midpoint jitter', () => {
    expect(databaseBackoffDelayMs(1, 2_000, 30_000, '5', () => 0.5)).toBe(5_000);
    expect(databaseBackoffDelayMs(1, 2_000, 30_000, '5', () => 0)).toBe(5_000);
  });

  it('grows exponentially and caps the final jittered delay', () => {
    expect(databaseBackoffDelayMs(10, 2_000, 30_000, null, () => 1)).toBe(30_000);
  });

  it('never jitters below the normal polling interval', () => {
    expect(databaseBackoffDelayMs(1, 2_000, 30_000, null, () => 0)).toBe(2_000);
  });

  it('accepts an HTTP-date Retry-After value', () => {
    const now = Date.parse('2026-09-04T10:00:00Z');
    expect(databaseBackoffDelayMs(
      1,
      2_000,
      30_000,
      'Fri, 04 Sep 2026 10:00:08 GMT',
      () => 0.5,
      now
    )).toBe(8_000);
  });
});
