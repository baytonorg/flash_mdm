import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockClient = { query: vi.fn() };

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn((cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient)),
}));

vi.mock('../_lib/crypto.js', () => ({
  hashToken: vi.fn((token: string) => `hash:${token}`),
  generateToken: vi.fn(() => 'session-token'),
}));

vi.mock('../_lib/auth.js', () => ({
  setSessionCookie: vi.fn((token: string) => `flash_session=${token}`),
  clearSessionCookie: vi.fn(() => 'flash_session=; Max-Age=0'),
  SESSION_MAX_AGE_MILLISECONDS: 86400000,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  jsonResponse: vi.fn((data: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  ),
  errorResponse: vi.fn((message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  parseJsonBody: vi.fn((req: Request) => req.json()),
}));

vi.mock('../auth-login.js', () => ({
  hashPassword: vi.fn(() => 'hashed-password'),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { queryOne, execute, transaction } from '../_lib/db.js';
import { hashToken, generateToken } from '../_lib/crypto.js';
import { setSessionCookie } from '../_lib/auth.js';
import { logAudit } from '../_lib/audit.js';
import { hashPassword } from '../auth-login.js';
import magicLinkVerifyHandler from '../auth-magic-link-verify.ts';
import passwordResetCompleteHandler from '../auth-password-reset-complete.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockHashToken = vi.mocked(hashToken);
const mockGenerateToken = vi.mocked(generateToken);
const mockSetSessionCookie = vi.mocked(setSessionCookie);
const mockLogAudit = vi.mocked(logAudit);
const mockHashPassword = vi.mocked(hashPassword);

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockClient.query.mockReset();
  mockHashToken.mockClear();
  mockGenerateToken.mockClear();
  mockSetSessionCookie.mockClear();
  mockLogAudit.mockReset();
  mockHashPassword.mockClear();

  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockLogAudit.mockResolvedValue(undefined as never);

  // Default: transaction calls the callback with mockClient
  mockTransaction.mockImplementation((cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));
});

// ─── Magic Link Verify — TOCTOU Fixes ───────────────────────────────────────

describe('auth-magic-link-verify — TOCTOU race prevention', () => {
  it('redirects to login when the atomic UPDATE returns 0 rows (token already consumed)', async () => {
    // The transaction's UPDATE...RETURNING finds no matching row
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const req = new Request(
      'http://localhost/.netlify/functions/auth-magic-link-verify?token=test-token'
    );
    const res = await magicLinkVerifyHandler(req, {} as never);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('http://localhost:8888/login?auth_error=expired_or_used_magic_link');

    // Verify the transaction was used with atomic UPDATE
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE magic_links SET used_at = now()'),
      ['hash:test-token']
    );

    // No session should have been created
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
  });

  it('redirects to login for expired tokens (handled by WHERE clause in atomic UPDATE)', async () => {
    // Expired token: the WHERE clause `expires_at > now()` excludes it, so 0 rows returned
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const req = new Request(
      'http://localhost/.netlify/functions/auth-magic-link-verify?token=expired-token'
    );
    const res = await magicLinkVerifyHandler(req, {} as never);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('http://localhost:8888/login?auth_error=expired_or_used_magic_link');
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()'),
      ['hash:expired-token']
    );
  });

  it('proceeds to create a session when atomic UPDATE returns a valid row', async () => {
    // Transaction returns the consumed magic link row
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'link_1', email: 'user@example.com' }],
      rowCount: 1,
    });

    // queryOne calls after transaction: user lookup, totp check, workspace membership
    mockQueryOne
      .mockResolvedValueOnce({ id: 'user_1' } as never)             // SELECT id FROM users
      .mockResolvedValueOnce({ totp_enabled: false } as never)       // SELECT totp_enabled
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);    // workspace membership

    const req = new Request(
      'http://localhost/.netlify/functions/auth-magic-link-verify?token=test-token'
    );
    const res = await magicLinkVerifyHandler(req, {} as never);

    expect(res.status).toBe(302);
    expect(res.headers.get('Set-Cookie')).toContain('flash_session=session-token');
    expect(res.headers.get('Location')).toBe('http://localhost:8888');

    // Verify session was created
    expect(mockGenerateToken).toHaveBeenCalledOnce();
    expect(mockSetSessionCookie).toHaveBeenCalledWith('session-token');

    // Verify session insertion into DB
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sessions'),
      expect.arrayContaining(['hash:session-token', 'user_1', 'ws_1'])
    );

    // Verify audit log
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_1',
        action: 'auth.login',
        details: { method: 'magic_link' },
      })
    );
  });
});

// ─── Password Reset Complete — TOCTOU Fixes ─────────────────────────────────

describe('auth-password-reset-complete — TOCTOU race prevention', () => {
  function makeResetRequest(body: { token: string; new_password: string }) {
    return new Request(
      'http://localhost/.netlify/functions/auth-password-reset-complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  }

  it('returns 400 when the atomic consume returns 0 rows (token already used)', async () => {
    // First client.query inside transaction: UPDATE...RETURNING returns 0 rows
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const req = makeResetRequest({
      token: 'reset-token',
      new_password: 'newpassword123',
    });
    const res = await passwordResetCompleteHandler(req, {} as never);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid or expired reset link');

    // Transaction was called but no password update happened
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockClient.query).toHaveBeenCalledTimes(1); // Only the consume attempt
    expect(mockClient.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users SET password_hash'))).toBe(false);
  });

  it('updates password and deletes sessions when consume succeeds', async () => {
    // First client.query: consume token — succeeds
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ id: 'ml_1', email: 'password_reset:user_1' }],
        rowCount: 1,
      })
      // Second client.query: SELECT users.totp_enabled
      .mockResolvedValueOnce({
        rows: [{ id: 'user_1', totp_enabled: false }],
        rowCount: 1,
      })
      // Third client.query: UPDATE users SET password_hash
      .mockResolvedValueOnce({ rowCount: 1 })
      // Fourth client.query: DELETE FROM sessions
      .mockResolvedValueOnce({ rowCount: 2 });

    const req = makeResetRequest({
      token: 'reset-token',
      new_password: 'newpassword123',
    });
    const res = await passwordResetCompleteHandler(req, {} as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Password reset successful. Please sign in again.');

    // Verify password was hashed and stored
    expect(mockHashPassword).toHaveBeenCalledWith('newpassword123');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET password_hash'),
      ['hashed-password', 'user_1']
    );

    // Verify sessions were deleted
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM sessions WHERE user_id = $1',
      ['user_1']
    );

    // Verify audit log
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_1',
        action: 'auth.password_reset_completed',
      })
    );
  });

  it('consumes the token BEFORE updating the password (call order check)', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ id: 'ml_1', email: 'password_reset:user_1' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'user_1', totp_enabled: false }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const req = makeResetRequest({
      token: 'reset-token',
      new_password: 'newpassword123',
    });
    await passwordResetCompleteHandler(req, {} as never);

    // Verify the call order: consume token FIRST, then check TOTP state, then update password, then delete sessions
    const calls = mockClient.query.mock.calls;
    expect(calls).toHaveLength(4);

    // First call: atomic consume via UPDATE...RETURNING on magic_links
    expect(calls[0][0]).toContain('UPDATE magic_links SET used_at = now()');
    expect(calls[0][0]).toContain('RETURNING');

    // Second call: inspect TOTP state to decide whether MFA is required
    expect(calls[1][0]).toContain('SELECT id, totp_enabled FROM users');

    // Third call: update the user's password
    expect(calls[2][0]).toContain('UPDATE users SET password_hash');

    // Fourth call: invalidate sessions
    expect(calls[3][0]).toContain('DELETE FROM sessions');
  });
});
