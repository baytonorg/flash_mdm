import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
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

import { queryOne, execute, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../group-crud.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockLogAudit = vi.mocked(logAudit);

function makeUpdateRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/groups/update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeCreateRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/groups/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: '22222222-2222-4222-8222-222222222222' },
  } as never);
  mockRequireEnvironmentResourcePermission.mockResolvedValue(undefined as never);
});

describe('group-crud reparenting', () => {
  it('rejects malformed UUIDs in update requests before DB access', async () => {
    const res = await handler(
      makeUpdateRequest({ id: 'bad-group-id', parent_id: 'also-bad' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'id must be a valid UUID' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects create when parent group belongs to a different environment', async () => {
    mockQueryOne.mockResolvedValueOnce({
      environment_id: '33333333-3333-4333-8333-333333333333',
    } as never);

    const res = await handler(
      makeCreateRequest({
        environment_id: '44444444-4444-4444-8444-444444444444',
        name: 'Child Group',
        parent_group_id: '77777777-7777-4777-8777-777777777777',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Parent group must be in the same environment',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('moves a group to a new parent and updates closure paths transactionally', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockTransaction.mockImplementation(async (cb: (tx: typeof client) => unknown) => cb(client) as never);

    mockQueryOne
      .mockResolvedValueOnce({ environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: null } as never)
      .mockResolvedValueOnce({ id: '77777777-7777-4777-8777-777777777777', environment_id: '44444444-4444-4444-8444-444444444444' } as never)
      .mockResolvedValueOnce(null as never); // cycle check

    const res = await handler(
      makeUpdateRequest({ id: '88888888-8888-4888-8888-888888888888', parent_id: '77777777-7777-4777-8777-777777777777', name: 'Moved Group' }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      '44444444-4444-4444-8444-444444444444',
      'group',
      'write'
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(vi.mocked(client.query).mock.calls[0]?.[0]).toContain('UPDATE groups SET');
    expect(vi.mocked(client.query).mock.calls[1]?.[0]).toContain('DELETE FROM group_closures');
    expect(vi.mocked(client.query).mock.calls[2]?.[0]).toContain('INSERT INTO group_closures');
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'group.updated',
      details: expect.objectContaining({
        parent_changed: true,
        previous_parent_group_id: null,
        new_parent_group_id: '77777777-7777-4777-8777-777777777777',
      }),
    }));
  });

  it('supports moving a group to root (null parent)', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockTransaction.mockImplementation(async (cb: (tx: typeof client) => unknown) => cb(client) as never);

    mockQueryOne
      .mockResolvedValueOnce({ environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: 'old_parent' } as never);

    const res = await handler(
      makeUpdateRequest({ id: '88888888-8888-4888-8888-888888888888', parent_group_id: null }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.query).mock.calls[1]?.[0]).toContain('DELETE FROM group_closures');
  });

  it('rejects moves that would create a cycle', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ environment_id: '44444444-4444-4444-8444-444444444444', parent_group_id: null } as never)
      .mockResolvedValueOnce({ id: '99999999-9999-4999-8999-999999999999', environment_id: '44444444-4444-4444-8444-444444444444' } as never)
      .mockResolvedValueOnce({ exists: 1 } as never);

    const res = await handler(
      makeUpdateRequest({ id: '88888888-8888-4888-8888-888888888888', parent_id: '99999999-9999-4999-8999-999999999999' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Cannot move a group under one of its descendants',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
