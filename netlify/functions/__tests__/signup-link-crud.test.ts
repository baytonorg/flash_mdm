import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClientQuery = vi.fn();

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) => fn({ query: mockClientQuery })),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  generateToken: vi.fn(() => 'signup_token'),
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireWorkspaceResourcePermission, requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import handler from '../signup-link-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const LINK_ID = '11111111-1111-4111-8111-111111111111';

function makeCreateRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/signup-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}


beforeEach(() => {
  mockClientQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1', email: 'admin@example.com', is_superadmin: false },
  } as never);
  mockRequireWorkspaceResourcePermission.mockResolvedValue('admin' as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue('admin' as never);
});

describe('signup-link-crud default_role validation', () => {
  it('accepts admin default role on workspace link create', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never); // no slug collision

    const res = await handler(
      makeCreateRequest({
        scope_type: 'workspace',
        scope_id: 'ws_1',
        slug: 'admin-link',
        default_role: 'admin',
        default_access_scope: 'workspace',
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('accepts admin default role on environment link create', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never); // no slug collision

    const res = await handler(
      makeCreateRequest({
        scope_type: 'environment',
        scope_id: 'env_1',
        slug: 'env-admin',
        default_role: 'admin',
        default_access_scope: 'scoped',
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('accepts admin default role on link update', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: LINK_ID,
        scope_type: 'workspace',
        scope_id: 'ws_1',
        default_access_scope: 'workspace',
      } as never)
      .mockResolvedValueOnce(null as never); // slug collision check

    const res = await handler(
      new Request(`http://localhost/api/signup-links/${LINK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_role: 'admin',
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('rejects invalid allowed domain formats', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never); // no slug collision

    const res = await handler(
      makeCreateRequest({
        scope_type: 'workspace',
        scope_id: 'ws_1',
        slug: 'bad-domain',
        default_role: 'member',
        allowed_domains: ['invalid_domain'],
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid domain format: invalid_domain',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('accepts valid allowed domains on create', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null as never) // no slug collision
      .mockResolvedValueOnce({ id: 'link_1' } as never); // return created link

    const res = await handler(
      makeCreateRequest({
        scope_type: 'workspace',
        scope_id: 'ws_1',
        slug: 'domain-test',
        default_role: 'viewer',
        allowed_domains: ['example.com', 'sub.example.org'],
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    expect(mockExecute).toHaveBeenCalled();
    // Verify allowed_domains was passed in the execute call
    const executeArgs = mockExecute.mock.calls[0][1] as unknown[];
    expect(executeArgs).toContainEqual(['example.com', 'sub.example.org']);
  });

  it('accepts empty allowed_domains array on create', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null as never) // no slug collision
      .mockResolvedValueOnce({ id: 'link_1' } as never); // return created link

    const res = await handler(
      makeCreateRequest({
        scope_type: 'workspace',
        scope_id: 'ws_1',
        default_role: 'viewer',
        allowed_domains: [],
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('rejects invalid domain formats on PATCH', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: LINK_ID,
      scope_type: 'workspace',
      scope_id: 'ws_1',
    } as never);

    const res = await handler(
      new Request(`http://localhost/api/signup-links/${LINK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowed_domains: ['good.com', '-bad-domain.com'],
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid domain format: -bad-domain.com',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('accepts valid allowed_domains on PATCH', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: LINK_ID,
        scope_type: 'workspace',
        scope_id: 'ws_1',
      } as never)
      .mockResolvedValueOnce({ id: LINK_ID } as never); // return updated link

    const res = await handler(
      new Request(`http://localhost/api/signup-links/${LINK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowed_domains: ['company.com', 'partner.co.uk'],
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('cleans and lowercases domains before validation', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null as never) // no slug collision
      .mockResolvedValueOnce({ id: 'link_1' } as never); // return created link

    const res = await handler(
      makeCreateRequest({
        scope_type: 'workspace',
        scope_id: 'ws_1',
        default_role: 'viewer',
        allowed_domains: ['  Example.COM  ', 'TEST.org'],
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    expect(mockExecute).toHaveBeenCalled();
    const executeArgs = mockExecute.mock.calls[0][1] as unknown[];
    expect(executeArgs).toContainEqual(['example.com', 'test.org']);
  });

  it('forces customer workspace links to scoped viewer with environment setup enabled', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null as never) // no slug collision
      .mockResolvedValueOnce({ id: 'link_customer' } as never); // return created link

    const res = await handler(
      makeCreateRequest({
        scope_type: 'workspace',
        scope_id: 'ws_1',
        purpose: 'customer',
        default_role: 'admin',
        default_access_scope: 'workspace',
        auto_assign_environment_ids: ['env_1'],
        allow_environment_creation: false,
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    const executeArgs = mockExecute.mock.calls[0][1] as unknown[];
    expect(executeArgs).toContain('customer');
    expect(executeArgs).toContain('viewer');
    expect(executeArgs).toContain('scoped');
    expect(executeArgs).toContain(true);
    expect(executeArgs).toContain('[]');
  });

  it('rejects workspace auto_assign_environment_ids outside the workspace', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '0' } as never);

    const res = await handler(
      makeCreateRequest({
        scope_type: 'workspace',
        scope_id: 'ws_1',
        default_role: 'viewer',
        auto_assign_environment_ids: ['44444444-4444-4444-8444-444444444444'],
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'One or more auto_assign_environment_ids are outside this workspace',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects environment auto_assign_group_ids outside the environment', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '0' } as never);

    const res = await handler(
      makeCreateRequest({
        scope_type: 'environment',
        scope_id: 'env_1',
        default_role: 'viewer',
        auto_assign_group_ids: ['66666666-6666-4666-8666-666666666666'],
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'One or more auto_assign_group_ids are outside this environment',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects environment link PATCH when auto_assign_environment_ids are provided', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: LINK_ID,
      scope_type: 'environment',
      scope_id: 'env_1',
      purpose: 'standard',
    } as never);

    const res = await handler(
      new Request(`http://localhost/api/signup-links/${LINK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_assign_environment_ids: ['44444444-4444-4444-8444-444444444444'],
        }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'auto_assign_environment_ids are only supported for workspace signup links',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 400 for PATCH /api/signup-links without id', async () => {
    const res = await handler(
      new Request('http://localhost/api/signup-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Link ID is required' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 for DELETE /api/signup-links without id', async () => {
    const res = await handler(
      new Request('http://localhost/api/signup-links', {
        method: 'DELETE',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Link ID is required' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 for PATCH with invalid link id', async () => {
    const res = await handler(
      new Request('http://localhost/api/signup-links/not-a-uuid', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Link ID must be a valid UUID' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});
