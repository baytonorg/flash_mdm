import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();

vi.mock('../db.js', () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
}));

import { logAudit, _sanitizeAuditValue } from '../audit.js';

beforeEach(() => {
  mockExecute.mockReset();
  vi.restoreAllMocks();
});

describe('logAudit', () => {
  it('redacts sensitive values recursively in nested objects and arrays', () => {
    expect(_sanitizeAuditValue({
      password: 'secret123',
      nested: {
        api_key: 'abc',
        tokenValue: 'xyz',
        safe: 'ok',
      },
      items: [
        { otp_code: '123456', name: 'device' },
        'plain',
      ],
    })).toEqual({
      password: '[REDACTED]',
      nested: {
        api_key: '[REDACTED]',
        tokenValue: '[REDACTED]',
        safe: 'ok',
      },
      items: [
        { otp_code: '[REDACTED]', name: 'device' },
        'plain',
      ],
    });
  });

  it('calls execute with correct INSERT query and parameters', async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 });

    await logAudit({
      workspace_id: 'ws-1',
      environment_id: 'env-1',
      user_id: 'user-1',
      device_id: 'dev-1',
      action: 'device.enroll',
      resource_type: 'device',
      resource_id: 'dev-1',
      details: { method: 'QR' },
      ip_address: '10.0.0.1',
    });

    expect(mockExecute).toHaveBeenCalledOnce();
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_log');
    expect(params).toEqual([
      'ws-1',
      'env-1',
      'user-1',
      null, // api_key_id
      'dev-1',
      'user',
      'standard',
      'device.enroll',
      'device',
      'dev-1',
      JSON.stringify({ method: 'QR' }),
      '10.0.0.1',
    ]);
  });

  it('passes null for optional fields when not provided', async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 });

    await logAudit({ action: 'user.login' });

    const [, params] = mockExecute.mock.calls[0];
    expect(params).toEqual([
      null,        // workspace_id
      null,        // environment_id
      null,        // user_id
      null,        // api_key_id
      null,        // device_id
      'user',      // actor_type
      'standard',  // visibility_scope
      'user.login',
      null,        // resource_type
      null,        // resource_id
      '{}',        // details defaults to empty object
      null,        // ip_address
    ]);
  });

  it('silently catches errors and does not throw', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB connection failed'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw
    await expect(logAudit({ action: 'test.action' })).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to write audit log:',
      expect.any(Error),
    );
  });

  it('retries with legacy audit_log insert when newer columns are missing', async () => {
    mockExecute
      .mockRejectedValueOnce({
        code: '42703',
        message: 'column "api_key_id" of relation "audit_log" does not exist',
      })
      .mockResolvedValueOnce({ rowCount: 1 });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(logAudit({ action: 'policy.update' })).resolves.toBeUndefined();

    expect(mockExecute).toHaveBeenCalledTimes(2);
    const [firstSql] = mockExecute.mock.calls[0]!;
    const [secondSql, secondParams] = mockExecute.mock.calls[1]!;
    expect(firstSql).toContain('api_key_id');
    expect(secondSql).not.toContain('api_key_id');
    expect(secondSql).toContain('INSERT INTO audit_log');
    expect(secondParams).toEqual([
      null,
      null,
      null,
      null,
      'policy.update',
      null,
      null,
      '{}',
      null,
    ]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('serializes details object as JSON', async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 });

    await logAudit({
      action: 'policy.update',
      details: { fields_changed: ['name', 'description'], previous_name: 'Old' },
    });

    const [, params] = mockExecute.mock.calls[0];
    const detailsJson = params[10] as string;
    expect(JSON.parse(detailsJson)).toEqual({
      fields_changed: ['name', 'description'],
      previous_name: 'Old',
    });
  });

  it('redacts sensitive detail keys before persisting audit entries', async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 });

    await logAudit({
      action: 'auth.login_failed',
      details: {
        reason: 'invalid_password',
        password: 'hunter2',
        nested: { access_token: 'abc123', keep: 'value' },
      },
    });

    const [, params] = mockExecute.mock.calls[0];
    expect(JSON.parse(params[10] as string)).toEqual({
      reason: 'invalid_password',
      password: '[REDACTED]',
      nested: { access_token: '[REDACTED]', keep: 'value' },
    });
  });
});
