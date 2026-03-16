import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  validateSession: vi.fn(),
  requireSuperadmin: vi.fn(),
  getSessionTokenFromCookie: vi.fn(),
  setSessionCookie: vi.fn((token: string) => `flash_session=${token}`),
  clearSessionCookie: vi.fn(() => 'flash_session=; Max-Age=0'),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  generateToken: vi.fn(() => 'generated-token'),
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/stripe.js', () => ({
  getStripe: vi.fn(),
}));

vi.mock('../migrate.js', () => ({
  default: vi.fn(),
}));

import { validateSession, requireSuperadmin, clearSessionCookie } from '../_lib/auth.js';
import { queryOne, execute, transaction } from '../_lib/db.js';
import { generateToken, hashToken } from '../_lib/crypto.js';
import { getStripe } from '../_lib/stripe.js';
import migrateHandler from '../migrate.js';
import handler from '../superadmin-actions.ts';

const mockValidateSession = vi.mocked(validateSession);
const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockClearSessionCookie = vi.mocked(clearSessionCookie);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockGenerateToken = vi.mocked(generateToken);
const mockHashToken = vi.mocked(hashToken);
const mockGetStripe = vi.mocked(getStripe);
const mockMigrateHandler = vi.mocked(migrateHandler);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/.netlify/functions/superadmin-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  mockValidateSession.mockReset();
  mockRequireSuperadmin.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockGenerateToken.mockClear();
  mockHashToken.mockClear();
  mockGetStripe.mockReset();
  mockMigrateHandler.mockReset();
  mockClearSessionCookie.mockClear();
  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockGetStripe.mockReturnValue({
    subscriptions: {
      cancel: vi.fn().mockResolvedValue({ id: 'sub_123', status: 'canceled' }),
    },
  } as never);
  mockTransaction.mockImplementation(async (fn: (client: { query: typeof vi.fn }) => Promise<unknown>) => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    return fn(client);
  });
});

describe('superadmin-actions security boundaries', () => {
  it('blocks impersonating a superadmin account', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'hash:admin-sess',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);

    mockQueryOne.mockResolvedValueOnce({
      id: 'sa_2',
      email: 'other-admin@example.com',
      is_superadmin: true,
    } as never);

    const res = await handler(
      makeRequest({
        action: 'impersonate',
        target_id: 'sa_2',
        params: {
          support_reason: 'Investigating issue',
          customer_notice_acknowledged: true,
          impersonation_mode: 'read_only',
        },
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Cannot impersonate a superadmin account',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('does not mint a fallback superadmin session when parent session expired during stop_impersonation', async () => {
    mockValidateSession.mockResolvedValue({
      sessionId: 'hash:imp-session',
      user: { id: 'customer_1', is_superadmin: false },
    } as never);

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'hash:imp-session',
        user_id: 'customer_1',
        impersonated_by: 'sa_1',
        impersonator_session_id: 'hash:parent',
      } as never)
      .mockResolvedValueOnce(null as never); // parent session missing/expired

    const res = await handler(
      makeRequest({ action: 'stop_impersonation' }),
      {} as never
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'Original superadmin session expired. Please sign in again.',
    });
    expect(res.headers.get('Set-Cookie')).toBe('flash_session=; Max-Age=0');
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1);

    // Only the impersonation session is deleted; no new privileged session is created.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM sessions WHERE id = $1',
      ['hash:imp-session']
    );
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockHashToken).not.toHaveBeenCalled();
  });

  it('runs migrations via the server-side migration handler without requiring target_id', async () => {
    process.env.MIGRATION_SECRET = 'test-secret';
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);
    mockMigrateHandler.mockResolvedValue(
      Response.json({
        summary: { total: 17, applied: 1, skipped: 16, errors: 0 },
      })
    );

    const res = await handler(
      makeRequest({ action: 'run_migrations' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Migrations completed',
      summary: { total: 17, applied: 1, skipped: 16, errors: 0 },
    });
    expect(mockMigrateHandler).toHaveBeenCalledTimes(1);
    const internalReq = mockMigrateHandler.mock.calls[0]?.[0] as Request;
    expect(internalReq.method).toBe('GET');
    expect(internalReq.headers.get('x-migration-secret')).toBe('test-secret');
  });

  it('grants superadmin access to a target user', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);

    mockQueryOne.mockResolvedValueOnce({
      id: 'user_2',
      email: 'ops@example.com',
      is_superadmin: false,
    } as never);

    const res = await handler(
      makeRequest({ action: 'grant_superadmin', target_id: 'user_2' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'ops@example.com granted superadmin access',
    });
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE users SET is_superadmin = true, updated_at = now() WHERE id = $1',
      ['user_2']
    );
  });

  it('revokes superadmin access from a target user', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);

    mockQueryOne.mockResolvedValueOnce({
      id: 'user_2',
      email: 'ops@example.com',
      is_superadmin: true,
    } as never);

    const res = await handler(
      makeRequest({ action: 'revoke_superadmin', target_id: 'user_2' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'ops@example.com superadmin access revoked',
    });
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE users SET is_superadmin = false, updated_at = now() WHERE id = $1',
      ['user_2']
    );
  });

  it('blocks permanent delete while user still has workspace memberships', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'user_2',
        email: 'ops@example.com',
        is_superadmin: false,
      } as never)
      .mockResolvedValueOnce({
        membership_count: 1,
      } as never);

    const res = await handler(
      makeRequest({ action: 'delete_user', target_id: 'user_2' }),
      {} as never
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Remove user from all workspaces before permanent deletion',
    });
  });

  it('wraps purge_data deletes in a single transaction', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);
    mockQueryOne.mockResolvedValueOnce({ id: 'ws_1' } as never);

    const txQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    mockTransaction.mockImplementationOnce(async (fn: (client: { query: typeof txQuery }) => Promise<unknown>) => {
      return fn({ query: txQuery });
    });

    const res = await handler(
      makeRequest({
        action: 'purge_data',
        target_id: 'ws_1',
        params: {
          support_reason: 'Customer requested workspace reset',
          customer_notice_acknowledged: true,
        },
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Workspace data purged',
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(txQuery).toHaveBeenCalledTimes(2);
    expect(txQuery).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM environments WHERE workspace_id = $1',
      ['ws_1']
    );
    expect(txQuery).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM licenses WHERE workspace_id = $1',
      ['ws_1']
    );
  });

  it('cancels workspace Stripe subscription and closes grants', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);
    mockQueryOne
      .mockResolvedValueOnce({ id: 'ws_1', name: 'Workspace One' } as never)
      .mockResolvedValueOnce({ id: 'lic_1', stripe_subscription_id: 'sub_123' } as never);

    const txQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    mockTransaction.mockImplementationOnce(async (fn: (client: { query: typeof txQuery }) => Promise<unknown>) => {
      return fn({ query: txQuery });
    });

    const res = await handler(
      makeRequest({
        action: 'cancel_workspace_subscription',
        target_id: 'ws_1',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Workspace Stripe subscription cancelled',
    });
    const stripeClient = mockGetStripe.mock.results[0]?.value as { subscriptions: { cancel: ReturnType<typeof vi.fn> } };
    expect(stripeClient.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE licenses'),
      ['ws_1', 'sub_123']
    );
    expect(txQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE license_grants'),
      ['ws_1', 'sub_123']
    );
  });

  it('returns 404 when no workspace subscription exists', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);
    mockQueryOne
      .mockResolvedValueOnce({ id: 'ws_1', name: 'Workspace One' } as never)
      .mockResolvedValueOnce(null as never);

    const res = await handler(
      makeRequest({
        action: 'cancel_workspace_subscription',
        target_id: 'ws_1',
      }),
      {} as never
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'No workspace license subscription found',
    });
  });

  it('rejects purge_data requests without confirmation parameters', async () => {
    mockRequireSuperadmin.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'sa_1', is_superadmin: true },
    } as never);

    const res = await handler(
      makeRequest({ action: 'purge_data', target_id: 'ws_1' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'params.support_reason is required for purge_data',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
