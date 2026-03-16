import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../crypto.js', () => ({
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

import { queryOne, execute } from '../db.js';
import { validateSession, requireAuth } from '../auth.js';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sess_hash_1',
    id: 'user_1',
    email: 'user@example.com',
    first_name: 'Test',
    last_name: 'User',
    is_superadmin: false,
    workspace_id: 'ws_1',
    environment_id: 'env_1',
    active_group_id: null,
    impersonated_by: null,
    impersonator_session_id: null,
    impersonated_by_email: null,
    impersonation_mode: null,
    support_reason: null,
    support_ticket_ref: null,
    customer_notice_acknowledged_at: null,
    expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  } as never;
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  vi.restoreAllMocks();
  mockExecute.mockResolvedValue({ rowCount: 1 });
});

describe('validateSession', () => {
  it('renews session expiry when within renewal window', async () => {
    const fixedNow = new Date('2026-02-22T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockQueryOne.mockResolvedValueOnce(
      makeSessionRow({
        expires_at: new Date(fixedNow + 2 * 24 * 60 * 60 * 1000).toISOString(),
      })
    );

    const req = new Request('http://localhost/api/auth/session', {
      headers: { cookie: 'flash_session=plain-session' },
    });
    const auth = await validateSession(req);

    expect(auth?.user.id).toBe('user_1');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0]?.[0]).toContain('UPDATE sessions SET expires_at = $1');
    expect(mockExecute.mock.calls[0]?.[1]?.[1]).toBe('sess_hash_1');
  });

  it('does not renew session expiry when outside renewal window', async () => {
    const fixedNow = new Date('2026-02-22T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockQueryOne.mockResolvedValueOnce(
      makeSessionRow({
        expires_at: new Date(fixedNow + 10 * 24 * 60 * 60 * 1000).toISOString(),
      })
    );

    const req = new Request('http://localhost/api/auth/session', {
      headers: { cookie: 'flash_session=plain-session' },
    });
    const auth = await validateSession(req);

    expect(auth?.user.email).toBe('user@example.com');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('falls back to legacy sessions query when newer session columns are missing', async () => {
    const missingColumnErr = Object.assign(new Error('column does not exist'), { code: '42703' });
    mockQueryOne
      .mockRejectedValueOnce(missingColumnErr)
      .mockResolvedValueOnce(
        makeSessionRow({
          environment_id: null,
          active_group_id: null,
          impersonated_by: null,
          impersonator_session_id: null,
          impersonated_by_email: null,
          impersonation_mode: null,
          support_reason: null,
          support_ticket_ref: null,
          customer_notice_acknowledged_at: null,
          expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        })
      );

    const req = new Request('http://localhost/api/auth/session', {
      headers: { cookie: 'flash_session=plain-session' },
    });
    const auth = await validateSession(req);

    expect(auth?.user.id).toBe('user_1');
    expect(auth?.user.environment_id).toBeNull();
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });
});

describe('requireAuth CSRF enforcement', () => {
  it('rejects mutating requests without X-Requested-With header', async () => {
    mockQueryOne.mockResolvedValueOnce(makeSessionRow());

    const req = new Request('http://localhost/api/devices/list', {
      method: 'POST',
      headers: {
        cookie: 'flash_session=plain-session',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    try {
      await requireAuth(req);
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const res = err as Response;
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({
        error: 'Missing required X-Requested-With header',
      });
    }
  });

  it('rejects mutating requests with mismatched Origin', async () => {
    mockQueryOne.mockResolvedValueOnce(makeSessionRow());

    const req = new Request('http://localhost/api/devices/list', {
      method: 'POST',
      headers: {
        cookie: 'flash_session=plain-session',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://evil.example',
      },
      body: '{}',
    });

    try {
      await requireAuth(req);
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const res = err as Response;
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({
        error: 'Cross-origin requests are not allowed',
      });
    }
  });

  it('accepts mutating requests authenticated with bearer API key without X-Requested-With', async () => {
    mockQueryOne.mockResolvedValueOnce({
        api_key_id: 'ak_1',
        key_name: 'Local client',
        scope_type: 'workspace',
        workspace_id: 'ws_1',
        environment_id: null,
        role: 'owner',
        created_by_user_id: 'user_1',
        expires_at: null,
        user_id: 'user_1',
        email: 'user@example.com',
        first_name: 'Test',
        last_name: 'User',
        is_superadmin: true,
        totp_enabled: false,
      } as never);

    const req = new Request('http://localhost/api/devices/list', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer flash_workspace_test_key',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    const auth = await requireAuth(req);

    expect(auth.authType).toBe('api_key');
    expect(auth.sessionId).toBeNull();
    expect(auth.user.is_superadmin).toBe(false);
    expect(auth.apiKey).toEqual(expect.objectContaining({
      id: 'ak_1',
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      role: 'owner',
    }));
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE api_keys SET last_used_at = now(), last_used_ip = $2 WHERE id = $1',
      ['ak_1', null]
    );
  });

  it('rejects expired API keys', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const req = new Request('http://localhost/api/devices/list', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer flash_workspace_expired',
      },
    });

    try {
      await requireAuth(req);
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const res = err as Response;
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    }

    expect(String(mockQueryOne.mock.calls[0]?.[0] ?? '')).toContain('ak.expires_at IS NULL OR ak.expires_at > now()');
  });
});
