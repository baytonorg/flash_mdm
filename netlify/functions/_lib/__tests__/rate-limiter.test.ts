import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery };

vi.mock('../db.js', () => ({
  transaction: vi.fn(async (fn: (client: typeof mockClient) => Promise<unknown>) => {
    return fn(mockClient);
  }),
}));

import { consumeToken, checkAmapiRateLimit } from '../rate-limiter.js';

beforeEach(() => {
  mockClientQuery.mockReset();
});

describe('consumeToken', () => {
  it('creates a new bucket on first use and allows the request', async () => {
    // First query (SELECT) returns no rows
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // Second query (INSERT) succeeds
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await consumeToken('new-bucket', 1, 60, 1);
    expect(result.allowed).toBe(true);
    expect(result.remainingTokens).toBe(59);

    // Verify SELECT was called with FOR UPDATE
    expect(mockClientQuery.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(mockClientQuery.mock.calls[0][1]).toEqual(['new-bucket']);

    // Verify INSERT was called
    expect(mockClientQuery.mock.calls[1][0]).toContain('INSERT INTO rate_limit_buckets');
  });

  it('allows when bucket has sufficient tokens', async () => {
    const lastRefill = new Date(Date.now() - 5000); // 5 seconds ago
    mockClientQuery.mockResolvedValueOnce({
      rows: [{
        tokens: 50,
        max_tokens: 60,
        refill_rate: 1,
        last_refill_at: lastRefill.toISOString(),
      }],
    });
    // UPDATE query
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await consumeToken('bucket-1', 1, 60, 1);
    expect(result.allowed).toBe(true);
    // 50 tokens + ~5 seconds * 1 token/sec = ~55 tokens, minus 1 cost = ~54
    expect(result.remainingTokens).toBeGreaterThanOrEqual(53);
    expect(result.remainingTokens).toBeLessThanOrEqual(56);
  });

  it('denies when bucket has insufficient tokens', async () => {
    const lastRefill = new Date(Date.now() - 100); // 0.1 seconds ago
    mockClientQuery.mockResolvedValueOnce({
      rows: [{
        tokens: 0,
        max_tokens: 60,
        refill_rate: 1,
        last_refill_at: lastRefill.toISOString(),
      }],
    });
    // UPDATE query
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await consumeToken('bucket-2', 5, 60, 1);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeDefined();
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills tokens based on elapsed time', async () => {
    const lastRefill = new Date(Date.now() - 10000); // 10 seconds ago
    mockClientQuery.mockResolvedValueOnce({
      rows: [{
        tokens: 10,
        max_tokens: 60,
        refill_rate: 2, // 2 tokens/sec
        last_refill_at: lastRefill.toISOString(),
      }],
    });
    // UPDATE query
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await consumeToken('bucket-3', 1, 60, 2);
    expect(result.allowed).toBe(true);
    // 10 + 10s * 2/s = 30, minus 1 cost = 29
    expect(result.remainingTokens).toBeGreaterThanOrEqual(28);
    expect(result.remainingTokens).toBeLessThanOrEqual(31);
  });

  it('caps token refill at max_tokens', async () => {
    const lastRefill = new Date(Date.now() - 120000); // 2 minutes ago
    mockClientQuery.mockResolvedValueOnce({
      rows: [{
        tokens: 50,
        max_tokens: 60,
        refill_rate: 10,
        last_refill_at: lastRefill.toISOString(),
      }],
    });
    // UPDATE query
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await consumeToken('bucket-4', 1, 60, 10);
    expect(result.allowed).toBe(true);
    // 50 + 120*10 = 1250, capped at 60, minus 1 = 59
    expect(result.remainingTokens).toBe(59);
  });

  it('uses correct cost value', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await consumeToken('bucket-5', 10, 60, 1);
    expect(result.allowed).toBe(true);
    expect(result.remainingTokens).toBe(50); // 60 - 10
  });

  it('re-reads and applies normal token checks if bucket creation loses a race', async () => {
    const lastRefill = new Date();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // initial SELECT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // INSERT lost ON CONFLICT race
      .mockResolvedValueOnce({
        rows: [{
          tokens: 0,
          max_tokens: 1,
          refill_rate: 1,
          last_refill_at: lastRefill.toISOString(),
        }],
      }) // locked re-read sees exhausted bucket
      .mockResolvedValueOnce({ rows: [] }); // UPDATE after deny

    const result = await consumeToken('race-bucket', 1, 1, 1);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeDefined();
    expect(result.remainingTokens).toBeLessThan(1);
    expect(mockClientQuery).toHaveBeenCalledTimes(4);
    expect(mockClientQuery.mock.calls[2][0]).toContain('FOR UPDATE');
    expect(mockClientQuery.mock.calls[2][1]).toEqual(['race-bucket']);
  });
});

describe('checkAmapiRateLimit', () => {
  it('checks global bucket first, then per-resource bucket', async () => {
    // Global bucket - first use
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // Resource bucket - first use
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await checkAmapiRateLimit('project-1', 'enterprises/ent1', 'devices', 'dev-1');
    expect(result.allowed).toBe(true);
  });

  it('returns denied if global bucket is exhausted', async () => {
    // Global bucket returns insufficient tokens
    // Use a very recent refill so almost no tokens are added back
    const lastRefill = new Date(Date.now() - 10); // 10ms ago
    mockClientQuery.mockResolvedValueOnce({
      rows: [{
        tokens: 0,
        max_tokens: 1000,
        refill_rate: 10,
        last_refill_at: lastRefill.toISOString(),
      }],
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkAmapiRateLimit('project-1', 'enterprises/ent1', 'devices');
    expect(result.allowed).toBe(false);
  });

  it('builds resource key with resource ID when provided', async () => {
    // Global OK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // Resource OK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await checkAmapiRateLimit('proj', 'enterprises/e1', 'devices', 'dev-123');
    // The resource bucket INSERT should contain the resourceId in the key
    const resourceInsertCall = mockClientQuery.mock.calls[2];
    expect(resourceInsertCall[1][0]).toContain('dev-123');
  });

  it('builds resource key without resource ID when not provided', async () => {
    // Global OK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // Resource OK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await checkAmapiRateLimit('proj', 'enterprises/e1', 'policies');
    const resourceInsertCall = mockClientQuery.mock.calls[2];
    expect(resourceInsertCall[1][0]).toBe('resource:enterprises/e1:policies');
  });
});
