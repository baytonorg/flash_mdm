import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../_lib/flashagent-settings.js', () => ({
  getEffectiveAssistantSettings: vi.fn(),
  getWorkspaceAssistantSettings: vi.fn(),
  setEnvironmentAssistantEnabled: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentAccessScopeForResourcePermission, requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { queryOne } from '../_lib/db.js';
import { getEffectiveAssistantSettings, getWorkspaceAssistantSettings, setEnvironmentAssistantEnabled } from '../_lib/flashagent-settings.js';
import handler from '../flashagent-settings.ts';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentAccessScopeForResourcePermission = vi.mocked(requireEnvironmentAccessScopeForResourcePermission);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockQueryOne = vi.mocked(queryOne);
const mockGetEffectiveAssistantSettings = vi.mocked(getEffectiveAssistantSettings);
const mockGetWorkspaceAssistantSettings = vi.mocked(getWorkspaceAssistantSettings);
const mockSetEnvironmentAssistantEnabled = vi.mocked(setEnvironmentAssistantEnabled);

describe('flashagent-settings authorization', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockRequireEnvironmentAccessScopeForResourcePermission.mockReset();
    mockRequireEnvironmentResourcePermission.mockReset();
    mockQueryOne.mockReset();
    mockGetEffectiveAssistantSettings.mockReset();
    mockGetWorkspaceAssistantSettings.mockReset();
    mockSetEnvironmentAssistantEnabled.mockReset();

    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'qa@example.com',
      },
    } as never);
    mockRequireEnvironmentAccessScopeForResourcePermission.mockResolvedValue({
      mode: 'environment',
      role: 'viewer',
      accessible_group_ids: null,
    } as never);
    mockRequireEnvironmentResourcePermission.mockResolvedValue('admin' as never);
    mockQueryOne.mockResolvedValue({
      workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    } as never);
    mockGetEffectiveAssistantSettings.mockResolvedValue({
      platform_assistant_enabled: true,
      workspace_assistant_enabled: true,
      workspace_assistant_max_role: 'admin',
      workspace_assistant_default_role: 'viewer',
      environment_assistant_role: 'viewer',
      effective_assistant_role: 'viewer',
      environment_assistant_enabled: true,
      effective_enabled: true,
    });
    mockGetWorkspaceAssistantSettings.mockResolvedValue({
      platform_assistant_enabled: true,
      workspace_assistant_enabled: true,
      workspace_assistant_max_role: 'admin',
      workspace_assistant_default_role: 'viewer',
      workspace_openai_override_configured: false,
      workspace_openai_model: null,
    });
  });

  it('uses environment access-scope permission checks for GET', async () => {
    const res = await handler(new Request('http://localhost/api/flashagent/settings?environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      method: 'GET',
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentAccessScopeForResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'flashagent',
      'read',
    );
  });

  it('uses environment-wide permission checks for PUT', async () => {
    const res = await handler(new Request('http://localhost/api/flashagent/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        environment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        enabled: true,
        role: 'member',
      }),
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'flashagent',
      'manage_settings',
    );
    expect(mockSetEnvironmentAssistantEnabled).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      true,
      'member',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('blocks API keys from mutating settings', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: 'api_key',
      sessionId: null,
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'api@example.com',
      },
      apiKey: {
        id: 'ak_1',
      },
    } as never);

    const res = await handler(new Request('http://localhost/api/flashagent/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        environment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        enabled: false,
      }),
    }), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'API keys cannot update assistant settings',
    });
    expect(mockRequireEnvironmentResourcePermission).not.toHaveBeenCalled();
    expect(mockSetEnvironmentAssistantEnabled).not.toHaveBeenCalled();
  });

  it('clamps environment role to workspace ceiling', async () => {
    mockGetWorkspaceAssistantSettings.mockResolvedValueOnce({
      platform_assistant_enabled: true,
      workspace_assistant_enabled: true,
      workspace_assistant_max_role: 'member',
      workspace_assistant_default_role: 'viewer',
      workspace_openai_override_configured: false,
      workspace_openai_model: null,
    });

    const res = await handler(new Request('http://localhost/api/flashagent/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        environment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        enabled: true,
        role: 'admin',
      }),
    }), {} as never);

    expect(res.status).toBe(200);
    expect(mockSetEnvironmentAssistantEnabled).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      true,
      'member',
      '11111111-1111-4111-8111-111111111111',
    );
  });
});
