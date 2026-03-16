import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  generateToken: vi.fn(() => 'reset-token'),
  hashToken: vi.fn((token: string) => `hash:${token}`),
  encrypt: vi.fn(() => 'enc-reset-hash'),
}));

vi.mock('../_lib/resend.js', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  clearSessionCookie: vi.fn(() => 'flash_session=; Max-Age=0'),
}));

vi.mock('../auth-login.js', () => ({
  hashPassword: vi.fn(() => 'hashed-reset-password'),
}));

import { queryOne, execute, transaction } from '../_lib/db.js';
import { encrypt } from '../_lib/crypto.js';
import { sendEmail } from '../_lib/resend.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import { logAudit } from '../_lib/audit.js';
import { clearSessionCookie } from '../_lib/auth.js';
import resetStartHandler from '../auth-password-reset-start.ts';
import resetCompleteHandler from '../auth-password-reset-complete.ts';
import { MIN_PASSWORD_LENGTH } from '../_lib/password-policy.js';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockSendEmail = vi.mocked(sendEmail);
const mockConsumeToken = vi.mocked(consumeToken);
const mockLogAudit = vi.mocked(logAudit);
const mockClearSessionCookie = vi.mocked(clearSessionCookie);
const mockEncrypt = vi.mocked(encrypt);

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockSendEmail.mockReset();
  mockConsumeToken.mockReset();
  mockLogAudit.mockReset();
  mockClearSessionCookie.mockClear();
  mockEncrypt.mockClear();

  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockConsumeToken.mockResolvedValue({
    allowed: true,
    remainingTokens: 4,
    retryAfterMs: undefined,
  } as never);
});

describe('auth-password-reset-start', () => {
  it('returns generic success for unknown email without sending email', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const req = new Request('http://localhost/.netlify/functions/auth-password-reset-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' }),
    });

    const res = await resetStartHandler(req, {} as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'If an account exists, a password reset link has been sent.',
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('creates a reset token and sends email for existing users', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'user_1', password_hash: 'hash' } as never);

    const req = new Request('http://localhost/.netlify/functions/auth-password-reset-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });

    const res = await resetStartHandler(req, {} as never);
    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, $3)',
      expect.arrayContaining(['hash:reset-token', 'password_reset:user_1'])
    );
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user_1',
      action: 'auth.password_reset_requested',
    }));
  });

  it('escapes reset link when generating email html', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'user_1', password_hash: 'hash' } as never);
    const originalUrl = process.env.URL;
    process.env.URL = 'https://example.com/" onclick="alert(1)';

    try {
      const req = new Request('http://localhost/.netlify/functions/auth-password-reset-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com' }),
      });

      const res = await resetStartHandler(req, {} as never);
      expect(res.status).toBe(200);
      expect(mockSendEmail).toHaveBeenCalledOnce();

      const emailOptions = mockSendEmail.mock.calls[0]?.[0];
      expect(emailOptions?.html).toContain(
        'href="https://example.com/&quot; onclick=&quot;alert(1)/reset-password?token=reset-token"'
      );
      expect(emailOptions?.html).not.toContain('onclick="alert(1)"');
    } finally {
      if (originalUrl === undefined) delete process.env.URL;
      else process.env.URL = originalUrl;
    }
  });
});

describe('auth-password-reset-complete', () => {
  it('rejects passwords shorter than the minimum length', async () => {
    const shortPassword = 'x'.repeat(Math.max(1, MIN_PASSWORD_LENGTH - 1));
    const req = new Request('http://localhost/.netlify/functions/auth-password-reset-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'abc', new_password: shortPassword }),
    });

    const res = await resetCompleteHandler(req, {} as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects when token is invalid or already consumed (transaction returns null)', async () => {
    // The transaction now does atomic UPDATE...RETURNING; if 0 rows, returns null
    const mockClient = { query: vi.fn() };
    mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // token not found/consumed
    mockTransaction.mockImplementationOnce(async (fn: (client: typeof mockClient) => Promise<unknown>) => fn(mockClient));

    const req = new Request('http://localhost/.netlify/functions/auth-password-reset-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'abc', new_password: 'very-strong-password' }),
    });

    const res = await resetCompleteHandler(req, {} as never);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid or expired reset link' });
  });

  it('resets password, consumes token, invalidates sessions, and clears cookie', async () => {
    // The transaction atomically: (1) consumes token, (2) checks TOTP, (3) updates password, (4) deletes sessions
    const mockClient = { query: vi.fn() };
    // First call: atomic UPDATE...RETURNING on magic_links (consume token)
    mockClient.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'ml_2', email: 'password_reset:user_2' }],
    });
    // Second call: SELECT users.totp_enabled
    mockClient.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'user_2', totp_enabled: false }],
    });
    // Third call: UPDATE users SET password_hash
    mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
    // Fourth call: DELETE FROM sessions
    mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

    mockTransaction.mockImplementationOnce(async (fn: (client: typeof mockClient) => Promise<unknown>) => fn(mockClient));

    const req = new Request('http://localhost/.netlify/functions/auth-password-reset-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-token', new_password: 'very-strong-password' }),
    });

    const res = await resetCompleteHandler(req, {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Password reset successful. Please sign in again.',
    });
    // Verify transaction was called and client.query was called 4 times in order
    expect(mockClient.query).toHaveBeenCalledTimes(4);
    // 1st: consume token
    expect(mockClient.query.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at');
    // 2nd: lookup TOTP state
    expect(mockClient.query.mock.calls[1]?.[0]).toContain('SELECT id, totp_enabled FROM users');
    // 3rd: update password
    expect(mockClient.query.mock.calls[2]?.[0]).toContain('UPDATE users SET password_hash');
    // 4th: delete sessions
    expect(mockClient.query.mock.calls[3]?.[0]).toContain('DELETE FROM sessions');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user_2',
      action: 'auth.password_reset_completed',
    }));
    expect(mockClearSessionCookie).toHaveBeenCalledOnce();
    expect(res.headers.get('Set-Cookie')).toBe('flash_session=; Max-Age=0');
  });

  it('requires MFA for TOTP-enabled users and returns a pending MFA token without changing the password', async () => {
    const mockClient = { query: vi.fn() };
    mockClient.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'ml_3', email: 'password_reset:user_3' }],
    });
    mockClient.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'user_3', totp_enabled: true }],
    });
    mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

    mockTransaction.mockImplementationOnce(async (fn: (client: typeof mockClient) => Promise<unknown>) => fn(mockClient));

    const req = new Request('http://localhost/.netlify/functions/auth-password-reset-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-token', new_password: 'very-strong-password' }),
    });

    const res = await resetCompleteHandler(req, {} as never);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      needs_mfa: true,
      mfa_pending_token: 'reset-token',
    });
    expect(mockClient.query).toHaveBeenCalledTimes(3);
    expect(mockClient.query.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at');
    expect(mockClient.query.mock.calls[1]?.[0]).toContain('SELECT id, totp_enabled FROM users');
    expect(mockClient.query.mock.calls[2]?.[0]).toContain('INSERT INTO magic_links');
    expect(String(mockClient.query.mock.calls[2]?.[1]?.[1])).toContain('password_reset_mfa_pending_v2:user_3:');
    expect(String(mockClient.query.mock.calls[2]?.[1]?.[1])).not.toContain('hashed-reset-password');
    expect(mockEncrypt).toHaveBeenCalledWith('hashed-reset-password', 'password_reset_pending:user_3');
    expect(mockLogAudit).not.toHaveBeenCalled();
    expect(mockClearSessionCookie).not.toHaveBeenCalled();
  });
});
