import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireSessionAuth: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  encrypt: vi.fn(() => 'enc-pending'),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

import { requireSessionAuth } from '../_lib/auth.js';
import { queryOne, execute } from '../_lib/db.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import handler from '../auth-totp-setup.ts';

const mockRequireSessionAuth = vi.mocked(requireSessionAuth);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockConsumeToken = vi.mocked(consumeToken);

function makeRequest() {
  return new Request('http://localhost/api/auth/totp/setup', {
    method: 'POST',
    headers: {
      'x-forwarded-for': '203.0.113.10',
    },
  });
}

describe('auth-totp-setup hardening', () => {
  beforeEach(() => {
    mockRequireSessionAuth.mockReset();
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockConsumeToken.mockReset();

    mockRequireSessionAuth.mockResolvedValue({
      authType: 'session',
      user: {
        id: 'user_1',
        email: 'user@example.com',
      },
    } as never);

    mockConsumeToken.mockResolvedValue({
      allowed: true,
      remainingTokens: 10,
      retryAfterMs: undefined,
    } as never);

    mockQueryOne.mockResolvedValue({
      totp_enabled: false,
    } as never);
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
  });

  it('rate limits by IP and returns Retry-After', async () => {
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      remainingTokens: 0,
      retryAfterMs: 9_000,
    } as never);

    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('9');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many TOTP setup attempts. Please try again later.',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rate limits by user and returns Retry-After', async () => {
    mockConsumeToken
      .mockResolvedValueOnce({
        allowed: true,
        remainingTokens: 9,
        retryAfterMs: undefined,
      } as never)
      .mockResolvedValueOnce({
        allowed: false,
        remainingTokens: 0,
        retryAfterMs: 11_000,
      } as never);

    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('11');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many TOTP setup attempts. Please try again later.',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('stores pending TOTP data with pending-created timestamp on success', async () => {
    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.secret).toBe('string');
    expect(typeof body.qr_url).toBe('string');
    expect(Array.isArray(body.backup_codes)).toBe(true);

    expect(mockConsumeToken).toHaveBeenCalledWith('auth:totp-setup:ip:203.0.113.10', 1, 10, 10 / 900);
    expect(mockConsumeToken).toHaveBeenCalledWith('auth:totp-setup:user:user_1', 1, 5, 5 / 900);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('totp_pending_created_at = now()'),
      ['enc-pending', 'user_1']
    );
  });
});
