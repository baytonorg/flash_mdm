function parseRetryAfterMs(value: string | null, nowMs: number): number {
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : 0;
}

/** Calculate capped exponential database-outage backoff with bounded jitter. */
export function databaseBackoffDelayMs(
  consecutiveFailures: number,
  pollMs: number,
  maxBackoffMs: number,
  retryAfterHeader: string | null,
  random: () => number = Math.random,
  nowMs = Date.now()
): number {
  const safePollMs = Math.max(250, Math.floor(pollMs));
  const safeMaxMs = Math.max(safePollMs, Math.floor(maxBackoffMs));
  const failureCount = Math.max(1, Math.floor(consecutiveFailures));
  const exponentialMs = safePollMs * (2 ** Math.min(failureCount - 1, 20));
  const requestedMs = parseRetryAfterMs(retryAfterHeader, nowMs);
  const exponentialBaseMs = Math.min(safeMaxMs, Math.max(safePollMs, exponentialMs));
  const jitter = 0.8 + (Math.max(0, Math.min(1, random())) * 0.4);
  const jitteredMs = Math.round(exponentialBaseMs * jitter);
  return Math.max(
    safePollMs,
    Math.min(safeMaxMs, Math.max(requestedMs, jitteredMs))
  );
}
