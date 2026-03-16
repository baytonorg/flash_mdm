import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import { DEVICE_BULK_COMMAND_ALIAS_MAP } from '../_lib/device-commands.js';
import handler from '../device-bulk.ts';

const mockQuery = vi.mocked(query);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockLogAudit = vi.mocked(logAudit);
const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/.netlify/functions/device-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockLogAudit.mockReset();
  mockFetch.mockClear();

  mockRequireAuth.mockResolvedValue({
    user: { id: 'user_1', is_superadmin: false },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
  mockExecute.mockResolvedValue({ rowCount: 1 } as never);
});

describe('device-bulk', () => {
  it('accepts uppercase action payloads from the Devices page and queues device_command jobs', async () => {
    mockQuery.mockResolvedValue([
      { id: 'dev_1', environment_id: 'env_1' },
      { id: 'dev_2', environment_id: 'env_1' },
    ] as never);

    const res = await handler(
      makeRequest({
        device_ids: ['dev_1', 'dev_2'],
        action: 'DISABLE',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(expect.anything(), 'env_1', 'device', 'command');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO job_queue (job_type, environment_id, payload)'),
      expect.arrayContaining([
        'device_command',
        'env_1',
        expect.stringContaining('"command_type":"DISABLE"'),
      ])
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'device.bulk.disable',
        details: expect.objectContaining({ command_type: 'DISABLE', device_count: 2 }),
      })
    );
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ job_count: 2 })
    );
  });

  it('normalizes lowercase alias actions to AMAPI command names', async () => {
    mockQuery.mockResolvedValue([{ id: 'dev_1', environment_id: 'env_1' }] as never);

    const res = await handler(
      makeRequest({
        device_ids: ['dev_1'],
        action: 'request_device_info',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO job_queue (job_type, environment_id, payload)'),
      expect.arrayContaining([
        'device_command',
        'env_1',
        expect.stringContaining('"command_type":"REQUEST_DEVICE_INFO"'),
      ])
    );
  });

  it('accepts every documented alias in the bulk command map', async () => {
    for (const [alias, commandType] of Object.entries(DEVICE_BULK_COMMAND_ALIAS_MAP)) {
      mockQuery.mockReset();
      mockExecute.mockReset();
      mockQuery.mockResolvedValue([{ id: 'dev_1', environment_id: 'env_1' }] as never);
      mockExecute.mockResolvedValue({ rowCount: 1 } as never);

      const res = await handler(
        makeRequest({
          device_ids: ['dev_1'],
          action: alias,
        }),
        {} as never
      );

      expect(res.status).toBe(200);
      if (commandType === 'DELETE') {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO job_queue'),
          expect.arrayContaining(['device_delete'])
        );
      } else {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO job_queue'),
          expect.arrayContaining([expect.stringContaining(`"command_type":"${commandType}"`)])
        );
      }
    }
  });

  it('queues DELETE as dedicated device_delete jobs', async () => {
    mockQuery.mockResolvedValue([{ id: 'dev_1', environment_id: 'env_1' }] as never);

    const res = await handler(
      makeRequest({
        device_ids: ['dev_1'],
        action: 'DELETE',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      'bulk_destructive'
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO job_queue (job_type, environment_id, payload)'),
      expect.arrayContaining([
        'device_delete',
        'env_1',
        expect.stringContaining('"device_id":"dev_1"'),
      ])
    );
    expect(mockExecute.mock.calls[0][1]).not.toContainEqual(expect.stringContaining('"command_type"'));
  });

  it('requires destructive device command permission for bulk WIPE', async () => {
    mockQuery.mockResolvedValue([{ id: 'dev_1', environment_id: 'env_1' }] as never);

    const res = await handler(
      makeRequest({
        device_ids: ['dev_1'],
        action: 'WIPE',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'device',
      'bulk_destructive'
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO job_queue'),
      expect.arrayContaining([expect.stringContaining('"command_type":"WIPE"')])
    );
  });

  it('returns a generic 404 when any requested device is missing', async () => {
    mockQuery.mockResolvedValue([{ id: 'dev_1', environment_id: 'env_1' }] as never);

    const res = await handler(
      makeRequest({
        device_ids: ['dev_1', 'dev_2'],
        action: 'DISABLE',
      }),
      {} as never
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'Unable to process one or more requested devices',
    });
    expect(mockRequireEnvironmentResourcePermission).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns thrown auth/rbac Response objects via top-level catch', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));

    const res = await handler(
      makeRequest({
        device_ids: ['dev_1'],
        action: 'DISABLE',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
