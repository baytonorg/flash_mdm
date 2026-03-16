import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(),
  requireGroupPermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  errorResponse: vi.fn((msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  parseJsonBody: vi.fn(async (req: Request) => req.json()),
  isValidUuid: vi.fn((value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  ensurePreferredDerivativeForDevicePolicy: vi.fn(),
}));

import { queryOne, execute } from '../_lib/db.js';
import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentResourcePermission, requireGroupPermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import { ensurePreferredDerivativeForDevicePolicy } from '../_lib/policy-derivatives.js';
import handler from '../device-get.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockQuery = vi.mocked(query);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvPerm = vi.mocked(requireEnvironmentResourcePermission);
const mockRequireGroupPerm = vi.mocked(requireGroupPermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);
const mockEnsurePreferredDerivative = vi.mocked(ensurePreferredDerivativeForDevicePolicy);

describe('device-get refresh audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: { id: '22222222-2222-4222-8222-222222222222', is_superadmin: false },
    } as never);
    mockRequireEnvPerm.mockResolvedValue(undefined as never);
    mockRequireGroupPerm.mockResolvedValue(undefined as never);
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
  });

  it('rejects malformed device UUID before DB access', async () => {
    const res = await handler(
      new Request('http://localhost/.netlify/functions/device-get/not-a-uuid', { method: 'GET' }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'device_id must be a valid UUID' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects malformed PUT group_id before group lookup', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      environment_id: '44444444-4444-4444-8444-444444444444',
      group_id: null,
    } as never);

    const res = await handler(
      new Request('http://localhost/.netlify/functions/device-get/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: 'bad-group-id' }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'group_id must be a valid UUID' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('writes device.refreshed audit entry on POST refresh', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        environment_id: '44444444-4444-4444-8444-444444444444',
        amapi_name: 'enterprises/e1/devices/d1',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj-1',
      } as never);

    mockAmapiCall.mockResolvedValue({
      hardwareInfo: { serialNumber: 'SER123', manufacturer: 'Google', model: 'Pixel' },
      softwareInfo: { androidVersion: '14', securityPatchLevel: '2026-02-01' },
      networkInfo: { imei: '123456789012345' },
      state: 'ACTIVE',
      ownership: 'COMPANY_OWNED',
      managementMode: 'DEVICE_OWNER',
      policyCompliant: true,
    } as never);

    const res = await handler(
      new Request('http://localhost/.netlify/functions/device-get/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockRequireEnvPerm).toHaveBeenCalledWith(expect.anything(), '44444444-4444-4444-8444-444444444444', 'device', 'read');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: '11111111-1111-4111-8111-111111111111',
      environment_id: '44444444-4444-4444-8444-444444444444',
      user_id: '22222222-2222-4222-8222-222222222222',
      device_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      action: 'device.refreshed',
      resource_type: 'device',
      resource_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      details: { amapi_name: 'enterprises/e1/devices/d1' },
    }));
  });

  it('returns policy resolution generation hash diagnostics on GET', async () => {
    mockEnsurePreferredDerivative.mockResolvedValue({
      derivative: {
        policy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        scope_type: 'group',
        scope_id: '66666666-6666-4666-8666-666666666666',
        amapi_name: 'enterprises/e1/policies/pd-pol1-group-grp1',
        payload_hash: 'grp-payload',
        metadata: { generation_hash: 'grp-gen' },
      },
      source_scope: { scope_type: 'group', scope_id: '66666666-6666-4666-8666-666666666666' },
      used_device_derivative: false,
      reason_code: 'device_derivative_redundant_payload_match',
      reason_details: {
        source_scope: 'group',
        source_payload_hash: 'grp-payload',
        device_payload_hash: 'grp-payload',
      },
      device_derivative_required: false,
      device_derivative_redundant: true,
    } as never);

    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT d.*,')) {
        return {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          environment_id: '44444444-4444-4444-8444-444444444444',
          group_id: '66666666-6666-4666-8666-666666666666',
          group_name: 'Group 1',
          policy_id: null,
          policy_name: null,
          deployment_scenario: null,
          amapi_name: 'enterprises/e1/devices/d1',
          snapshot: { appliedPolicyName: 'enterprises/e1/policies/pd-pol1-device-dev1' },
        } as never;
      }
      if (sql.includes("SELECT policy_id FROM policy_assignments") && sql.includes("scope_type = 'device'")) {
        return null as never;
      }
      if (sql.includes('FROM group_closures gc') && sql.includes('JOIN policy_assignments pa') && sql.includes('LIMIT 1')) {
        return { policy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ancestor_id: '66666666-6666-4666-8666-666666666666' } as never;
      }
      if (sql.includes('SELECT name FROM policies WHERE id = $1')) {
        return { name: 'Policy 1' } as never;
      }
      if (sql.includes('SELECT name FROM groups WHERE id = $1')) {
        return { name: 'Group 1' } as never;
      }
      if (sql.includes("scope_type = 'environment' AND scope_id = $2")) {
        return {
          policy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          scope_type: 'environment',
          scope_id: '44444444-4444-4444-8444-444444444444',
          amapi_name: 'enterprises/e1/policies/pd-pol1-env-env1',
          payload_hash: 'env-payload',
          metadata: { generation_hash: 'env-gen' },
        } as never;
      }
      if (sql.includes("scope_type = 'device' AND scope_id = $2")) {
        return {
          policy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          scope_type: 'device',
          scope_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          amapi_name: 'enterprises/e1/policies/pd-pol1-device-dev1',
          payload_hash: 'dev-payload',
          metadata: { generation_hash: 'dev-gen' },
        } as never;
      }
      if (sql.includes('WHERE policy_id = $1 AND amapi_name = $2')) {
        return {
          policy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          scope_type: 'group',
          scope_id: '66666666-6666-4666-8666-666666666666',
          amapi_name: 'enterprises/e1/policies/pd-pol1-group-grp1',
          payload_hash: 'grp-payload',
          metadata: { generation_hash: 'grp-gen' },
        } as never;
      }
      return null as never;
    });

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM device_applications')) return [] as never;
      if (sql.includes('FROM device_status_reports')) return [] as never;
      if (sql.includes('FROM device_locations')) return [] as never;
      if (sql.includes('FROM audit_log a')) return [] as never;
      if (sql.includes('FROM group_closures gc') && sql.includes('JOIN groups g') && sql.includes('ORDER BY gc.depth ASC')) {
        return [{ group_id: '66666666-6666-4666-8666-666666666666', group_name: 'Group 1', depth: 0 }] as never;
      }
      if (sql.includes('FROM app_deployments') || sql.includes('FROM network_deployments')) return [] as never;
      if (sql.includes('scope_type = \'group\'') && sql.includes('scope_id = ANY')) {
        return [{
          policy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          scope_type: 'group',
          scope_id: '66666666-6666-4666-8666-666666666666',
          amapi_name: 'enterprises/e1/policies/pd-pol1-group-grp1',
          payload_hash: 'grp-payload',
          metadata: { generation_hash: 'grp-gen', requires_per_device_derivative: false },
        }] as never;
      }
      return [] as never;
    });

    const res = await handler(
      new Request('http://localhost/.netlify/functions/device-get/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { method: 'GET' }),
      {} as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy_resolution.amapi).toMatchObject({
      applied_policy_name: 'enterprises/e1/policies/pd-pol1-device-dev1',
      expected_policy_name: 'enterprises/e1/policies/pd-pol1-group-grp1',
      applied_generation_hash: 'dev-gen',
      expected_generation_hash: 'grp-gen',
      matches_expected: false,
      generation_hash_matches_expected: false,
      selection_reason_code: 'device_derivative_redundant_payload_match',
      device_derivative_required: false,
      device_derivative_redundant: true,
      source_scope: { scope_type: 'group', scope_id: '66666666-6666-4666-8666-666666666666' },
    });
    expect(body.policy_resolution.expected_derivative).toMatchObject({
      scope_type: 'group',
      generation_hash: 'grp-gen',
    });
    expect(body.policy_resolution.applied_derivative).toMatchObject({
      scope_type: 'device',
      generation_hash: 'dev-gen',
    });
  });
});
