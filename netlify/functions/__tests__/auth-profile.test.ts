import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireSessionAuth: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { requireSessionAuth } from '../_lib/auth.js';
import { queryOne } from '../_lib/db.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../auth-profile.ts';

const mockRequireSessionAuth = vi.mocked(requireSessionAuth);
const mockQueryOne = vi.mocked(queryOne);
const mockLogAudit = vi.mocked(logAudit);

function request(body: Record<string, unknown>, method = 'PUT') {
  return new Request('http://localhost/api/auth/profile', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSessionAuth.mockResolvedValue({
    authType: 'session',
    sessionId: 'session_1',
    user: {
      id: 'user_1',
      email: 'old@example.com',
      first_name: 'Old',
      last_name: 'Name',
      is_superadmin: false,
      totp_enabled: false,
      workspace_id: 'workspace_1',
      environment_id: null,
      active_group_id: null,
    },
  } as never);
});

describe('auth-profile', () => {
  it('updates and returns the authenticated user profile', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'user_1',
      email: 'new@example.com',
      first_name: 'New',
      last_name: null,
      is_superadmin: false,
      totp_enabled: false,
    } as never);

    const response = await handler(request({
      first_name: '  New  ',
      last_name: '',
      email: ' New@Example.com ',
    }), {} as never);

    expect(response.status).toBe(200);
    expect(mockRequireSessionAuth).toHaveBeenCalledOnce();
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      ['user_1', 'New', null, 'new@example.com'],
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'workspace_1',
      user_id: 'user_1',
      action: 'auth.profile_updated',
      resource_type: 'user',
      resource_id: 'user_1',
    }));
    await expect(response.json()).resolves.toMatchObject({
      user: { id: 'user_1', email: 'new@example.com', first_name: 'New', last_name: null },
    });
  });

  it('rejects invalid profile input before writing', async () => {
    const response = await handler(request({ first_name: 'Name', last_name: '', email: 'not-an-email' }), {} as never);

    expect(response.status).toBe(400);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns conflict when the email is already in use', async () => {
    mockQueryOne.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));

    const response = await handler(request({ first_name: '', last_name: '', email: 'used@example.com' }), {} as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'That email address is already in use' });
  });

  it('propagates session-only authorization failures', async () => {
    mockRequireSessionAuth.mockRejectedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));

    const response = await handler(request({ first_name: '', last_name: '', email: 'user@example.com' }), {} as never);

    expect(response.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods', async () => {
    const response = await handler(request({}, 'POST'), {} as never);
    expect(response.status).toBe(405);
  });
});
