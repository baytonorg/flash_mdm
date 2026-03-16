import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireSessionAuth: vi.fn(),
  clearSessionCookie: vi.fn(() => 'flash_session=; Max-Age=0'),
  getSessionTokenFromCookie: vi.fn(() => 'plain-session'),
}));

vi.mock('../_lib/crypto.js', () => ({
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../auth-login.js', () => ({
  hashPassword: vi.fn(() => 'hashed-new-password'),
  _verifyPassword: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { requireSessionAuth, clearSessionCookie } from '../_lib/auth.js';
import { hashToken } from '../_lib/crypto.js';
import { logAudit } from '../_lib/audit.js';
import { _verifyPassword } from '../auth-login.js';
import { MIN_PASSWORD_LENGTH } from '../_lib/password-policy.js';
import handler from '../auth-password-change.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireSessionAuth = vi.mocked(requireSessionAuth);
const mockClearSessionCookie = vi.mocked(clearSessionCookie);
const mockHashToken = vi.mocked(hashToken);
const mockLogAudit = vi.mocked(logAudit);
const mockVerifyPassword = vi.mocked(_verifyPassword);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/.netlify/functions/auth-password-change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireSessionAuth.mockReset();
  mockClearSessionCookie.mockClear();
  mockHashToken.mockClear();
  mockLogAudit.mockReset();
  mockVerifyPassword.mockReset();

  mockRequireSessionAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1', email: 'user@example.com' },
  } as never);
  mockExecute.mockResolvedValue({ rowCount: 1 });
});

describe('auth-password-change', () => {
  it('rejects passwords shorter than the minimum length', async () => {
    const shortPassword = 'x'.repeat(Math.max(1, MIN_PASSWORD_LENGTH - 1));

    const res = await handler(
      makeRequest({ current_password: 'old', new_password: shortPassword }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('rejects invalid current password and does not update credentials', async () => {
    mockQueryOne.mockResolvedValueOnce({ password_hash: 'stored-hash' } as never);
    mockVerifyPassword.mockResolvedValueOnce(false);

    const res = await handler(
      makeRequest({ current_password: 'wrong', new_password: 'very-strong-password' }),
      {} as never
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Current password is incorrect' });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.password_change_failed',
    }));
  });

  it('changes password, invalidates sessions, and clears session cookie', async () => {
    mockQueryOne.mockResolvedValueOnce({ password_hash: 'stored-hash' } as never);
    mockVerifyPassword.mockResolvedValueOnce(true);

    const res = await handler(
      makeRequest({ current_password: 'old-password', new_password: 'very-strong-password' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Password changed. Please sign in again.',
    });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE users SET password_hash = $1');
    expect(mockExecute.mock.calls[1]).toEqual([
      'DELETE FROM sessions WHERE user_id = $1',
      ['user_1'],
    ]);
    expect(mockHashToken).toHaveBeenCalledWith('plain-session');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.password_changed',
      details: expect.objectContaining({ invalidated_all_sessions: true }),
    }));
    expect(mockClearSessionCookie).toHaveBeenCalledOnce();
    expect(res.headers.get('Set-Cookie')).toBe('flash_session=; Max-Age=0');
  });

  it('rejects API key-authenticated callers', async () => {
    mockRequireSessionAuth.mockRejectedValueOnce(
      Response.json({ error: 'Forbidden: session authentication required' }, { status: 403 })
    );

    const res = await handler(
      makeRequest({ current_password: 'old-password', new_password: 'very-strong-password' }),
      {} as never
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: session authentication required',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
