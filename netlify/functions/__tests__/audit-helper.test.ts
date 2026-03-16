import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  execute: vi.fn(),
}));

import { execute } from '../_lib/db.js';
import { logAudit } from '../_lib/audit.js';
import { runWithAuditAuthContext } from '../_lib/request-auth-context.js';

const mockExecute = vi.mocked(execute);

describe('logAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
  });

  it('defaults actor_type=user and visibility_scope=standard', async () => {
    await logAudit({
      action: 'device.updated',
      details: { api_key: 'secret', nested: { token: 'abc', ok: true } },
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain('actor_type');
    expect(sql).toContain('visibility_scope');
    expect(sql).toContain('api_key_id');
    expect(params[5]).toBe('user');
    expect(params[6]).toBe('standard');
    expect(params[7]).toBe('device.updated');

    const details = JSON.parse(String(params[10]));
    expect(details.api_key).toBe('[REDACTED]');
    expect(details.nested.token).toBe('[REDACTED]');
    expect(details.nested.ok).toBe(true);
  });

  it('allows privileged system audit entries', async () => {
    await logAudit({
      actor_type: 'system',
      visibility_scope: 'privileged',
      action: 'sync.job.processed',
    });

    const params = mockExecute.mock.calls[0]![1];
    expect(params[5]).toBe('system');
    expect(params[6]).toBe('privileged');
  });

  it('attributes API-key-authenticated requests to the key principal', async () => {
    await runWithAuditAuthContext({
      authType: 'api_key',
      user: { id: 'user_1', email: 'owner@example.com' },
      apiKey: {
        id: 'ak_1',
        name: 'CI key',
        scope_type: 'environment',
        scope_id: 'env_1',
        workspace_id: 'ws_1',
        environment_id: 'env_1',
        role: 'viewer',
        created_by_user_id: 'user_1',
        created_by_name: 'Owner User',
        created_by_email: 'owner@example.com',
      },
    }, async () => {
      await logAudit({
        action: 'device.read',
        user_id: 'user_1',
        environment_id: 'env_1',
      });
    });

    const params = mockExecute.mock.calls[0]![1];
    expect(params[2]).toBeNull(); // user_id
    expect(params[3]).toBe('ak_1'); // api_key_id
    expect(params[5]).toBe('api_key');
    const details = JSON.parse(String(params[10]));
    expect(details.auth_context).toEqual(expect.objectContaining({
      method: 'api_key',
      principal_type: 'api_key',
      principal_id: 'ak_1',
      principal_name: 'CI key',
      role: 'viewer',
      scope_type: 'environment',
      scope_id: 'env_1',
      created_by_user_id: 'user_1',
      created_by_name: 'Owner User',
      created_by_email: 'owner@example.com',
    }));
  });
});
