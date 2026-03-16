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
  requireEnvironmentPermission: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  parseJsonBody: vi.fn((req: Request) => req.json()),
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  errorResponse: vi.fn((message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { query, queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import { parseJsonBody } from '../_lib/helpers.js';
import handler from '../workflow-crud.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockLogAudit = vi.mocked(logAudit);
const mockParseJsonBody = vi.mocked(parseJsonBody);

const fakeUser = { id: 'user1', email: 'user@test.com', is_superadmin: false };

const fakeWorkflow = {
  id: 'wf1',
  environment_id: 'env1',
  name: 'Test',
  enabled: true,
  trigger_type: 'device.enrolled',
  trigger_config: {},
  conditions: [],
  action_type: 'device.command',
  action_config: {},
  scope_type: 'environment',
  scope_id: null,
  last_triggered_at: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

function forbidden(): never { throw new Response('Forbidden', { status: 403 }); }

beforeEach(() => {
  vi.clearAllMocks();

  mockRequireAuth.mockResolvedValue({ user: fakeUser } as never);
  mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
  mockLogAudit.mockResolvedValue(undefined as never);
  mockExecute.mockResolvedValue(undefined as never);
});

// ─── LIST ────────────────────────────────────────────────────────────────────

describe('LIST /api/workflows/list', () => {
  function makeListRequest(envId: string) {
    return new Request(
      `http://localhost/api/workflows/list?environment_id=${envId}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('calls requireEnvironmentRole with viewer for list', async () => {
    mockQuery.mockResolvedValueOnce([] as never);

    const res = await handler(makeListRequest('env1'), {} as never);
    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'read',
    );
  });

  it('propagates 403 when requireEnvironmentRole rejects for list', async () => {
    mockRequireEnvironmentPermission.mockImplementationOnce(forbidden);
    const res = await handler(makeListRequest('env1'), {} as never);
    expect(res.status).toBe(403);
  });
});

// ─── GET single ──────────────────────────────────────────────────────────────

describe('GET /api/workflows/:id', () => {
  function makeGetRequest(id: string) {
    return new Request(
      `http://localhost/api/workflows/${id}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('fetches workflow then calls requireEnvironmentRole with viewer', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeWorkflow as never) // fetch workflow
    mockQuery
      .mockResolvedValueOnce([] as never); // recent_executions

    const res = await handler(makeGetRequest('wf1'), {} as never);
    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'read',
    );
  });

  it('propagates 403 when viewer role check fails for get', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockRequireEnvironmentPermission.mockImplementationOnce(forbidden);
    const res = await handler(makeGetRequest('wf1'), {} as never);
    expect(res.status).toBe(403);
  });

  it('returns 404 when workflow not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(makeGetRequest('missing'), {} as never);
    expect(res.status).toBe(404);
    expect(mockRequireEnvironmentPermission).not.toHaveBeenCalled();
  });
});

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('POST /api/workflows/create', () => {
  const createBody = {
    environment_id: 'env1',
    name: 'New Workflow',
    trigger_type: 'device.enrolled',
    action_type: 'device.command',
    conditions: [],
  };

  function makeCreateRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/workflows/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('calls requireEnvironmentRole with admin for create', async () => {
    mockParseJsonBody.mockResolvedValueOnce(createBody as never);
    mockExecute.mockResolvedValueOnce(undefined as never);
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockLogAudit.mockResolvedValueOnce(undefined as never);

    const res = await handler(makeCreateRequest(createBody), {} as never);
    expect(res.status).toBe(201);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'write',
    );
  });

  it('propagates 403 when admin role check fails for create', async () => {
    mockParseJsonBody.mockResolvedValueOnce(createBody as never);
    mockRequireEnvironmentPermission.mockImplementationOnce(forbidden);
    const res = await handler(makeCreateRequest(createBody), {} as never);
    expect(res.status).toBe(403);
  });

  it('rejects create when scoped target is outside the workflow environment', async () => {
    mockParseJsonBody.mockResolvedValueOnce({
      ...createBody,
      scope_type: 'group',
      scope_id: 'grp_other_env',
    } as never);
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(
      makeCreateRequest({
        ...createBody,
        scope_type: 'group',
        scope_id: 'grp_other_env',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'scope_id does not belong to environment env1',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('PUT /api/workflows/update', () => {
  const updateBody = {
    id: 'wf1',
    environment_id: 'env1',
    name: 'Updated Workflow',
    trigger_type: 'device.enrolled',
    action_type: 'device.command',
    conditions: [],
  };

  function makeUpdateRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/workflows/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('fetches existing workflow then calls requireEnvironmentRole with admin for update', async () => {
    mockParseJsonBody.mockResolvedValueOnce(updateBody as never);
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never); // existing lookup
    mockExecute.mockResolvedValueOnce(undefined as never);
    mockLogAudit.mockResolvedValueOnce(undefined as never);

    const res = await handler(makeUpdateRequest(updateBody), {} as never);
    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'write',
    );
  });

  it('propagates 403 when admin role check fails for update', async () => {
    mockParseJsonBody.mockResolvedValueOnce(updateBody as never);
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockRequireEnvironmentPermission.mockImplementationOnce(forbidden);
    const res = await handler(makeUpdateRequest(updateBody), {} as never);
    expect(res.status).toBe(403);
  });

  it('returns 404 when workflow to update is not found', async () => {
    mockParseJsonBody.mockResolvedValueOnce(updateBody as never);
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(makeUpdateRequest(updateBody), {} as never);
    expect(res.status).toBe(404);
    expect(mockRequireEnvironmentPermission).not.toHaveBeenCalled();
  });

  it('rejects update when scoped target is outside the workflow environment', async () => {
    mockParseJsonBody.mockResolvedValueOnce({
      ...updateBody,
      scope_type: 'device',
      scope_id: 'dev_other_env',
    } as never);
    mockQueryOne
      .mockResolvedValueOnce(fakeWorkflow as never)
      .mockResolvedValueOnce(null as never);

    const res = await handler(
      makeUpdateRequest({
        ...updateBody,
        scope_type: 'device',
        scope_id: 'dev_other_env',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'scope_id does not belong to environment env1',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/workflows/:id', () => {
  function makeDeleteRequest(id: string) {
    return new Request(`http://localhost/api/workflows/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('fetches workflow then requires delete permission for delete', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockExecute.mockResolvedValueOnce(undefined as never);
    mockLogAudit.mockResolvedValueOnce(undefined as never);

    const res = await handler(makeDeleteRequest('wf1'), {} as never);
    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'delete',
    );
  });

  it('propagates 403 when admin role check fails for delete', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockRequireEnvironmentPermission.mockImplementationOnce(forbidden);
    const res = await handler(makeDeleteRequest('wf1'), {} as never);
    expect(res.status).toBe(403);
  });

  it('returns 404 when workflow to delete is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(makeDeleteRequest('missing'), {} as never);
    expect(res.status).toBe(404);
    expect(mockRequireEnvironmentPermission).not.toHaveBeenCalled();
  });
});

// ─── TOGGLE ──────────────────────────────────────────────────────────────────

describe('POST /api/workflows/:id/toggle', () => {
  function makeToggleRequest(id: string) {
    return new Request(`http://localhost/api/workflows/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  it('fetches workflow then calls requireEnvironmentRole with admin for toggle', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockExecute.mockResolvedValueOnce(undefined as never);
    mockLogAudit.mockResolvedValueOnce(undefined as never);

    const res = await handler(makeToggleRequest('wf1'), {} as never);
    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'write',
    );
  });

  it('propagates 403 when admin role check fails for toggle', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockRequireEnvironmentPermission.mockImplementationOnce(forbidden);
    const res = await handler(makeToggleRequest('wf1'), {} as never);
    expect(res.status).toBe(403);
  });

  it('returns 404 when workflow to toggle is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(makeToggleRequest('missing'), {} as never);
    expect(res.status).toBe(404);
    expect(mockRequireEnvironmentPermission).not.toHaveBeenCalled();
  });
});

// ─── TEST ────────────────────────────────────────────────────────────────────

describe('POST /api/workflows/:id/test', () => {
  function makeTestRequest(id: string, body: Record<string, unknown> = {}) {
    return new Request(`http://localhost/api/workflows/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('fetches workflow then calls requireEnvironmentRole with admin for test', async () => {
    mockParseJsonBody.mockResolvedValueOnce({ device_id: 'dev1' } as never);
    mockQueryOne
      .mockResolvedValueOnce(fakeWorkflow as never) // workflow lookup
      .mockResolvedValueOnce({ id: 'exec1' } as never); // execution result
    mockExecute.mockResolvedValueOnce(undefined as never);
    mockLogAudit.mockResolvedValueOnce(undefined as never);

    const res = await handler(makeTestRequest('wf1', { device_id: 'dev1' }), {} as never);
    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      { user: fakeUser },
      'env1',
      'write',
    );
  });

  it('propagates 403 when admin role check fails for test', async () => {
    mockParseJsonBody.mockResolvedValueOnce({ device_id: 'dev1' } as never);
    mockQueryOne.mockResolvedValueOnce(fakeWorkflow as never);
    mockRequireEnvironmentPermission.mockImplementationOnce(forbidden);
    const res = await handler(makeTestRequest('wf1', { device_id: 'dev1' }), {} as never);
    expect(res.status).toBe(403);
  });

  it('returns 404 when workflow to test is not found', async () => {
    mockParseJsonBody.mockResolvedValueOnce({ device_id: 'dev1' } as never);
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(makeTestRequest('missing', { device_id: 'dev1' }), {} as never);
    expect(res.status).toBe(404);
    expect(mockRequireEnvironmentPermission).not.toHaveBeenCalled();
  });
});
