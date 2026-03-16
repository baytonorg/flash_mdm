import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspacePermission: vi.fn(),
  requireWorkspaceResourcePermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  encrypt: vi.fn(),
  generateToken: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { execute, query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import {
  requireEnvironmentResourcePermission,
  requireWorkspacePermission,
  requireWorkspaceResourcePermission,
} from '../_lib/rbac.js';
import { encrypt, generateToken, hashToken } from '../_lib/crypto.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../api-key-crud.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspacePermission = vi.mocked(requireWorkspacePermission);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockEncrypt = vi.mocked(encrypt);
const mockGenerateToken = vi.mocked(generateToken);
const mockHashToken = vi.mocked(hashToken);
const mockLogAudit = vi.mocked(logAudit);
const VALID_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const VALID_ENVIRONMENT_ID = '22222222-2222-4222-8222-222222222222';
const VALID_API_KEY_ID = '33333333-3333-4333-8333-333333333333';

function ownerSessionAuth() {
  return {
    authType: 'session',
    sessionId: 'sess_1',
    user: {
      id: 'user_1',
      email: 'owner@example.com',
      is_superadmin: false,
    },
  } as never;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireWorkspacePermission.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockEncrypt.mockReset();
  mockGenerateToken.mockReset();
  mockHashToken.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue(ownerSessionAuth());
  mockRequireWorkspacePermission.mockResolvedValue('owner' as never);
  mockRequireWorkspaceResourcePermission.mockResolvedValue('owner' as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue('owner' as never);
  mockGenerateToken.mockReturnValue('generated-token' as never);
  mockHashToken.mockImplementation((value: string) => `hash:${value}`);
  mockEncrypt.mockReturnValue('enc-token' as never);
  mockExecute.mockResolvedValue({ rowCount: 1 } as never);
});

describe('api-key-crud', () => {
  it('lists workspace keys for admins without returning token secrets', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'ak_1',
        name: 'CLI',
        scope_type: 'workspace',
        workspace_id: 'ws_1',
        environment_id: null,
        role: 'owner',
        token_enc: 'enc-1',
        token_prefix: 'flash_workspace_abc',
        created_by_user_id: 'user_1',
        created_by_email: 'owner@example.com',
        created_by_name: 'Owner User',
        created_at: '2026-02-25T10:00:00.000Z',
        expires_at: null,
        last_used_at: null,
        last_used_ip: null,
        revoked_at: null,
      },
    ] as never);

    const res = await handler(
      new Request(`http://localhost/api/api-keys/list?workspace_id=${VALID_WORKSPACE_ID}`),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      api_keys: [
        expect.objectContaining({
          id: 'ak_1',
          token: null,
          token_prefix: 'flash_workspace_abc',
          created_by_name: 'Owner User',
        }),
      ],
    });
    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith(expect.anything(), VALID_WORKSPACE_ID, 'write');
  });

  it('rejects malformed UUIDs for list filters before DB access', async () => {
    const res = await handler(
      new Request('http://localhost/api/api-keys/list?workspace_id=ws_1'),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'workspace_id must be a valid UUID' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('creates a workspace-scoped API key for workspace owners', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'ak_new',
      created_at: '2026-02-25T10:00:00.000Z',
    } as never);

    const req = new Request('http://localhost/api/api-keys/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope_type: 'workspace',
        workspace_id: VALID_WORKSPACE_ID,
        name: 'Local tooling',
        role: 'viewer',
      }),
    });

    const res = await handler(req, {} as never);

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      api_key: expect.objectContaining({
        id: 'ak_new',
        scope_type: 'workspace',
        workspace_id: VALID_WORKSPACE_ID,
        environment_id: null,
        role: 'viewer',
        expires_at: null,
        token: expect.stringContaining('flash_workspace_'),
      }),
    });
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenCalledWith(expect.anything(), VALID_WORKSPACE_ID, 'workspace', 'manage_settings');
    expect(mockHashToken).toHaveBeenCalledWith(expect.stringContaining('flash_workspace_'));
    expect(mockEncrypt).toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'api_key.created',
      workspace_id: VALID_WORKSPACE_ID,
    }));
  });

  it('rejects API key role requests above the creator role', async () => {
    mockRequireWorkspaceResourcePermission.mockResolvedValueOnce('admin' as never);

    const res = await handler(
      new Request('http://localhost/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: 'workspace',
          workspace_id: VALID_WORKSPACE_ID,
          name: 'Escalation attempt',
          role: 'owner',
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: cannot create API key with a role higher than your own',
    });
    expect(mockQueryOne).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO api_keys'), expect.any(Array));
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('creates an API key with optional expiry duration', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'ak_expiring',
      created_at: '2026-02-25T10:00:00.000Z',
      expires_at: '2026-03-27T10:00:00.000Z',
    } as never);

    const res = await handler(
      new Request('http://localhost/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: 'workspace',
          workspace_id: VALID_WORKSPACE_ID,
          name: 'Temporary key',
          expires_in_days: 30,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      api_key: expect.objectContaining({
        id: 'ak_expiring',
        expires_at: '2026-03-27T10:00:00.000Z',
      }),
    });
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('expires_at'),
      expect.arrayContaining([expect.any(String)])
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        expires_in_days: 30,
        expires_at: '2026-03-27T10:00:00.000Z',
      }),
    }));
  });

  it('creates an environment-scoped API key for environment owners', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ environment_id: 'env_1', workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({ id: 'ak_env', created_at: '2026-02-25T10:00:00.000Z' } as never);

    const req = new Request('http://localhost/api/api-keys/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope_type: 'environment',
        environment_id: VALID_ENVIRONMENT_ID,
        name: 'Env local client',
      }),
    });

    const res = await handler(req, {} as never);

    expect(res.status).toBe(201);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(expect.anything(), 'env_1', 'environment', 'manage_settings');
    await expect(res.json()).resolves.toEqual({
      api_key: expect.objectContaining({
        scope_type: 'environment',
        workspace_id: 'ws_1',
        environment_id: 'env_1',
      }),
    });
  });

  it('defaults API key role to the creator role when omitted', async () => {
    mockRequireEnvironmentResourcePermission.mockResolvedValueOnce('admin' as never);
    mockQueryOne
      .mockResolvedValueOnce({ environment_id: 'env_1', workspace_id: 'ws_1' } as never)
      .mockResolvedValueOnce({ id: 'ak_env_default', created_at: '2026-02-25T10:00:00.000Z' } as never);

    const res = await handler(
      new Request('http://localhost/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: 'environment',
          environment_id: VALID_ENVIRONMENT_ID,
          name: 'Env default role key',
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      api_key: expect.objectContaining({
        id: 'ak_env_default',
        role: 'admin',
      }),
    });
  });

  it('returns 403 when caller is authenticated by an API key and tries to create another key', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: { id: 'user_1', is_superadmin: false },
      apiKey: {
        id: 'ak_1',
        scope_type: 'workspace',
        scope_id: 'ws_1',
        workspace_id: 'ws_1',
        environment_id: null,
        role: 'owner',
        name: 'CLI',
        created_by_user_id: 'user_1',
      },
    } as never);

    const res = await handler(
      new Request('http://localhost/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope_type: 'workspace', workspace_id: VALID_WORKSPACE_ID, name: 'Nope' }),
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'API keys cannot manage other API keys',
    });
  });

  it('rejects malformed UUIDs for create before DB access', async () => {
    const res = await handler(
      new Request('http://localhost/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope_type: 'workspace', workspace_id: 'ws_1', name: 'Nope' }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'workspace_id must be a valid UUID' });
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('rejects invalid expires_in_days values', async () => {
    const res = await handler(
      new Request('http://localhost/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: 'workspace',
          workspace_id: VALID_WORKSPACE_ID,
          name: 'Nope',
          expires_in_days: 0,
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'expires_in_days must be between 1 and 3650',
    });
    expect(mockRequireWorkspaceResourcePermission).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('revokes a key when owner has access to the key scope', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'ak_1',
      name: 'CLI',
      scope_type: 'workspace',
      workspace_id: 'ws_1',
      environment_id: null,
      revoked_at: null,
    } as never);

    const res = await handler(
      new Request('http://localhost/api/api-keys/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: VALID_API_KEY_ID }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ message: 'API key revoked' });
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenCalledWith(expect.anything(), 'ws_1', 'workspace', 'manage_settings');
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE api_keys SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1 AND revoked_at IS NULL',
      ['ak_1', 'user_1']
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'api_key.revoked',
      resource_id: 'ak_1',
    }));
  });

  it('rejects malformed UUIDs for revoke before DB lookup', async () => {
    const res = await handler(
      new Request('http://localhost/api/api-keys/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ak_1' }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'id must be a valid UUID' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('masks unexpected internal errors with a generic 500 response', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

    const res = await handler(
      new Request(`http://localhost/api/api-keys/list?workspace_id=${VALID_WORKSPACE_ID}`),
      {} as never
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Internal server error',
    });
  });
});
