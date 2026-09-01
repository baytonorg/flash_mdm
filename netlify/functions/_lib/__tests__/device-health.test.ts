import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_REPORT_STALE_AFTER_DAYS,
  getDeviceReportFreshness,
  getDeviceReportStaleAfterDays,
} from '../device-health.js';

describe('device report health', () => {
  it('uses the seven-day default for missing or invalid workspace settings', () => {
    expect(getDeviceReportStaleAfterDays(undefined)).toBe(DEFAULT_DEVICE_REPORT_STALE_AFTER_DAYS);
    expect(getDeviceReportStaleAfterDays({ device_health: { stale_after_days: 0 } })).toBe(7);
    expect(getDeviceReportStaleAfterDays({ device_health: { stale_after_days: '30' } })).toBe(7);
  });

  it('reads a valid workspace threshold', () => {
    expect(getDeviceReportStaleAfterDays({ device_health: { stale_after_days: 30 } })).toBe(30);
  });

  it('classifies null, old, and current reports independently of device state', () => {
    const now = Date.parse('2026-09-01T12:00:00.000Z');
    expect(getDeviceReportFreshness(null, 7, now)).toBe('unknown');
    expect(getDeviceReportFreshness('2026-08-20T12:00:00.000Z', 7, now)).toBe('stale');
    expect(getDeviceReportFreshness('2026-08-31T12:00:00.000Z', 7, now)).toBe('fresh');
  });
});
