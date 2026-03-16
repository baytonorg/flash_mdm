import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  hashToken: vi.fn((token: string) => `hash:${token}`),
  generateToken: vi.fn(() => 'session-token'),
  decrypt: vi.fn(() => 'BASE32SECRET'),
  encrypt: vi.fn(() => 'enc-next-backups'),
}));

vi.mock('../_lib/auth.js', () => ({
  setSessionCookie: vi.fn((token: string) => `flash_session=${token}; Path=/; HttpOnly`),
  clearSessionCookie: vi.fn(() => 'flash_session=; Max-Age=0'),
  SESSION_MAX_AGE_MILLISECONDS: 14 * 24 * 60 * 60 * 1000,
}));

vi.mock('../_lib/totp.js', () => ({
  verifyTOTP: vi.fn(),
  consumeBackupCode: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

import { queryOne, execute, transaction } from '../_lib/db.js';
import { hashToken, generateToken, decrypt, encrypt } from '../_lib/crypto.js';
import { setSessionCookie, clearSessionCookie } from '../_lib/auth.js';
import { verifyTOTP, consumeBackupCode } from '../_lib/totp.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import verifyMagicLinkHandler from '../auth-magic-link-verify.ts';
import completeMagicLinkHandler from '../auth-magic-link-complete.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockHashToken = vi.mocked(hashToken);
const mockGenerateToken = vi.mocked(generateToken);
const mockDecrypt = vi.mocked(decrypt);
const mockEncrypt = vi.mocked(encrypt);
const mockSetSessionCookie = vi.mocked(setSessionCookie);
const mockClearSessionCookie = vi.mocked(clearSessionCookie);
const mockVerifyTOTP = vi.mocked(verifyTOTP);
const mockConsumeBackupCode = vi.mocked(consumeBackupCode);
const mockConsumeToken = vi.mocked(consumeToken);

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockHashToken.mockClear();
  mockGenerateToken.mockClear();
  mockDecrypt.mockClear();
  mockEncrypt.mockClear();
  mockSetSessionCookie.mockClear();
  mockClearSessionCookie.mockClear();
  mockVerifyTOTP.mockReset();
  mockConsumeBackupCode.mockReset();
  mockConsumeToken.mockReset();

  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockConsumeToken.mockResolvedValue({
    allowed: true,
    remainingTokens: 4,
    retryAfterMs: undefined,
  } as never);
});

describe('magic-link MFA flow', () => {
  it('redirects TOTP-enabled magic-link users to login with mfa_pending token instead of issuing a session', async () => {
    // transaction atomically consumes the magic link
    const mockClient = { query: vi.fn() };
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'link_1', email: 'user@example.com' }],
      rowCount: 1,
    });
    mockTransaction.mockImplementationOnce(async (fn: (client: typeof mockClient) => Promise<unknown>) => fn(mockClient));

    // queryOne calls: find user, check TOTP
    mockQueryOne
      .mockResolvedValueOnce({ id: 'user_1' } as never)
      .mockResolvedValueOnce({ totp_enabled: true } as never);

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-verify?token=magic123&redirect=%2Finvite%2Fabc');
    const res = await verifyMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('/login?mfa_pending=');
    expect(location).toContain('redirect=%2Finvite%2Fabc');
    expect(location).not.toBe('http://localhost:8888');

    // The atomic consume happens inside the transaction (client.query), then execute is used for the mfa_pending link
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at = now()');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('INSERT INTO magic_links');
    expect(mockExecute.mock.calls[0]?.[1]?.[1]).toBe('mfa_pending:user_1');
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it('preserves redirect path after successful non-TOTP magic-link sign-in', async () => {
    // transaction atomically consumes the magic link
    const mockClient = { query: vi.fn() };
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'link_2', email: 'user@example.com' }],
      rowCount: 1,
    });
    mockTransaction.mockImplementationOnce(async (fn: (client: typeof mockClient) => Promise<unknown>) => fn(mockClient));

    // queryOne calls: find user, check TOTP, get workspace
    mockQueryOne
      .mockResolvedValueOnce({ id: 'user_1' } as never)
      .mockResolvedValueOnce({ totp_enabled: false } as never)
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-verify?token=magic124&redirect=%2Finvite%2Fxyz');
    const res = await verifyMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('http://localhost:8888/invite/xyz');
    expect(res.headers.get('Set-Cookie')).toContain('flash_session=session-token');
  });

  it('completes magic-link MFA and issues a session after valid TOTP', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'mfa_link_1',
        email: 'mfa_pending:user_1',
        used_at: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      } as never)
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'user@example.com',
        first_name: 'User',
        last_name: 'Example',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: 'enc-secret',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
      } as never);

    mockVerifyTOTP.mockReturnValue(true);

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'pending123', totp_code: '123456' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      user: {
        id: 'user_1',
        email: 'user@example.com',
        first_name: 'User',
        last_name: 'Example',
        is_superadmin: false,
      },
    });
    expect(mockDecrypt).toHaveBeenCalledWith('enc-secret', 'totp:user_1');
    expect(mockVerifyTOTP).toHaveBeenCalledWith('BASE32SECRET', '123456');
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at = now()');
    expect(mockExecute.mock.calls[1]?.[0]).toContain('INSERT INTO sessions');
    expect(mockExecute.mock.calls[2]?.[0]).toContain('UPDATE users SET last_login_at = now()');
    expect(mockSetSessionCookie).toHaveBeenCalledWith('session-token');
    expect(res.headers.get('Set-Cookie')).toContain('flash_session=session-token');

    // Token hashing used for lookup and session storage
    expect(mockHashToken).toHaveBeenCalledWith('pending123');
    expect(mockHashToken).toHaveBeenCalledWith('session-token');
    expect(mockVerifyTOTP.mock.invocationCallOrder[0]).toBeLessThan(mockExecute.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
  });

  it('rate limits MFA completion before token lookup and returns 429 without leaking session state', async () => {
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      remainingTokens: 0,
      retryAfterMs: 12_000,
    } as never);

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'pending123', totp_code: '123456' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: 'Too many MFA attempts. Please try again later.',
    });
    expect(res.headers.get('Retry-After')).toBe('12');
    expect(mockConsumeToken).toHaveBeenCalledTimes(1);
    expect(mockConsumeToken).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:magic-link-mfa:ip:/),
      1,
      10,
      10 / 300
    );
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('finalizes a TOTP-protected password reset after valid MFA without creating a session', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'mfa_reset_link_1',
        email: 'password_reset_mfa_pending_v2:user_1:enc-reset-hash',
        used_at: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      } as never)
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'user@example.com',
        first_name: 'User',
        last_name: 'Example',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: 'enc-secret',
        totp_backup_codes_enc: null,
      } as never);

    mockVerifyTOTP.mockReturnValue(true);
    mockDecrypt
      .mockReturnValueOnce('BASE32SECRET')
      .mockReturnValueOnce('$flash2$salt$derived');

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'reset-mfa-pending', totp_code: '123456' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Password reset successful. Please sign in again.',
    });
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at = now()');
    expect(mockExecute.mock.calls[1]).toEqual([
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      ['$flash2$salt$derived', 'user_1'],
    ]);
    expect(mockExecute.mock.calls[2]).toEqual([
      'DELETE FROM sessions WHERE user_id = $1',
      ['user_1'],
    ]);
    expect(mockDecrypt).toHaveBeenCalledWith('enc-reset-hash', 'password_reset_pending:user_1');
    expect(mockClearSessionCookie).toHaveBeenCalledOnce();
    expect(res.headers.get('Set-Cookie')).toContain('flash_session=');
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed v2 password reset pending payloads as invalid MFA sessions', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'mfa_reset_link_bad',
        email: 'password_reset_mfa_pending_v2:user_1:invalid-envelope',
        used_at: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      } as never)
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'user@example.com',
        first_name: 'User',
        last_name: 'Example',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: 'enc-secret',
        totp_backup_codes_enc: null,
      } as never);

    mockVerifyTOTP.mockReturnValue(true);
    mockDecrypt
      .mockReturnValueOnce('BASE32SECRET')
      .mockImplementationOnce(() => {
        throw new Error('bad envelope');
      });

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'reset-mfa-pending-bad', totp_code: '123456' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid or expired MFA session',
    });
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at = now()');
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE users SET password_hash'))).toBe(false);
  });

  it('accepts a valid backup code for magic-link MFA and rotates remaining backup codes', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'mfa_link_2',
        email: 'mfa_pending:user_2',
        used_at: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      } as never)
      .mockResolvedValueOnce({
        id: 'user_2',
        email: 'user2@example.com',
        first_name: 'Backup',
        last_name: 'User',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: null,
        totp_backup_codes_enc: 'enc-backups',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws_2',
      } as never);

    mockDecrypt.mockReturnValueOnce(JSON.stringify(['ABCD-EFGH', 'IJKL-MNOP']));
    mockConsumeBackupCode.mockReturnValue({
      matched: true,
      remainingCodes: ['IJKL-MNOP'],
    });

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'pending456', totp_code: 'ABCD-EFGH' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(200);
    expect(mockVerifyTOTP).not.toHaveBeenCalled();
    expect(mockDecrypt).toHaveBeenCalledWith('enc-backups', 'totp_backup:user_2');
    expect(mockConsumeBackupCode).toHaveBeenCalledWith(
      ['ABCD-EFGH', 'IJKL-MNOP'],
      'ABCD-EFGH'
    );
    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(['IJKL-MNOP']), 'totp_backup:user_2');
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at = now()');
    expect(mockExecute.mock.calls[1]?.[0]).toContain('UPDATE users SET totp_backup_codes_enc = $1');
    expect(mockExecute.mock.calls[1]?.[0]).toContain('AND totp_backup_codes_enc = $3');
    expect(mockExecute.mock.calls[2]?.[0]).toContain('INSERT INTO sessions');
    expect(mockExecute.mock.calls[3]?.[0]).toContain('UPDATE users SET last_login_at = now()');
  });

  it('rejects MFA completion when the pending token is concurrently consumed before finalization', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'mfa_link_race',
        email: 'mfa_pending:user_3',
        used_at: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      } as never)
      .mockResolvedValueOnce({
        id: 'user_3',
        email: 'user3@example.com',
        first_name: 'Race',
        last_name: 'User',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: 'enc-secret',
        totp_backup_codes_enc: null,
      } as never);
    mockVerifyTOTP.mockReturnValue(true);
    mockExecute.mockResolvedValueOnce({ rowCount: 0 });

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'pending-race', totp_code: '123456' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'This MFA session has already been used',
    });
    expect(mockVerifyTOTP).toHaveBeenCalledOnce();
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });

  it('rejects a magic-link MFA backup code if a concurrent request already consumed it', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'mfa_link_3',
        email: 'mfa_pending:user_3',
        used_at: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      } as never)
      .mockResolvedValueOnce({
        id: 'user_3',
        email: 'user3@example.com',
        first_name: 'Race',
        last_name: 'User',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: null,
        totp_backup_codes_enc: 'enc-backups',
      } as never);

    mockExecute
      .mockResolvedValueOnce({ rowCount: 1 }) // consume pending token
      .mockResolvedValueOnce({ rowCount: 0 }); // backup-code optimistic update loses race
    mockDecrypt.mockReturnValueOnce(JSON.stringify(['ABCD-EFGH']));
    mockConsumeBackupCode.mockReturnValue({
      matched: true,
      remainingCodes: [],
    });

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'pending789', totp_code: 'ABCD-EFGH' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'Backup code was already used. Please try another code.' });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE magic_links SET used_at = now()');
    expect(mockExecute.mock.calls[1]?.[0]).toContain('AND totp_backup_codes_enc = $3');
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO sessions'))).toBe(false);
  });
});
  it('does not consume the pending MFA token when the TOTP code is invalid', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'mfa_link_invalid',
        email: 'mfa_pending:user_bad',
        used_at: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      } as never)
      .mockResolvedValueOnce({
        id: 'user_bad',
        email: 'user@example.com',
        first_name: 'User',
        last_name: 'BadCode',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: 'enc-secret',
        totp_backup_codes_enc: null,
      } as never);

    mockVerifyTOTP.mockReturnValue(false);

    const req = new Request('http://localhost/.netlify/functions/auth-magic-link-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'pending-invalid', totp_code: '000000' }),
    });
    const res = await completeMagicLinkHandler(req, {} as never);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid TOTP code' });
    expect(mockVerifyTOTP).toHaveBeenCalledOnce();
    expect(
      mockExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE magic_links SET used_at = now()'))
    ).toBe(false);
  });
