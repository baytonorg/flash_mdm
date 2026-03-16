import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
  getEffectivePermissionMatrixForWorkspace: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../_lib/flashagent-settings.js', () => ({
  getEffectiveAssistantSettings: vi.fn(),
  getEnvironmentAssistantApiKey: vi.fn(),
  getWorkspaceOpenAiOverrides: vi.fn(),
}));

vi.mock('../_lib/flashagent-billing.js', () => ({
  checkAssistantEntitlement: vi.fn(),
}));

vi.mock('../_lib/flashagent-runtime.js', () => ({
  runFlashi: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentAccessScopeForResourcePermission } from '../_lib/rbac.js';
import { queryOne } from '../_lib/db.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import { runFlashi } from '../_lib/flashagent-runtime.js';
import { checkAssistantEntitlement } from '../_lib/flashagent-billing.js';
import { getEffectiveAssistantSettings, getEnvironmentAssistantApiKey, getWorkspaceOpenAiOverrides } from '../_lib/flashagent-settings.js';
import handler from '../flashagent-chat.ts';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentAccessScopeForResourcePermission = vi.mocked(requireEnvironmentAccessScopeForResourcePermission);
const mockQueryOne = vi.mocked(queryOne);
const mockConsumeToken = vi.mocked(consumeToken);
const mockRunFlashi = vi.mocked(runFlashi);
const mockCheckAssistantEntitlement = vi.mocked(checkAssistantEntitlement);
const mockGetEffectiveAssistantSettings = vi.mocked(getEffectiveAssistantSettings);
const mockGetEnvironmentAssistantApiKey = vi.mocked(getEnvironmentAssistantApiKey);
const mockGetWorkspaceOpenAiOverrides = vi.mocked(getWorkspaceOpenAiOverrides);

describe('flashagent-chat rate limits', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockRequireEnvironmentAccessScopeForResourcePermission.mockReset();
    mockQueryOne.mockReset();
    mockConsumeToken.mockReset();
    mockRunFlashi.mockReset();
    mockCheckAssistantEntitlement.mockReset();
    mockGetEffectiveAssistantSettings.mockReset();
    mockGetEnvironmentAssistantApiKey.mockReset();
    mockGetWorkspaceOpenAiOverrides.mockReset();

    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'qa@example.com',
      },
    } as never);
    mockRequireEnvironmentAccessScopeForResourcePermission.mockResolvedValue({
      mode: 'workspace',
      accessible_group_ids: null,
    } as never);

    mockQueryOne.mockResolvedValue({
      workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Env A',
      enterprise_name: 'enterprises/LC123',
      enterprise_display_name: 'LC123',
      workspace_name: 'Workspace A',
    } as never);
    mockCheckAssistantEntitlement.mockResolvedValue({
      entitled: true,
      reason: null,
    } as never);
    mockGetEffectiveAssistantSettings.mockResolvedValue({
      effective_enabled: true,
      effective_assistant_role: 'viewer',
    } as never);

    mockGetEnvironmentAssistantApiKey.mockResolvedValue('flash_environment_key');
    mockGetWorkspaceOpenAiOverrides.mockResolvedValue({ apiKey: null, model: null });
  });

  it('returns 429 when chat IP bucket is exhausted', async () => {
    mockConsumeToken.mockResolvedValueOnce({
      allowed: false,
      retryAfterMs: 3500,
      remainingTokens: 0,
    } as never);

    const res = await handler(new Request('http://localhost/api/flashagent/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        environment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        message: 'How many devices are online?',
      }),
    }), {} as never);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('4');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many assistant requests. Please wait and try again.',
    });

    expect(mockRunFlashi).not.toHaveBeenCalled();
  });

  it('enforces environment-level flashagent read permission', async () => {
    mockConsumeToken
      .mockResolvedValueOnce({
        allowed: true,
        retryAfterMs: undefined,
        remainingTokens: 20,
      } as never)
      .mockResolvedValueOnce({
        allowed: true,
        retryAfterMs: undefined,
        remainingTokens: 10,
      } as never);

    mockRequireEnvironmentAccessScopeForResourcePermission.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden: insufficient environment permission' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }) as never
    );

    const res = await handler(new Request('http://localhost/api/flashagent/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        environment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        message: 'List my devices',
      }),
    }), {} as never);

    expect(mockRequireEnvironmentAccessScopeForResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'flashagent',
      'read'
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: insufficient environment permission',
    });
    expect(mockRunFlashi).not.toHaveBeenCalled();
  });
});
