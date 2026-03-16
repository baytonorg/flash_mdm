import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireSessionAuth: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(() => 'enc-next-backups'),
}));

vi.mock('../_lib/totp.js', () => ({
  verifyTOTP: vi.fn(() => false),
  consumeBackupCode: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

import { requireSessionAuth } from '../_lib/auth.js';
import { queryOne, execute } from '../_lib/db.js';
import { decrypt } from '../_lib/crypto.js';
import { consumeBackupCode } from '../_lib/totp.js';
import { logAudit } from '../_lib/audit.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import handler from '../auth-totp-verify.ts';

const mockRequireSessionAuth = vi.mocked(requireSessionAuth);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockDecrypt = vi.mocked(decrypt);
const mockConsumeBackupCode = vi.mocked(consumeBackupCode);
const mockLogAudit = vi.mocked(logAudit);
const mockConsumeToken = vi.mocked(consumeToken);

beforeEach(() => {
  mockRequireSessionAuth.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockDecrypt.mockReset();
  mockConsumeBackupCode.mockReset();
  mockLogAudit.mockReset();
  mockConsumeToken.mockReset();

  mockRequireSessionAuth.mockResolvedValue({
    authType: 'session',
    user: { id: 'user_1', email: 'user@example.com' },
  } as never);

  mockConsumeToken.mockResolvedValue({
    allowed: true,
    remainingTokens: 4,
    retryAfterMs: undefined,
  } as never);
  mockExecute.mockResolvedValue({ rowCount: 1 } as never);
});

describe('auth-totp-verify hardening', () => {
  it('rate limits verify attempts and returns 429 with Retry-After', async () => {
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      remainingTokens: 0,
      retryAfterMs: 6_000,
    } as never);

    const res = await handler(
      new Request('http://localhost/api/auth/totp-verify/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      }),
      {} as never
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: 'Too many TOTP attempts. Please try again later.',
    });
    expect(res.headers.get('Retry-After')).toBe('6');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rate limits disable attempts and returns 429 with Retry-After', async () => {
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      remainingTokens: 0,
      retryAfterMs: 8_000,
    } as never);

    const res = await handler(
      new Request('http://localhost/api/auth/totp-verify/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ABCD-EFGH' }),
      }),
      {} as never
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: 'Too many TOTP attempts. Please try again later.',
    });
    expect(res.headers.get('Retry-After')).toBe('8');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('disables TOTP with a valid backup code and rotates remaining codes', async () => {
    mockQueryOne.mockResolvedValueOnce({
      totp_enabled: true,
      totp_secret_enc: null,
      totp_backup_codes_enc: 'enc-backups',
    } as never);
    mockDecrypt.mockReturnValueOnce(JSON.stringify(['ABCD-EFGH', 'IJKL-MNOP']));
    mockConsumeBackupCode.mockReturnValueOnce({
      matched: true,
      remainingCodes: ['IJKL-MNOP'],
    });

    const res = await handler(
      new Request('http://localhost/api/auth/totp-verify/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ABCD-EFGH' }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ message: 'TOTP disabled successfully' });
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE users SET totp_backup_codes_enc = $1');
    expect(mockExecute.mock.calls[0]?.[0]).toContain('AND totp_backup_codes_enc = $3');
    expect(mockExecute.mock.calls[1]?.[0]).toContain('SET totp_enabled = false');
    expect(mockExecute.mock.calls[1]?.[0]).toContain('totp_pending_created_at = NULL');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.backup_code_used',
      details: expect.objectContaining({ method: 'totp_disable' }),
    }));
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.totp_disabled',
    }));
  });

  it('returns 409 when backup-code CAS update loses the race', async () => {
    mockQueryOne.mockResolvedValueOnce({
      totp_enabled: true,
      totp_secret_enc: null,
      totp_backup_codes_enc: 'enc-backups',
    } as never);
    mockDecrypt.mockReturnValueOnce(JSON.stringify(['ABCD-EFGH']));
    mockConsumeBackupCode.mockReturnValueOnce({
      matched: true,
      remainingCodes: [],
    });
    mockExecute.mockResolvedValueOnce({ rowCount: 0 } as never);

    const res = await handler(
      new Request('http://localhost/api/auth/totp-verify/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ABCD-EFGH' }),
      }),
      {} as never
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Backup code was already used. Please try another code.',
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('clears pending setup timestamp when pending TOTP setup has expired', async () => {
    mockQueryOne.mockResolvedValueOnce({
      totp_pending_enc: 'enc-pending',
      totp_enabled: false,
    } as never);
    mockDecrypt.mockReturnValueOnce(JSON.stringify({
      secret: 'BASE32SECRET',
      backup_codes: ['ABCD-EFGH'],
      created_at: new Date(Date.now() - (16 * 60 * 1000)).toISOString(),
    }));

    const res = await handler(
      new Request('http://localhost/api/auth/totp-verify/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'TOTP setup has expired. Please start again.',
    });
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE users SET totp_pending_enc = NULL, totp_pending_created_at = NULL WHERE id = $1',
      ['user_1']
    );
  });
});
