import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentAccessScopeForPermission: vi.fn(),
  requireWorkspacePermission: vi.fn(),
}));

vi.mock('../_lib/blobs.js', () => ({
  storeBlob: vi.fn(),
  getBlob: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  jsonResponse: vi.fn((data: unknown, status = 200, headers?: Record<string, string>) => {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }),
  errorResponse: vi.fn((msg: string, status = 400) => {
    return new Response(JSON.stringify({ error: msg }), { status });
  }),
  parseJsonBody: vi.fn(async (req: Request) => req.json()),
  getClientIp: vi.fn(() => '127.0.0.1'),
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  isValidUuid: vi.fn((v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'export-uuid'),
}));

import { queryOne, query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentAccessScopeForPermission, requireWorkspacePermission } from '../_lib/rbac.js';
import { storeBlob, getBlob } from '../_lib/blobs.js';
import { logAudit } from '../_lib/audit.js';
import exportHandler from '../report-export.ts';
import downloadHandler from '../report-download.ts';

const mockRequireAuth = vi.mocked(requireAuth);
const mockQueryOne = vi.mocked(queryOne);
const mockQuery = vi.mocked(query);
const mockRequireEnvScope = vi.mocked(requireEnvironmentAccessScopeForPermission);
const mockRequireWorkspacePermission = vi.mocked(requireWorkspacePermission);
const mockStoreBlob = vi.mocked(storeBlob);
const mockGetBlob = vi.mocked(getBlob);
const mockLogAudit = vi.mocked(logAudit);

const authContext = { user: { id: 'u1', email: 'test@test.com', is_superadmin: false }, sessionId: 's1' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authContext as never);
});

describe('report-export RBAC', () => {
  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/.netlify/functions/report-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('authorized admin can export devices', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1', workspace_id: 'ws1' } as never);
    mockRequireEnvScope.mockResolvedValueOnce({
      mode: 'environment',
      role: 'admin',
      accessible_group_ids: null,
    } as never);
    mockQuery.mockResolvedValueOnce([] as never);
    mockStoreBlob.mockResolvedValueOnce(undefined as never);

    const res = await exportHandler(
      makeRequest({ environment_id: 'env1', type: 'devices', format: 'json' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvScope).toHaveBeenCalledWith(authContext, 'env1', 'write');
  });

  it('unauthorized user gets 403', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1', workspace_id: 'ws1' } as never);
    mockRequireEnvScope.mockRejectedValueOnce(new Response('Forbidden', { status: 403 }));

    await expect(
      exportHandler(
        makeRequest({ environment_id: 'env1', type: 'devices', format: 'json' }),
        {} as never
      )
    ).resolves.toMatchObject({ status: 403 });
  });

  it('scoped user receives accessible_group_ids', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1', workspace_id: 'ws1' } as never);
    mockRequireEnvScope.mockResolvedValueOnce({
      mode: 'group',
      role: 'admin',
      accessible_group_ids: ['g1', 'g2'],
    } as never);
    mockQuery.mockResolvedValueOnce([] as never);
    mockStoreBlob.mockResolvedValueOnce(undefined as never);

    const res = await exportHandler(
      makeRequest({ environment_id: 'env1', type: 'devices', format: 'json' }),
      {} as never
    );

    expect(res.status).toBe(200);
    // Verify query was called with group IDs for scoped filtering
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ANY($3)'),
      expect.arrayContaining([['g1', 'g2']])
    );
  });

  it('sanitizes formula-prefixed CSV values in exports', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'env1', workspace_id: 'ws1' } as never);
    mockRequireEnvScope.mockResolvedValueOnce({
      mode: 'environment',
      role: 'admin',
      accessible_group_ids: null,
    } as never);
    mockQuery.mockResolvedValueOnce([
      {
        name: '=CMD',
        serial_number: '+1',
        model: '-1',
        manufacturer: '@SUM(A1:A2)',
        state: 'ACTIVE',
      },
    ] as never);
    mockStoreBlob.mockResolvedValueOnce(undefined as never);

    const res = await exportHandler(
      makeRequest({ environment_id: 'env1', type: 'devices', format: 'csv' }),
      {} as never
    );

    expect(res.status).toBe(200);
    const csv = mockStoreBlob.mock.calls[0]?.[2] as string;
    expect(csv).toContain("'=CMD");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-1");
    expect(csv).toContain("'@SUM(A1:A2)");
    expect(csv).toContain('ACTIVE');
  });
});

describe('report-download RBAC', () => {
  const testExportId = '00000000-0000-4000-a000-000000000001';
  const testWsId = '00000000-0000-4000-a000-000000000002';

  function makeRequest() {
    return new Request(
      `http://localhost/.netlify/functions/report-download?id=${testExportId}&workspace_id=${testWsId}&format=json`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );
  }

  it('authorized admin can download report', async () => {
    mockRequireWorkspacePermission.mockResolvedValueOnce(undefined as never);
    mockGetBlob.mockResolvedValueOnce('{"data":[]}' as never);

    const res = await downloadHandler(makeRequest(), {} as never);

    expect(res.status).toBe(200);
    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith(authContext, testWsId, 'write');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: testWsId,
      user_id: 'u1',
      action: 'report.downloaded',
      resource_type: 'report_export',
      details: expect.objectContaining({ export_id: testExportId, format: 'json' }),
    }));
  });

  it('non-admin user gets 403', async () => {
    mockRequireWorkspacePermission.mockRejectedValueOnce(new Response('Forbidden', { status: 403 }));

    await expect(
      downloadHandler(makeRequest(), {} as never)
    ).resolves.toMatchObject({ status: 403 });
  });

  it('rejects non-UUID export id', async () => {
    const badReq = new Request(
      `http://localhost/.netlify/functions/report-download?id=../../evil&workspace_id=${testWsId}&format=json`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );
    const res = await downloadHandler(badReq, {} as never);
    expect(res.status).toBe(400);
  });
});
