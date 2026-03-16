import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
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

import { queryOne } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../device-operations.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);
const VALID_DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeGet(url: string): Request {
  return new Request(url, { method: 'GET' });
}

function makePost(body: Record<string, unknown>, url = 'http://localhost/.netlify/functions/device-operations'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockAmapiCall.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'user_1', is_superadmin: false },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
});

describe('device-operations', () => {
  it('requires device_id for list requests', async () => {
    const res = await handler(
      makeGet('http://localhost/.netlify/functions/device-operations?action=list'),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'device_id is required' });
  });

  it('lists operations with member RBAC and calls AMAPI device operations endpoint', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'dev_1',
        amapi_name: 'enterprises/e1/devices/d1',
        environment_id: 'env_1',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj_123',
      } as never);
    mockAmapiCall
      .mockResolvedValueOnce({
        operations: [
          {
            name: 'enterprises/e1/operations/1772128508043',
            done: true,
            metadata: { createTime: '2026-02-26T17:55:08Z' },
          },
        ],
        nextPageToken: 'next-token',
      } as never)
      .mockResolvedValueOnce({
        operations: [
          {
            name: 'enterprises/e1/operations/1772129414614',
            done: true,
            metadata: { createTime: '2026-02-26T18:10:14Z' },
          },
        ],
      } as never);

    const res = await handler(
      makeGet(`http://localhost/.netlify/functions/device-operations?action=list&device_id=${VALID_DEVICE_ID}`),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      'write'
    );
    expect(mockAmapiCall).toHaveBeenNthCalledWith(
      1,
      'enterprises/e1/devices/d1/operations?pageSize=100',
      'ws_1',
      expect.objectContaining({
        projectId: 'proj_123',
        enterpriseName: 'enterprises/e1',
        resourceType: 'devices',
        resourceId: 'd1',
      })
    );
    expect(mockAmapiCall).toHaveBeenNthCalledWith(
      2,
      'enterprises/e1/devices/d1/operations?pageSize=100&pageToken=next-token',
      'ws_1',
      expect.objectContaining({
        projectId: 'proj_123',
        enterpriseName: 'enterprises/e1',
        resourceType: 'devices',
        resourceId: 'd1',
      })
    );
    await expect(res.json()).resolves.toEqual({
      operations: [
        {
          name: 'enterprises/e1/operations/1772129414614',
          done: true,
          metadata: { createTime: '2026-02-26T18:10:14Z' },
        },
        {
          name: 'enterprises/e1/operations/1772128508043',
          done: true,
          metadata: { createTime: '2026-02-26T17:55:08Z' },
        },
      ],
      nextPageToken: undefined,
    });
  });

  it('requires operation_name for cancel requests', async () => {
    const res = await handler(makePost({}), {} as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'operation_name is required' });
  });

  it('rejects malformed device UUIDs for list requests before DB lookup', async () => {
    const res = await handler(
      makeGet('http://localhost/.netlify/functions/device-operations?action=list&device_id=dev_1'),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'device_id must be a valid UUID' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('cancels operations with admin RBAC and records audit log', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj_123',
      } as never);
    mockAmapiCall.mockResolvedValue({} as never);

    const operationName = 'enterprises/e1/operations/op_1';
    const res = await handler(
      makePost({ operation_name: operationName }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      'delete'
    );
    expect(mockAmapiCall).toHaveBeenCalledWith(
      `${operationName}:cancel`,
      'ws_1',
      expect.objectContaining({
        method: 'POST',
        projectId: 'proj_123',
        enterpriseName: 'enterprises/e1',
      })
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'device.operation.cancelled',
        resource_id: operationName,
      })
    );
    await expect(res.json()).resolves.toEqual({
      cancelled: true,
      operation_name: operationName,
    });
  });

  it('fails soft for list when AMAPI returns a server error', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'dev_1',
        amapi_name: 'enterprises/e1/devices/d1',
        environment_id: 'env_1',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj_123',
      } as never);
    mockAmapiCall.mockRejectedValue(new Error('AMAPI error (503): backend unavailable') as never);

    const res = await handler(
      makeGet(`http://localhost/.netlify/functions/device-operations?action=list&device_id=${VALID_DEVICE_ID}`),
      {} as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      operations: [],
      nextPageToken: undefined,
      unavailable: true,
      message: 'Operations are temporarily unavailable. Please try again shortly.',
    });
  });
});
