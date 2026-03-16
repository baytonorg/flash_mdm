import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClientQuery = vi.fn();

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) => fn({ query: mockClientQuery })),
}));

vi.mock('../_lib/crypto.js', () => ({
  generateToken: vi.fn(() => 'magic-token'),
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock('../_lib/resend.js', () => ({
  sendEmail: vi.fn(),
  magicLinkEmail: vi.fn(() => ({ subject: 'Sign in', html: '<p>link</p>' })),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../auth-login.js', () => ({
  hashPassword: vi.fn(() => 'hashed-password'),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

vi.mock('../_lib/platform-settings.js', () => ({
  getPlatformSettings: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { sendEmail } from '../_lib/resend.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import { getPlatformSettings } from '../_lib/platform-settings.js';
import { hashPassword } from '../auth-login.js';
import handler from '../auth-register.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockSendEmail = vi.mocked(sendEmail);
const mockConsumeToken = vi.mocked(consumeToken);
const mockGetPlatformSettings = vi.mocked(getPlatformSettings);
const mockHashPassword = vi.mocked(hashPassword);

function makeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return new Request('http://localhost/.netlify/functions/auth-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'new@example.com',
      password: 'very-strong-password',
      first_name: 'New',
      last_name: 'User',
      workspace_name: 'New Workspace',
      ...overrides,
    }),
  });
}

beforeEach(() => {
  mockClientQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockSendEmail.mockReset();
  mockConsumeToken.mockReset();
  mockGetPlatformSettings.mockReset();
  mockHashPassword.mockClear();

  mockConsumeToken.mockResolvedValue({
    allowed: true,
    remainingTokens: 2,
    retryAfterMs: undefined,
  } as never);
  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe('auth-register invite-only mode', () => {
  it('rejects signup-link registration when email domain is not in allowed_domains', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ count: '5' } as never) // user count
      .mockResolvedValueOnce({
        id: 'signup_link_1',
        scope_type: 'workspace',
        scope_id: 'ws_1',
        default_role: 'member',
        default_access_scope: 'workspace',
        auto_assign_environment_ids: [],
        auto_assign_group_ids: [],
        allow_environment_creation: false,
        allowed_domains: ['company.com'],
      } as never); // signup link by token hash

    const res = await handler(
      makeRequest({ signup_link_token: 'signup-token' }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Email domain is not allowed for this signup link',
    });
    expect(mockGetPlatformSettings).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('allows signup-link registration when email domain matches allowed_domains', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ count: '5' } as never) // user count
      .mockResolvedValueOnce({
        id: 'signup_link_1',
        scope_type: 'workspace',
        scope_id: 'ws_1',
        default_role: 'member',
        default_access_scope: 'workspace',
        auto_assign_environment_ids: [],
        auto_assign_group_ids: [],
        allow_environment_creation: false,
        allowed_domains: ['example.com'],
      } as never) // signup link by token hash
      .mockResolvedValueOnce({ id: 'existing_user' } as never); // existing user lookup
    mockGetPlatformSettings.mockResolvedValueOnce({
      invite_only_registration: false,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });

    const res = await handler(
      makeRequest({ signup_link_token: 'signup-token' }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      message: 'Account created. Check your email to sign in.',
    });
    expect(mockGetPlatformSettings).toHaveBeenCalledOnce();
    expect(mockHashPassword).toHaveBeenCalledWith('very-strong-password');
    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, $3)',
      expect.arrayContaining(['hash:magic-token', 'new@example.com'])
    );
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('blocks self-serve registration when invite-only mode is enabled', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '5' } as never);
    mockGetPlatformSettings.mockResolvedValueOnce({
      invite_only_registration: true,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });

    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Registration is disabled. Ask an admin for an invitation.',
    });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('allows invite-onboarding registration in invite-only mode without creating a new workspace when a pending invite exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ count: '5' } as never) // user count
      .mockResolvedValueOnce({ id: 'invite_1', permissions: { invite_type: 'workspace_access' } } as never) // pending invite
      .mockResolvedValueOnce(null as never); // existing user lookup
    mockGetPlatformSettings.mockResolvedValueOnce({
      invite_only_registration: true,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });

    const res = await handler(
      makeRequest({
        workspace_name: '',
        redirect_path: '/invite/token_123',
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      message: 'Account created. Check your email to sign in.',
    });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, $3)',
      expect.arrayContaining(['hash:magic-token', 'new@example.com'])
    );
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO workspaces'))).toBe(false);
  });

  it('requires workspace name for platform invite onboarding and still allows registration in invite-only mode', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ count: '5' } as never) // user count
      .mockResolvedValueOnce({ id: 'invite_platform', permissions: { invite_type: 'platform_access' } } as never); // pending invite
    mockGetPlatformSettings.mockResolvedValueOnce({
      invite_only_registration: true,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });

    const res = await handler(
      makeRequest({
        workspace_name: '',
        redirect_path: '/invite/token_platform',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Workspace name is required',
    });
  });

  it('still allows bootstrap registration for the first user even when invite-only is enabled', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ count: '0' } as never) // user count
      .mockResolvedValueOnce(null as never); // existing user lookup

    const res = await handler(makeRequest(), {} as never);

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      message: 'Account created. Check your email to sign in.',
    });
    expect(mockGetPlatformSettings).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, $3)',
      expect.arrayContaining(['hash:magic-token', 'new@example.com'])
    );
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });
});
