import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  generateToken: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock('../_lib/resend.js', () => ({
  sendEmail: vi.fn(),
  magicLinkEmail: vi.fn(() => ({ subject: 'Sign in', html: '<p>link</p>' })),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

vi.mock('../_lib/platform-settings.js', () => ({
  getPlatformSettings: vi.fn(),
}));

vi.mock('../auth-login.js', () => ({
  hashPassword: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  setSessionCookie: vi.fn(),
  SESSION_MAX_AGE_MILLISECONDS: 1000,
}));

import { consumeToken } from '../_lib/rate-limiter.js';
import { queryOne } from '../_lib/db.js';
import { getPlatformSettings } from '../_lib/platform-settings.js';
import handler from '../auth-register.ts';
import { MIN_PASSWORD_LENGTH } from '../_lib/password-policy.js';

const mockConsumeToken = vi.mocked(consumeToken);
const mockQueryOne = vi.mocked(queryOne);
const mockGetPlatformSettings = vi.mocked(getPlatformSettings);

function makeRequest(password: string) {
  return new Request('http://localhost/.netlify/functions/auth-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'new@example.com',
      password,
      first_name: 'New',
      last_name: 'User',
      workspace_name: 'Workspace',
    }),
  });
}

describe('auth-register password policy', () => {
  beforeEach(() => {
    mockConsumeToken.mockReset();
    mockQueryOne.mockReset();
    mockGetPlatformSettings.mockReset();
  });

  it('rejects passwords shorter than the minimum length', async () => {
    const shortPassword = 'x'.repeat(Math.max(1, MIN_PASSWORD_LENGTH - 1));
    const res = await handler(makeRequest(shortPassword), {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
    expect(mockConsumeToken).not.toHaveBeenCalled();
  });

  it('allows signup-link registration without a password', async () => {
    mockConsumeToken.mockResolvedValue({
      allowed: true,
      remainingTokens: 2,
      retryAfterMs: undefined,
    } as never);
    mockGetPlatformSettings.mockResolvedValue({
      invite_only_registration: false,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });
    mockQueryOne
      .mockResolvedValueOnce({ count: '5' } as never)
      .mockResolvedValueOnce({
        id: 'signup_link_1',
        scope_type: 'workspace',
        scope_id: 'ws_1',
        default_role: 'viewer',
        default_access_scope: 'scoped',
        auto_assign_environment_ids: [],
        auto_assign_group_ids: [],
        allow_environment_creation: true,
        allowed_domains: [],
      } as never)
      .mockResolvedValueOnce({ id: 'existing_user' } as never);

    const res = await handler(
      new Request('http://localhost/.netlify/functions/auth-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@example.com',
          first_name: 'New',
          last_name: 'User',
          signup_link_token: 'signup-token',
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      message: 'Account created. Check your email to sign in.',
    });
  });
});
