import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  setSessionCookie: vi.fn((token: string) => `flash_session=${token}`),
  SESSION_MAX_AGE_MILLISECONDS: 14 * 24 * 60 * 60 * 1000,
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(() => 'enc-next-backups'),
  generateToken: vi.fn(() => 'session-token'),
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock('../_lib/totp.js', () => ({
  verifyTOTP: vi.fn(() => false),
  consumeBackupCode: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { logAudit } from '../_lib/audit.js';
import { decrypt, encrypt } from '../_lib/crypto.js';
import { verifyTOTP, consumeBackupCode } from '../_lib/totp.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import handler, { _hashPassword } from '../auth-login.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockLogAudit = vi.mocked(logAudit);
const mockDecrypt = vi.mocked(decrypt);
const mockEncrypt = vi.mocked(encrypt);
const mockVerifyTOTP = vi.mocked(verifyTOTP);
const mockConsumeBackupCode = vi.mocked(consumeBackupCode);
const mockConsumeToken = vi.mocked(consumeToken);

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockLogAudit.mockReset();
  mockDecrypt.mockReset();
  mockEncrypt.mockClear();
  mockVerifyTOTP.mockReset();
  mockConsumeBackupCode.mockReset();
  mockConsumeToken.mockReset();

  mockConsumeToken.mockResolvedValue({
    allowed: true,
    remainingTokens: 9,
    retryAfterMs: undefined,
  } as never);
  mockExecute.mockResolvedValue({ rowCount: 1 });
});

describe('auth-login backup code flow', () => {
  it('keeps IP rate limiting behavior and short-circuits before account throttling', async () => {
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      remainingTokens: 0,
      retryAfterMs: 60_000,
    } as never);

    const req = new Request('http://localhost/.netlify/functions/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'wrong-password',
      }),
    });

    const res = await handler(req, {} as never);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many login attempts. Please try again later.',
    });
    expect(mockConsumeToken).toHaveBeenCalledTimes(1);
    expect(mockConsumeToken).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:login:ip:/),
      1,
      10,
      10 / 900
    );
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('applies per-account throttling using normalized email without querying account existence', async () => {
    mockConsumeToken
      .mockResolvedValueOnce({
        allowed: true,
        remainingTokens: 9,
      } as never)
      .mockResolvedValueOnce({
        allowed: false,
        remainingTokens: 0,
        retryAfterMs: 120_000,
      } as never);

    const req = new Request('http://localhost/.netlify/functions/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '  USER@Example.COM  ',
        password: 'wrong-password',
      }),
    });

    const res = await handler(req, {} as never);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many login attempts. Please try again later.',
    });
    expect(mockConsumeToken).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^auth:login:ip:/),
      1,
      10,
      10 / 900
    );
    expect(mockConsumeToken).toHaveBeenNthCalledWith(
      2,
      'auth:login:acct:user@example.com',
      1,
      5,
      5 / 900
    );
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('accepts a valid backup code and rotates stored backup codes', async () => {
    const password = 'very-strong-password';
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'user@example.com',
        password_hash: _hashPassword(password),
        first_name: 'User',
        last_name: 'Example',
        is_superadmin: false,
        totp_enabled: true,
        totp_secret_enc: null,
        totp_backup_codes_enc: 'enc-backups',
      } as never)
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);

    mockDecrypt.mockReturnValueOnce(JSON.stringify(['ABCD-EFGH', 'IJKL-MNOP']));
    mockConsumeBackupCode.mockReturnValue({
      matched: true,
      remainingCodes: ['IJKL-MNOP'],
    });

    const req = new Request('http://localhost/.netlify/functions/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password,
        totp_code: 'ABCD-EFGH',
      }),
    });

    const res = await handler(req, {} as never);

    expect(res.status).toBe(200);
    expect(mockDecrypt).toHaveBeenCalledWith('enc-backups', 'totp_backup:user_1');
    expect(mockConsumeBackupCode).toHaveBeenCalledWith(
      ['ABCD-EFGH', 'IJKL-MNOP'],
      'ABCD-EFGH'
    );
    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(['IJKL-MNOP']), 'totp_backup:user_1');
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE users SET totp_backup_codes_enc = $1');
    expect(mockExecute.mock.calls[0]?.[0]).toContain('AND totp_backup_codes_enc = $3');
    expect(mockExecute.mock.calls[1]?.[0]).toContain('INSERT INTO sessions');
    expect(mockExecute.mock.calls[2]?.[0]).toContain('UPDATE users SET last_login_at = now()');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.backup_code_used',
    }));
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.login',
    }));
  });

  it('applies dedicated TOTP-stage throttling after password verification', async () => {
    const password = 'very-strong-password';
    mockQueryOne.mockResolvedValueOnce({
      id: 'user_1',
      email: 'user@example.com',
      password_hash: _hashPassword(password),
      first_name: 'User',
      last_name: 'Example',
      is_superadmin: false,
      totp_enabled: true,
      totp_secret_enc: 'enc-secret',
      totp_backup_codes_enc: null,
    } as never);

    mockConsumeToken
      .mockResolvedValueOnce({ allowed: true, remainingTokens: 9 } as never) // auth:login:ip
      .mockResolvedValueOnce({ allowed: true, remainingTokens: 4 } as never) // auth:login:acct
      .mockResolvedValueOnce({ allowed: false, remainingTokens: 0, retryAfterMs: 9_000 } as never); // auth:login:totp:ip

    const res = await handler(
      new Request('http://localhost/.netlify/functions/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password,
          totp_code: '123456',
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('9');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many login attempts. Please try again later.',
    });
    expect(mockConsumeToken).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/^auth:login:totp:ip:/),
      1,
      10,
      10 / 300
    );
    expect(mockVerifyTOTP).not.toHaveBeenCalled();
  });

  it('rejects a backup code if a concurrent request already consumed it', async () => {
    const password = 'very-strong-password';
    mockQueryOne.mockResolvedValueOnce({
      id: 'user_1',
      email: 'user@example.com',
      password_hash: _hashPassword(password),
      first_name: 'User',
      last_name: 'Example',
      is_superadmin: false,
      totp_enabled: true,
      totp_secret_enc: null,
      totp_backup_codes_enc: 'enc-backups',
    } as never);

    mockDecrypt.mockReturnValueOnce(JSON.stringify(['ABCD-EFGH']));
    mockConsumeBackupCode.mockReturnValue({
      matched: true,
      remainingCodes: [],
    });
    mockExecute.mockResolvedValueOnce({ rowCount: 0 });

    const req = new Request('http://localhost/.netlify/functions/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password,
        totp_code: 'ABCD-EFGH',
      }),
    });

    const res = await handler(req, {} as never);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid TOTP code' });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('AND totp_backup_codes_enc = $3');
    expect(mockLogAudit).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.backup_code_used',
    }));
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.login_failed',
      details: { reason: 'invalid_totp' },
    }));
  });

  it('conditionally migrates legacy password hashes to avoid overwriting concurrent updates', async () => {
    const password = 'very-strong-password';
    const salt = 'legacysalt';
    const legacyHash = `$flash$${salt}$${createHash('sha256').update(password + salt).digest('hex')}`;

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'user_legacy',
        email: 'legacy@example.com',
        password_hash: legacyHash,
        first_name: 'Legacy',
        last_name: 'User',
        is_superadmin: false,
        totp_enabled: false,
        totp_secret_enc: null,
        totp_backup_codes_enc: null,
      } as never)
      .mockResolvedValueOnce({ workspace_id: 'ws_1' } as never);

    const req = new Request('http://localhost/.netlify/functions/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'legacy@example.com',
        password,
      }),
    });

    const res = await handler(req, {} as never);

    expect(res.status).toBe(200);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3');
    expect(mockExecute.mock.calls[0]?.[1]?.[1]).toBe('user_legacy');
    expect(mockExecute.mock.calls[0]?.[1]?.[2]).toBe(legacyHash);
  });

  it('burns password verification work on user-not-found responses to reduce timing enumeration', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const req = new Request('http://localhost/.netlify/functions/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'missing@example.com',
        password: 'very-strong-password',
      }),
    });

    const started = Date.now();
    const res = await handler(req, {} as never);
    const elapsedMs = Date.now() - started;

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid email or password' });
    expect(elapsedMs).toBeGreaterThanOrEqual(5);
  });
});
