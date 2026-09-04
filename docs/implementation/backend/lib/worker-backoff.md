# `netlify/functions/_lib/worker-backoff.ts`

> Pure delay calculation for PostgreSQL-degraded VPS worker polling.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `databaseBackoffDelayMs` | `(consecutiveFailures, pollMs, maxBackoffMs, retryAfterHeader, random?, nowMs?) => number` | Combines exponential growth, a server `Retry-After`, bounded ±20% jitter, and a hard ceiling |

## Safety and bounds

The normal poll interval is the lower bound, while the configured database
backoff ceiling is the upper bound. Both delta-seconds and HTTP-date
`Retry-After` values are supported. The helper only calculates a delay; it never
replays database work. Injectable time and randomness keep recovery behaviour
deterministic in regression tests.
