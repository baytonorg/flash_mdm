export const DEFAULT_DEVICE_REPORT_STALE_AFTER_DAYS = 7;
export const MIN_DEVICE_REPORT_STALE_AFTER_DAYS = 1;
export const MAX_DEVICE_REPORT_STALE_AFTER_DAYS = 365;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getDeviceReportStaleAfterDays(settings: unknown): number {
  if (!isJsonObject(settings) || !isJsonObject(settings.device_health)) {
    return DEFAULT_DEVICE_REPORT_STALE_AFTER_DAYS;
  }

  const value = settings.device_health.stale_after_days;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < MIN_DEVICE_REPORT_STALE_AFTER_DAYS
    || value > MAX_DEVICE_REPORT_STALE_AFTER_DAYS
  ) {
    return DEFAULT_DEVICE_REPORT_STALE_AFTER_DAYS;
  }

  return value;
}

export function getDeviceReportFreshness(
  lastStatusReportAt: string | null,
  staleAfterDays: number,
  nowMs = Date.now()
): 'fresh' | 'stale' | 'unknown' {
  if (!lastStatusReportAt) return 'unknown';

  const reportTimeMs = Date.parse(lastStatusReportAt);
  if (!Number.isFinite(reportTimeMs)) return 'unknown';

  const staleBoundaryMs = nowMs - staleAfterDays * 24 * 60 * 60 * 1000;
  return reportTimeMs < staleBoundaryMs ? 'stale' : 'fresh';
}
