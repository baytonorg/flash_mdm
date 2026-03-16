import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceResourcePermission: vi.fn(),
  requireEnvironmentAccessScope: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

vi.mock('../_lib/mcp-proxy.js', async () => {
  const actual = await vi.importActual<typeof import('../_lib/mcp-proxy.js')>('../_lib/mcp-proxy.js');
  return {
    ...actual,
    proxyToAmapiMcp: vi.fn(),
  };
});

import { requireAuth } from '../_lib/auth.js';
import { requireWorkspaceResourcePermission, requireEnvironmentAccessScope } from '../_lib/rbac.js';
import { queryOne } from '../_lib/db.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import { proxyToAmapiMcp } from '../_lib/mcp-proxy.js';
import handler from '../mcp-amapi.ts';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockRequireEnvironmentAccessScope = vi.mocked(requireEnvironmentAccessScope);
const mockQueryOne = vi.mocked(queryOne);
const mockConsumeToken = vi.mocked(consumeToken);
const mockProxyToAmapiMcp = vi.mocked(proxyToAmapiMcp);

describe('mcp-amapi security hardening', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockRequireWorkspaceResourcePermission.mockReset();
    mockRequireEnvironmentAccessScope.mockReset();
    mockQueryOne.mockReset();
    mockConsumeToken.mockReset();
    mockProxyToAmapiMcp.mockReset();

    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'qa@example.com',
        workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    } as never);

    mockRequireWorkspaceResourcePermission.mockResolvedValue('viewer' as never);
    mockRequireEnvironmentAccessScope.mockResolvedValue({
      mode: 'environment',
      role: 'viewer',
      accessible_group_ids: null,
    } as never);

    mockQueryOne.mockResolvedValue({
      workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      enterprise_name: 'enterprises/LC123',
    } as never);

    mockConsumeToken.mockResolvedValue({ allowed: true, remainingTokens: 9 } as never);
  });

  it('rejects unsupported MCP methods', async () => {
    const res = await handler(new Request('http://localhost/api/mcp/amapi?environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'admin/deleteEverything', id: 1 }),
    }), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Unsupported MCP method' });
    expect(mockProxyToAmapiMcp).not.toHaveBeenCalled();
  });

  it('rejects cross-enterprise tool calls', async () => {
    const res = await handler(new Request('http://localhost/api/mcp/amapi?environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'list_devices',
          arguments: { parent: 'enterprises/OTHER' },
        },
        id: 1,
      }),
    }), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Requested enterprise does not match the active environment',
    });
    expect(mockProxyToAmapiMcp).not.toHaveBeenCalled();
  });

  it('rejects group-scoped users for enterprise-wide MCP access', async () => {
    mockRequireEnvironmentAccessScope.mockResolvedValueOnce({
      mode: 'group',
      role: 'viewer',
      accessible_group_ids: ['33333333-3333-4333-8333-333333333333'],
    } as never);

    const res = await handler(new Request('http://localhost/api/mcp/amapi?environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    }), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Group-scoped access cannot use enterprise-wide MCP tools',
    });
    expect(mockProxyToAmapiMcp).not.toHaveBeenCalled();
  });

  it('returns 429 when MCP rate limit is exceeded', async () => {
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      retryAfterMs: 2100,
      remainingTokens: 0,
    } as never);

    const res = await handler(new Request('http://localhost/api/mcp/amapi?environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    }), {} as never);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many MCP requests. Please wait and try again.',
    });
    expect(mockProxyToAmapiMcp).not.toHaveBeenCalled();
  });
});
