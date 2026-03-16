import { transaction } from './db.js';

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  remainingTokens: number;
}

/**
 * Token bucket rate limiter backed by Postgres.
 * Uses FOR UPDATE to prevent concurrent over-consumption.
 */
export async function consumeToken(
  bucketId: string,
  cost: number = 1,
  maxTokens: number = 60,
  refillRate: number = 1 // tokens per second
): Promise<RateLimitResult> {
  return transaction(async (client) => {
    const selectBucketForUpdate = () => client.query(
      `SELECT tokens, max_tokens, refill_rate, last_refill_at
       FROM rate_limit_buckets
       WHERE id = $1
       FOR UPDATE`,
      [bucketId]
    );

    // Try to get existing bucket with lock
    let existing = await selectBucketForUpdate();

    if (existing.rows.length === 0) {
      // Create new bucket
      const insertResult = await client.query(
        `INSERT INTO rate_limit_buckets (id, tokens, max_tokens, refill_rate, last_refill_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO NOTHING`,
        [bucketId, maxTokens - cost, maxTokens, refillRate]
      );

      const insertedRows = insertResult.rowCount ?? insertResult.rows.length;
      if (insertedRows > 0) {
        return { allowed: true, remainingTokens: maxTokens - cost };
      }

      // Another transaction created the bucket after our initial SELECT.
      // Re-read with a lock and continue through the normal refill/consume path.
      existing = await selectBucketForUpdate();
    }

    if (existing.rows.length === 0) {
      throw new Error(`Rate limit bucket ${bucketId} was not found after insert conflict`);
    }

    const bucket = existing.rows[0];
    const lastRefill = new Date(bucket.last_refill_at);
    const elapsedMs = Date.now() - lastRefill.getTime();
    const elapsedSeconds = elapsedMs / 1000;

    // Refill tokens
    const tokens = Math.min(
      bucket.max_tokens,
      bucket.tokens + elapsedSeconds * bucket.refill_rate
    );

    if (tokens < cost) {
      // Not enough tokens
      const deficit = cost - tokens;
      const waitMs = Math.ceil((deficit / bucket.refill_rate) * 1000);
      // Update last_refill_at but don't consume
      await client.query(
        `UPDATE rate_limit_buckets SET tokens = $1, last_refill_at = now() WHERE id = $2`,
        [tokens, bucketId]
      );
      return { allowed: false, retryAfterMs: waitMs, remainingTokens: tokens };
    }

    // Consume tokens
    const remaining = tokens - cost;
    await client.query(
      `UPDATE rate_limit_buckets SET tokens = $1, last_refill_at = now() WHERE id = $2`,
      [remaining, bucketId]
    );

    return { allowed: true, remainingTokens: remaining };
  });
}

/**
 * Check both global and per-resource rate limits for AMAPI calls.
 * Global: 1000 queries / 100 seconds (refill 10/s)
 * Per-resource: 60 queries / minute (refill 1/s)
 */
export async function checkAmapiRateLimit(
  projectId: string,
  enterpriseName: string,
  resourceType: string,
  resourceId?: string
): Promise<RateLimitResult> {
  // Check global first
  const globalResult = await consumeToken(
    `global:${projectId}`,
    1,
    1000,
    10 // 10 tokens/second = 1000/100s
  );

  if (!globalResult.allowed) return globalResult;

  // Check per-resource
  const resourceKey = resourceId
    ? `resource:${enterpriseName}:${resourceType}:${resourceId}`
    : `resource:${enterpriseName}:${resourceType}`;

  return consumeToken(resourceKey, 1, 60, 1); // 1 token/second = 60/min
}
