import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireSessionAuth: vi.fn(),
  validateSession: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  errorResponse: vi.fn((message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  jsonResponse: vi.fn((data: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  ),
  parseJsonBody: vi.fn((req: Request) => req.json()),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../_lib/crypto.js', () => ({
  encrypt: vi.fn(() => 'enc'),
  decrypt: vi.fn(() => 'secret'),
}));

vi.mock('../_lib/totp.js', () => ({
  verifyTOTP: vi.fn(() => true),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { requireSessionAuth } from '../_lib/auth.js';
import { validateSession } from '../_lib/auth.js';
import { queryOne, execute } from '../_lib/db.js';
import authSessionHandler from '../auth-session.ts';
import authTotpSetupHandler from '../auth-totp-setup.ts';
import authTotpVerifyHandler from '../auth-totp-verify.ts';

const mockRequireSessionAuth = vi.mocked(requireSessionAuth);
const mockValidateSession = vi.mocked(validateSession);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSessionAuth.mockResolvedValue({
    authType: 'session',
    user: { id: 'user_1', email: 'u@example.com' },
  } as never);
  mockValidateSession.mockResolvedValue({
    authType: 'session',
    sessionId: 'session_1',
    user: { id: 'user_1', email: 'u@example.com' },
  } as never);
});

function sessionOnlyForbidden(): Response {
  return Response.json(
    { error: 'Forbidden: session authentication required' },
    { status: 403 },
  );
}

describe('account endpoints are session-only', () => {
  it('rejects API key callers for auth-session POST', async () => {
    mockRequireSessionAuth.mockRejectedValueOnce(sessionOnlyForbidden());

    const res = await authSessionHandler(new Request('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear_environment_setup: true }),
    }), {} as never);
    expect(res.status).toBe(403);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 503 with stable code when session validation hits infra quota error', async () => {
    mockValidateSession.mockRejectedValueOnce(new Error('Your account or project has exceeded the compute time quota.'));

    const res = await authSessionHandler(
      new Request('http://localhost/api/auth/session', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('60');
    await expect(res.json()).resolves.toEqual({
      error: 'Authentication service temporarily unavailable. Please retry shortly.',
      code: 'AUTH_SERVICE_UNAVAILABLE',
    });
  });

  it('returns 503 with stable code when auth-session POST hits db infra error', async () => {
    mockRequireSessionAuth.mockRejectedValueOnce(new Error('too many connections'));

    const res = await authSessionHandler(new Request('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear_environment_setup: true }),
    }), {} as never);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Authentication service temporarily unavailable. Please retry shortly.',
      code: 'AUTH_SERVICE_UNAVAILABLE',
    });
  });

  it('rejects API key callers for auth-totp-setup', async () => {
    mockRequireSessionAuth.mockRejectedValueOnce(sessionOnlyForbidden());

    const res = await authTotpSetupHandler(
      new Request('http://localhost/api/auth/totp/setup', { method: 'POST' }),
      {} as never
    );
    expect(res.status).toBe(403);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects API key callers for auth-totp-verify', async () => {
    mockRequireSessionAuth.mockRejectedValueOnce(sessionOnlyForbidden());

    const res = await authTotpVerifyHandler(
      new Request('http://localhost/api/auth/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      }),
      {} as never
    );
    expect(res.status).toBe(403);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
