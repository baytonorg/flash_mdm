import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  execute: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentAccessScopeForResourcePermission } from '../_lib/rbac.js';
import { execute, query, queryOne } from '../_lib/db.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import handler from '../flashagent-chat-history.ts';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentAccessScopeForResourcePermission = vi.mocked(requireEnvironmentAccessScopeForResourcePermission);
const mockExecute = vi.mocked(execute);
const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockConsumeToken = vi.mocked(consumeToken);

describe('flashagent-chat-history security controls', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockRequireEnvironmentAccessScopeForResourcePermission.mockReset();
    mockExecute.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockConsumeToken.mockReset();

    mockRequireEnvironmentAccessScopeForResourcePermission.mockResolvedValue({
      mode: 'environment',
      role: 'viewer',
      accessible_group_ids: null,
    } as never);
    mockConsumeToken.mockResolvedValue({ allowed: true, remainingTokens: 9 } as never);
  });

  it('prunes old messages during POST and uses auth.user.id for persisted rows', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'api_key',
      sessionId: null,
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'api@example.com',
      },
      apiKey: {
        id: 'ak_123',
      },
    } as never);

    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as never)
      .mockResolvedValueOnce({ count: '0' } as never);
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);

    const res = await handler(new Request('http://localhost/api/flashagent/chat-history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        environment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        messages: [{ role: 'user', text: 'hello' }],
      }),
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentAccessScopeForResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'flashagent',
      'read',
    );

    expect(mockExecute).toHaveBeenCalledTimes(2);
    const [pruneSql, pruneParams] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(pruneSql).toContain('make_interval(days => $3)');
    expect(pruneParams).toEqual([
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '11111111-1111-4111-8111-111111111111',
      30,
    ]);

    const [insertSql, insertParams] = mockExecute.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO flashagent_chat_messages');
    expect(insertParams).toContain('11111111-1111-4111-8111-111111111111');
    expect(insertParams).not.toContain('ak_123');
  });

  it('returns chat messages in object envelope for GET', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'qa@example.com',
      },
    } as never);

    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Env A' } as never);
    mockExecute.mockResolvedValue({ rowCount: 0 } as never);
    mockQuery.mockResolvedValueOnce([
      { id: 'm1', role: 'user', text: 'hello', created_at: new Date().toISOString() },
    ] as never);

    const res = await handler(
      new Request('http://localhost/api/flashagent/chat-history?environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        method: 'GET',
      }),
      {} as never,
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentAccessScopeForResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'flashagent',
      'read',
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [historySql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(historySql).toContain('ORDER BY created_at DESC');
    expect(historySql).toContain('ORDER BY created_at ASC');
    await expect(res.json()).resolves.toEqual({
      messages: [
        expect.objectContaining({ id: 'm1', role: 'user', text: 'hello' }),
      ],
    });
  });

  it('rejects appends when history already exceeds max cap', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'qa@example.com',
      },
    } as never);

    mockQueryOne
      .mockResolvedValueOnce({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as never)
      .mockResolvedValueOnce({ count: '6000' } as never);
    mockExecute.mockResolvedValue({ rowCount: 0 } as never);

    const res = await handler(new Request('http://localhost/api/flashagent/chat-history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        environment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        messages: [{ role: 'user', text: 'hello' }],
      }),
    }), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      appended: 0,
      message: 'Message limit reached',
    });
    expect(mockExecute).toHaveBeenCalledTimes(1); // prune only; no insert
  });

  it('returns 429 when GET history rate limit is exceeded', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'qa@example.com',
      },
    } as never);

    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Env A' } as never);
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      retryAfterMs: 2100,
      remainingTokens: 0,
    } as never);

    const res = await handler(
      new Request('http://localhost/api/flashagent/chat-history?environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        method: 'GET',
      }),
      {} as never,
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many chat history requests. Please wait and try again.',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
