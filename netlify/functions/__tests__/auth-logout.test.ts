import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  getSessionTokenFromCookie: vi.fn(),
  clearSessionCookie: vi.fn(() => 'flash_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'),
}));

vi.mock('../_lib/crypto.js', () => ({
  hashToken: vi.fn((value: string) => `hash:${value}`),
}));

import { execute } from '../_lib/db.js';
import { getSessionTokenFromCookie } from '../_lib/auth.js';
import { hashToken } from '../_lib/crypto.js';
import handler from '../auth-logout.ts';

const mockExecute = vi.mocked(execute);
const mockGetSessionTokenFromCookie = vi.mocked(getSessionTokenFromCookie);
const mockHashToken = vi.mocked(hashToken);

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/.netlify/functions/auth-logout', {
    method: 'POST',
    headers,
  });
}

describe('auth-logout CSRF hardening', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockGetSessionTokenFromCookie.mockReset();
    mockHashToken.mockClear();
    mockGetSessionTokenFromCookie.mockReturnValue(null);
    mockExecute.mockResolvedValue({ rowCount: 0 } as never);
  });

  it('rejects requests without Origin', async () => {
    const res = await handler(
      makeRequest({
        'X-Requested-With': 'XMLHttpRequest',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing required Origin header',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests', async () => {
    const res = await handler(
      makeRequest({
        Origin: 'https://evil.example',
        'X-Requested-With': 'XMLHttpRequest',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Cross-origin requests are not allowed',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects requests without X-Requested-With', async () => {
    const res = await handler(
      makeRequest({
        Origin: 'http://localhost',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing required X-Requested-With header',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 200 and clears cookie when no valid session exists', async () => {
    const res = await handler(
      makeRequest({
        Origin: 'http://localhost',
        'X-Requested-With': 'XMLHttpRequest',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ message: 'Logged out' });
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('deletes the session row when a valid token is present', async () => {
    mockGetSessionTokenFromCookie.mockReturnValue('session-token');

    const res = await handler(
      makeRequest({
        Origin: 'http://localhost',
        'X-Requested-With': 'XMLHttpRequest',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockHashToken).toHaveBeenCalledWith('session-token');
    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM sessions WHERE token_hash = $1',
      ['hash:session-token']
    );
  });
});
