import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../environment-enterprise.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/.netlify/functions/environment-enterprise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockAmapiCall.mockReset();
  mockLogAudit.mockReset();
  mockExecute.mockResolvedValue(undefined as never);

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1', is_superadmin: false },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue('admin' as never);
});

describe('environment-enterprise device re-import', () => {
  it('queues enrollment-style import jobs for all AMAPI devices and triggers worker best-effort', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/abc',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);

    mockAmapiCall
      .mockResolvedValueOnce({
        devices: [
          { name: 'enterprises/abc/devices/d1' },
          { name: 'enterprises/abc/devices/d2' },
        ],
        nextPageToken: 'page-2',
      } as never)
      .mockResolvedValueOnce({
        devices: [
          { name: 'enterprises/abc/devices/d2' }, // duplicate across pages
          { name: 'enterprises/abc/devices/d3' },
        ],
      } as never);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );

    const res = await handler(
      makeRequest({ environment_id: 'env_1', action: 'reconcile_device_import' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'AMAPI device re-import queued',
      devices_found: 3,
      jobs_enqueued: 3,
      pages_scanned: 2,
    });

    const insertCall = mockExecute.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO job_queue')
    );
    expect(insertCall).toBeDefined();
    expect(String(insertCall?.[0])).toContain('INSERT INTO job_queue');
    const params = insertCall?.[1] as unknown[];
    expect(params.filter((p) => p === 'process_enrollment')).toHaveLength(3);
    expect(params.some((p) => typeof p === 'string' && p.includes('enterprises/abc/devices/d1'))).toBe(true);
    expect(params.some((p) => typeof p === 'string' && p.includes('enterprises/abc/devices/d2'))).toBe(true);
    expect(params.some((p) => typeof p === 'string' && p.includes('enterprises/abc/devices/d3'))).toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost/.netlify/functions/sync-process-background',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-secret': '' }),
      })
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'environment.device_reconcile_import.queued',
      details: expect.objectContaining({ devices_found: 3, jobs_enqueued: 3, pages_scanned: 2 }),
    }));

    fetchSpy.mockRestore();
  });
});

describe('environment-enterprise upgrade eligibility', () => {
  it('returns eligible status for managed Google Play Accounts enterprises', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/abc',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);
    mockAmapiCall.mockResolvedValueOnce({
      name: 'enterprises/abc',
      enterpriseType: 'MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE',
    } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', action: 'get_upgrade_status' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      enterprise_type: 'MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE',
      eligible_for_upgrade: true,
    });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('returns ineligible status for managed Google domain enterprises', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/abc',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);
    mockAmapiCall.mockResolvedValueOnce({
      name: 'enterprises/abc',
      enterpriseType: 'MANAGED_GOOGLE_DOMAIN',
    } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', action: 'get_upgrade_status' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      enterprise_type: 'MANAGED_GOOGLE_DOMAIN',
      eligible_for_upgrade: false,
    });
  });

  it('rejects upgrade URL generation for non-upgradeable enterprise types', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/abc',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);
    mockAmapiCall.mockResolvedValueOnce({
      name: 'enterprises/abc',
      enterpriseType: 'MANAGED_GOOGLE_DOMAIN',
    } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', action: 'generate_upgrade_url' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Enterprise upgrade is only available for managed Google Play Accounts enterprises',
    });
    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('generates an upgrade URL for upgradeable enterprise types', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/abc',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-123',
      } as never);
    mockAmapiCall
      .mockResolvedValueOnce({
        name: 'enterprises/abc',
        enterpriseType: 'MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE',
      } as never)
      .mockResolvedValueOnce({
        url: 'https://example.com/upgrade',
      } as never);

    const res = await handler(
      makeRequest({ environment_id: 'env_1', action: 'generate_upgrade_url' }),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      upgrade_url: 'https://example.com/upgrade',
    });
    expect(mockAmapiCall).toHaveBeenCalledTimes(2);
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });
});
