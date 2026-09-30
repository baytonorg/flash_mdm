import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({ requireEnvironmentPermission: vi.fn() }));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/licensing.js', () => ({ assertEnvironmentEnrollmentAllowed: vi.fn() }));
vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

import { queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import handler, { applyProvisioningExtrasToQrPayload } from '../enrollment-create.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockAmapiCall = vi.mocked(amapiCall);

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/enrolment/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/enrolment/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      user: { id: 'user-1', is_superadmin: false },
    } as never);
    mockAmapiCall.mockResolvedValue({
      name: 'enterprises/e1/enrollmentTokens/t1',
      value: 'tok-1',
      qrCode: '{"android.app.extra.PROVISIONING_ENROLLMENT_TOKEN":"tok-1"}',
    } as never);
  });

  it('preserves secured Wi-Fi payloads and omits passwords for open networks', () => {
    const secured = JSON.parse(applyProvisioningExtrasToQrPayload('{}', {
      wifiSsid: 'Setup network',
      wifiSecurityType: 'WPA',
      wifiPassword: 'not-a-real-secret',
    })!);
    expect(secured['android.app.extra.PROVISIONING_WIFI_PASSWORD']).toBe('not-a-real-secret');

    const open = JSON.parse(applyProvisioningExtrasToQrPayload(JSON.stringify(secured), {
      wifiSsid: 'Open network',
      wifiSecurityType: 'NONE',
      wifiPassword: 'must-not-remain',
    })!);
    expect(open).not.toHaveProperty('android.app.extra.PROVISIONING_WIFI_PASSWORD');
  });

  it('accepts duration aliases and boolean-like one_time_use values', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env-1',
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws-1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-1',
      } as never)
      .mockResolvedValueOnce(null as never); // env policy

    const res = await handler(
      makeRequest({
        environment_id: 'env-1',
        name: 'Token A',
        one_time_use: 'true',
        duration: '604800s',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      expect.anything(),
      'env-1',
      'write'
    );

    const amapiBody = ((mockAmapiCall.mock.calls[0]?.[2] as { body?: Record<string, unknown> })?.body ?? {});
    expect(amapiBody.duration).toBe('604800s');
    expect(amapiBody.oneTimeOnly).toBe(true);
    expect(amapiBody).not.toHaveProperty('allowPersonalUsage');

    const insertValues = (mockExecute.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(insertValues[8]).toBe(true);
    expect(insertValues[9]).toBe('PERSONAL_USAGE_UNSPECIFIED');
  });

  it('normalizes personal usage aliases and includes group additionalData', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env-1',
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws-1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-1',
      } as never)
      .mockResolvedValueOnce({
        id: 'group-1',
      } as never)
      .mockResolvedValueOnce(null as never) // group policy
      .mockResolvedValueOnce(null as never); // env policy

    const res = await handler(
      makeRequest({
        environment_id: 'env-1',
        group_id: 'group-1',
        allow_personal_usage: 'dedicated device',
        one_time_use: false,
        duration_days: 2,
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    const amapiBody = ((mockAmapiCall.mock.calls[0]?.[2] as { body?: Record<string, unknown> })?.body ?? {});
    expect(amapiBody.duration).toBe('172800s');
    expect(amapiBody.allowPersonalUsage).toBe('PERSONAL_USAGE_DISALLOWED_USERLESS');
    expect(amapiBody.additionalData).toBe(JSON.stringify({ group_id: 'group-1' }));

    const insertValues = (mockExecute.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(insertValues[2]).toBe('group-1');
    expect(insertValues[9]).toBe('PERSONAL_USAGE_DISALLOWED_USERLESS');
  });

  it('uses the exact maximum duration and persists the AMAPI-returned expiration', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env-1',
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws-1',
      } as never)
      .mockResolvedValueOnce({ gcp_project_id: 'proj-1' } as never)
      .mockResolvedValueOnce(null as never);
    mockAmapiCall.mockResolvedValueOnce({
      name: 'enterprises/e1/enrollmentTokens/t-max',
      value: 'redacted',
      qrCode: '{}',
      expirationTimestamp: '9999-12-31T23:59:59.999999999Z',
    } as never);

    const res = await handler(
      makeRequest({
        environment_id: 'env-1',
        duration: '315576000000s',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    const amapiBody = ((mockAmapiCall.mock.calls[0]?.[2] as { body?: Record<string, unknown> })?.body ?? {});
    expect(amapiBody.duration).toBe('315576000000s');
    const insertValues = (mockExecute.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(insertValues[10]).toBe('9999-12-31T23:59:59.999999Z');
    expect(insertValues[11]).toBe('9999-12-31T23:59:59.999999999Z');
  });
});
