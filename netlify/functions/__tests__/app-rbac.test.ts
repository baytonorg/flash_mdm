import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks for app-list                                                 */
/* ------------------------------------------------------------------ */

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentPermission: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  jsonResponse: vi.fn((data: unknown) => Response.json(data)),
  errorResponse: vi.fn((msg: string, status = 400) =>
    Response.json({ error: msg }, { status })
  ),
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  parseJsonBody: vi.fn(async (req: Request) => req.json()),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn((err: unknown) => {
    if (!(err instanceof Error)) return null;
    const match = /^AMAPI error \((\d{3})\):/.exec(err.message)?.[1];
    return match ? Number(match) : null;
  }),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query, queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import appListHandler from '../app-list.ts';
import appDetailsHandler from '../app-details.ts';
import appSearchHandler from '../app-search.ts';
import appWebTokenHandler from '../app-web-token.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);

const AUTH_CONTEXT = {
  sessionId: 'sess_1',
  user: { id: 'u1', email: 'test@test.com', is_superadmin: false },
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockAmapiCall.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue(AUTH_CONTEXT as never);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
});

/* ------------------------------------------------------------------ */
/*  app-list RBAC tests                                                */
/* ------------------------------------------------------------------ */

describe('app-list RBAC', () => {
  function makeAppListRequest(): Request {
    return new Request(
      'http://localhost/.netlify/functions/app-list?environment_id=env1',
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );
  }

  it('authorized viewer can list apps', async () => {
    // Environment exists
    mockQueryOne.mockResolvedValueOnce({ id: 'env1' } as never);
    // Return app deployment rows
    mockQuery.mockResolvedValueOnce([
      {
        id: 'dep1',
        environment_id: 'env1',
        package_name: 'com.example.app',
        display_name: 'Example App',
        install_type: 'FORCE_INSTALLED',
        managed_config: '{}',
        scope_type: 'environment',
        scope_id: 'env1',
        auto_update_mode: null,
        scope_name: 'My Env',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ] as never);

    const res = await appListHandler(makeAppListRequest(), {} as never);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deployments).toHaveLength(1);
    expect(json.deployments[0].package_name).toBe('com.example.app');

    // RBAC was checked with 'viewer' role
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      AUTH_CONTEXT,
      'env1',
      'read'
    );
  });

  it('unauthorized user gets 403', async () => {
    mockRequireEnvironmentPermission.mockRejectedValueOnce(
      Response.json({ error: 'Forbidden' }, { status: 403 })
    );

    const res = await appListHandler(makeAppListRequest(), {} as never);
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */
/*  app-web-token RBAC tests                                           */
/* ------------------------------------------------------------------ */

describe('app-web-token RBAC', () => {
  function makeWebTokenRequest(): Request {
    return new Request(
      'http://localhost/api/apps/web-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment_id: 'env1' }),
      }
    );
  }

  it('authorized admin gets web token', async () => {
    // Environment lookup
    mockQueryOne
      .mockResolvedValueOnce({
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws1',
      } as never)
      // Workspace lookup
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);

    mockAmapiCall.mockResolvedValueOnce({
      name: 'enterprises/e1/webTokens/tok1',
      value: 'web-token-value-123',
    } as never);

    const res = await appWebTokenHandler(makeWebTokenRequest(), {} as never);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBe('web-token-value-123');
    expect(json.iframeUrl).toContain('web-token-value-123');

    // RBAC was checked with 'admin' role
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      AUTH_CONTEXT,
      'env1',
      'write'
    );

    // Audit log was written
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app.web_token_created',
        environment_id: 'env1',
      })
    );
  });

  it('non-admin user gets 403', async () => {
    mockRequireEnvironmentPermission.mockRejectedValueOnce(
      Response.json({ error: 'Forbidden' }, { status: 403 })
    );

    const res = await appWebTokenHandler(makeWebTokenRequest(), {} as never);
    expect(res.status).toBe(403);
  });
});

describe('app-details/app-search RBAC', () => {
  it('app-details requires viewer role on requested environment', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj1',
      } as never);
    mockAmapiCall.mockResolvedValueOnce({ title: 'App title' } as never);

    const res = await appDetailsHandler(
      new Request('http://localhost/api/apps/details/com.example.app?environment_id=env1', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(AUTH_CONTEXT, 'env1', 'read');
  });

  it('app-search requires viewer role on requested environment', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj1',
      } as never);
    mockAmapiCall.mockResolvedValueOnce({
      name: 'enterprises/e1/applications/com.example.app',
      title: 'Example',
      iconUrl: '',
    } as never);

    const res = await appSearchHandler(
      new Request('http://localhost/api/apps/search?environment_id=env1&query=com.example.app', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(AUTH_CONTEXT, 'env1', 'read');
  });
});
