# `netlify/functions/_lib/rate-limiter.ts`

> Postgres-backed token bucket rate limiter with support for global and per-resource AMAPI rate limits.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `consumeToken` | `(bucketId: string, cost?: number, maxTokens?: number, refillRate?: number) => Promise<RateLimitResult>` | Consumes tokens from a named bucket; creates the bucket on first use. Returns whether the request is allowed and remaining tokens |
| `checkAmapiRateLimit` | `(projectId: string, enterpriseName: string, resourceType: string, resourceId?: string) => Promise<RateLimitResult>` | Checks both global (1000 req/100s) and per-resource (60 req/min) rate limits for AMAPI calls |

## Internal Types

| Name | Description |
|------|-------------|
| `RateLimitResult` | `{ allowed: boolean; retryAfterMs?: number; remainingTokens: number }` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `transaction` | `_lib/db.ts` | Wrapping bucket read-modify-write in a Postgres transaction with `FOR UPDATE` locking |

## Key Logic

Implements the **token bucket** algorithm backed by the `rate_limit_buckets` Postgres table. Each bucket has a configurable max capacity and refill rate (tokens per second).

**Concurrency safety**: Uses `SELECT ... FOR UPDATE` within a transaction to prevent concurrent requests from over-consuming tokens. On first access, the bucket is created with `INSERT ... ON CONFLICT DO NOTHING`; if a race creates it first, the function re-reads with a lock.

**Token refill**: On each request, elapsed time since `last_refill_at` is used to calculate refilled tokens (capped at `max_tokens`). If insufficient tokens remain, the response includes `retryAfterMs` indicating how long to wait.

**AMAPI rate limits**: `checkAmapiRateLimit` enforces two tiers -- a global per-project limit (1000 tokens, refilling at 10/s) and a per-resource limit (60 tokens, refilling at 1/s). The global limit is checked first; if it fails, the per-resource check is skipped.
