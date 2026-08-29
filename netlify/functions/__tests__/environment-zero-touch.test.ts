import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentPermission: vi.fn(),
  requireEnvironmentResourcePermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/licensing.js', () => ({
  assertEnvironmentEnrollmentAllowed: vi.fn(),
}));

vi.mock('../enrollment-create.js', () => ({
  applyProvisioningExtrasToQrPayload: vi.fn((qr: string | null) => qr),
  normalizeProvisioningExtrasInput: vi.fn((extras: unknown) => extras),
}));

import { query, queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission, requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../environment-zero-touch.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockRequireEnvironmentResourcePermission = vi.mocked(requireEnvironmentResourcePermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);

function makeGetRequest(url: string) {
  return new Request(url, { method: 'GET' });
}

function makePostRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/environments/zero-touch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockRequireAuth.mockReset();
  mockRequireEnvironmentPermission.mockReset();
  mockRequireEnvironmentResourcePermission.mockReset();
  mockAmapiCall.mockReset();
  mockLogAudit.mockReset();

  mockRequireAuth.mockResolvedValue({
    user: { id: 'user_1', is_superadmin: false },
  } as never);
});

describe('environment-zero-touch', () => {
  it('returns token and group options for GET', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'env_1',
      name: 'Env One',
      workspace_id: 'ws_1',
      enterprise_name: 'enterprises/e1',
      gcp_project_id: 'proj-1',
    } as never);
    mockQuery
      .mockResolvedValueOnce([{ id: 'g1', name: 'Default' }] as never)
      .mockResolvedValueOnce([{
        id: 'tok_1',
        name: 'ZT token',
        group_id: 'g1',
        group_name: 'Default',
        one_time_use: false,
        allow_personal_usage: 'PERSONAL_USAGE_UNSPECIFIED',
        expires_at: '2026-04-01T00:00:00.000Z',
        amapi_value: 'abc',
      }] as never);

    const res = await handler(
      makeGetRequest('http://localhost/api/environments/zero-touch?environment_id=env_1'),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentPermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'read'
    );
    expect(body.groups).toEqual([{ id: 'g1', name: 'Default' }]);
    expect(body.active_tokens).toHaveLength(1);
    const tokenListSql = String(mockQuery.mock.calls[1]?.[0] ?? '');
    expect(tokenListSql).toContain('et.one_time_use = false');
    expect(tokenListSql).toContain('et.amapi_value IS NOT NULL');
    expect(tokenListSql).toContain('et.expires_at IS NOT NULL');
  });

  it('creates an iframe URL with the selected token in documented ADP DPC extras', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        name: 'Env One',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj-1',
      } as never)
      .mockResolvedValueOnce({
        id: 'tok_1',
        amapi_value: 'enrollment-token-123',
        group_id: 'group_1',
      } as never);
    mockAmapiCall.mockResolvedValueOnce({ value: 'web_tok_123' } as never);

    const res = await handler(
      makePostRequest({
        environment_id: 'env_1',
        action: 'create_iframe_token',
        token_id: 'tok_1',
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockRequireEnvironmentResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      'env_1',
      'environment',
      'manage_settings'
    );
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/webTokens',
      'ws_1',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          enabledFeatures: ['ZERO_TOUCH_CUSTOMER_MANAGEMENT'],
        }),
      })
    );
    expect(body.iframe_token).toBe('web_tok_123');
    const iframeUrl = new URL(body.iframe_url);
    expect(iframeUrl.searchParams.get('token')).toBe('web_tok_123');
    expect(iframeUrl.searchParams.get('dpcId')).toBe('com.google.android.apps.work.clouddpc');
    expect(JSON.parse(iframeUrl.searchParams.get('dpcExtras') ?? '{}')).toEqual({
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME':
        'com.google.android.apps.work.clouddpc/.receivers.CloudDeviceAdminReceiver',
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM':
        'I5YvS0O5hXY46mb01BlRjq4oJJGs2kuUcHvVkAPEXlg',
      'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': {
        'com.google.android.apps.work.clouddpc.EXTRA_ENROLLMENT_TOKEN': 'enrollment-token-123',
      },
    });
    expect(mockLogAudit).toHaveBeenCalledOnce();
    const tokenLookupSql = String(mockQueryOne.mock.calls[1]?.[0] ?? '');
    expect(tokenLookupSql).toContain('one_time_use = false');
    expect(tokenLookupSql).toContain('amapi_value IS NOT NULL');
    expect(tokenLookupSql).toContain('expires_at IS NOT NULL');
  });

  it('creates reusable zero-touch enrollment tokens with explicit duration and persisted AMAPI expiry', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'env_1',
      name: 'Env One',
      workspace_id: 'ws_1',
      enterprise_name: 'enterprises/e1',
      gcp_project_id: 'proj-1',
    } as never);
    mockAmapiCall.mockResolvedValueOnce({
      name: 'enterprises/e1/enrollmentTokens/zt1',
      value: 'enroll-token-1',
      qrCode: '{"android.app.extra.PROVISIONING_ENROLLMENT_TOKEN":"enroll-token-1"}',
      expirationTimestamp: '9999-12-31T23:59:59.999999999Z',
    } as never);

    const res = await handler(
      makePostRequest({
        environment_id: 'env_1',
        action: 'create_enrollment_token_for_zt',
        token_name: 'ZT token',
        one_time_use: true,
        expiry_days: 30,
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);

    const amapiBody = ((mockAmapiCall.mock.calls[0]?.[2] as { body?: Record<string, unknown> })?.body ?? {});
    expect(amapiBody.oneTimeOnly).toBe(false);
    expect(amapiBody.duration).toBe('315576000000s');

    const insertArgs = (mockExecute.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(insertArgs[7]).toBe(false);
    expect(insertArgs[9]).toBe('9999-12-31T23:59:59.999999999Z');
    expect(body.enrollment_token?.expires_at).toBe('9999-12-31T23:59:59.999999999Z');
  });

  it('builds documented ADP DPC extras for an existing token', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        name: 'Env One',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj-1',
      } as never)
      .mockResolvedValueOnce({
        id: 'tok_1',
        amapi_value: 'token-abc',
        group_id: 'group_1',
      } as never);

    const res = await handler(
      makePostRequest({
        environment_id: 'env_1',
        action: 'build_zt_dpc_extras',
        token_id: 'tok_1',
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dpc_extras).toEqual({
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME':
        'com.google.android.apps.work.clouddpc/.receivers.CloudDeviceAdminReceiver',
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM':
        'I5YvS0O5hXY46mb01BlRjq4oJJGs2kuUcHvVkAPEXlg',
      'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': {
        'com.google.android.apps.work.clouddpc.EXTRA_ENROLLMENT_TOKEN': 'token-abc',
      },
    });
    expect(body.token_id).toBe('tok_1');
    expect(body.resolved_group_id).toBe('group_1');
  });

  it('rejects sensitive custom DPC extras', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        name: 'Env One',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj-1',
      } as never)
      .mockResolvedValueOnce({
        id: 'tok_1',
        amapi_value: 'token-abc',
        group_id: null,
      } as never);

    const res = await handler(
      makePostRequest({
        environment_id: 'env_1',
        action: 'build_zt_dpc_extras',
        token_id: 'tok_1',
        custom_dpc_extras: {
          private_key: 'abc',
        },
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(String(body.error ?? '')).toContain('Sensitive provisioning extra key');
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
