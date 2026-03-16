import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentPermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/policy-merge.js', () => ({
  parseOncDocument: vi.fn((doc: unknown) => {
    if (!doc || typeof doc !== 'object') return { Type: 'UnencryptedConfiguration', NetworkConfigurations: [] };
    return doc as Record<string, unknown>;
  }),
  parseApnPolicy: vi.fn((doc: unknown) => {
    if (!doc || typeof doc !== 'object') return {};
    return doc as Record<string, unknown>;
  }),
  getApnSettingKey: vi.fn(() => 'mock-apn-key'),
}));

vi.mock('../_lib/deployment-sync.js', () => ({
  syncAffectedPoliciesToAmapi: vi.fn(async () => ({
    attempted: 1,
    synced: 1,
    failed: 0,
    skipped_reason: null,
    failures: [],
  })),
  selectPoliciesForDeploymentScope: vi.fn(async () => ({
    rows: [{ id: 'pol_1', config: {}, amapi_name: 'enterprises/e1/policies/pol_1' }],
  })),
}));

import { queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import {
  syncAffectedPoliciesToAmapi,
  selectPoliciesForDeploymentScope,
} from '../_lib/deployment-sync.js';
import handler from '../network-deploy.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockLogAudit = vi.mocked(logAudit);
const mockSyncAffectedPolicies = vi.mocked(syncAffectedPoliciesToAmapi);
const mockSelectPolicies = vi.mocked(selectPoliciesForDeploymentScope);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/networks/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('network-deploy derivative-based sync', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
    mockTransaction.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvironmentPermission.mockReset();
    mockLogAudit.mockReset();
    mockSyncAffectedPolicies.mockReset();
    mockSelectPolicies.mockReset();

    mockRequireAuth.mockResolvedValue({
      sessionId: 'sess_1',
      user: { id: 'user_1', is_superadmin: false },
    } as never);
    mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
    mockLogAudit.mockResolvedValue(undefined as never);

    // Default: sync succeeds with 1 policy synced
    mockSyncAffectedPolicies.mockResolvedValue({
      attempted: 1,
      synced: 1,
      failed: 0,
      skipped_reason: null,
      failures: [],
    } as never);

    mockSelectPolicies.mockResolvedValue({
      rows: [{ id: 'pol_1', config: {}, amapi_name: 'enterprises/e1/policies/pol_1' }],
    } as never);
  });

  function setupTransactionWithPolicies() {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO network_deployments')) {
        return { rows: [{ id: 'dep_1' }] };
      }
      if (sql.includes('SELECT') && sql.includes('policies')) {
        return {
          rows: [{
            id: 'pol_1',
            config: {},
            amapi_name: 'enterprises/e1/policies/pol_1',
          }],
        };
      }
      return { rows: [] };
    });
    mockTransaction.mockImplementation(async (fn: (tx: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));
    return clientQuery;
  }

  it('saves WiFi deployment and syncs derivatives for environment scope', async () => {
    setupTransactionWithPolicies();

    // queryOne: env lookup, then existing deployment check
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        id: 'dep_1',
        created_at: '2026-02-23T00:00:00.000Z',
        updated_at: '2026-02-23T00:00:00.000Z',
      } as never);

    const oncDocument = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [
        {
          Name: 'Corp WiFi',
          Type: 'WiFi',
          WiFi: {
            SSID: 'CorpNet',
            Security: 'WPA-PSK',
            Passphrase: 'supersecret',
            AutoConnect: true,
          },
        },
      ],
    };

    const res = await handler(
      makeRequest({
        environment_id: 'env_1',
        name: 'Corp WiFi',
        scope_type: 'environment',
        scope_id: 'env_1',
        onc_document: oncDocument,
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.deployment.ssid).toBe('CorpNet');
    expect(body.deployment.name).toBe('Corp WiFi');

    // syncAffectedPoliciesToAmapi should be called with environment scope
    expect(mockSyncAffectedPolicies).toHaveBeenCalledTimes(1);
    expect(mockSyncAffectedPolicies).toHaveBeenCalledWith(
      ['pol_1'],
      'env_1',
      'environment',
      'env_1',
    );

    expect(body.amapi_sync.synced).toBe(1);
    expect(body.amapi_sync.failed).toBe(0);
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });

  it('saves APN deployment and syncs derivatives for environment scope', async () => {
    setupTransactionWithPolicies();

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        id: 'dep_apn_1',
        created_at: '2026-02-23T00:00:00.000Z',
        updated_at: '2026-02-23T00:00:00.000Z',
      } as never);

    const apnPolicy = {
      overrideApns: 'OVERRIDE_APNS_ENABLED',
      apnSettings: [
        {
          name: 'Carrier Data',
          apn: 'internet',
          numericOperatorId: '310260',
          apnTypes: ['DEFAULT', 'SUPL'],
        },
      ],
    };

    const res = await handler(
      makeRequest({
        environment_id: 'env_1',
        network_type: 'apn',
        name: 'Carrier APN Override',
        scope_type: 'environment',
        scope_id: 'env_1',
        apn_policy: apnPolicy,
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.deployment.network_type).toBe('apn');
    expect(body.amapi_sync.synced).toBe(1);

    expect(mockSyncAffectedPolicies).toHaveBeenCalledTimes(1);
    expect(mockSyncAffectedPolicies).toHaveBeenCalledWith(
      ['pol_1'],
      'env_1',
      'environment',
      'env_1',
    );
  });

  it('calls sync with group scope for group scope deployment', async () => {
    setupTransactionWithPolicies();

    // env lookup, then group check, then existing deployment check
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({ id: 'grp_1' } as never) // group exists check
      .mockResolvedValueOnce({
        id: 'dep_1',
        created_at: '2026-02-23T00:00:00.000Z',
        updated_at: '2026-02-23T00:00:00.000Z',
      } as never);

    const oncDocument = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [
        {
          Name: 'Group WiFi',
          Type: 'WiFi',
          WiFi: { SSID: 'GroupNet', Security: 'None', AutoConnect: true },
        },
      ],
    };

    const res = await handler(
      makeRequest({
        environment_id: 'env_1',
        name: 'Group WiFi',
        scope_type: 'group',
        scope_id: 'grp_1',
        onc_document: oncDocument,
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(201);

    // syncAffectedPoliciesToAmapi should be called with group scope
    expect(mockSyncAffectedPolicies).toHaveBeenCalledTimes(1);
    expect(mockSyncAffectedPolicies).toHaveBeenCalledWith(
      ['pol_1'],
      'env_1',
      'group',
      'grp_1',
    );

    expect(body.amapi_sync.synced).toBe(1);
  });

  it('calls sync with device scope for device scope deployment', async () => {
    setupTransactionWithPolicies();

    // env lookup, device check, existing deployment
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({ id: 'dev_1' } as never) // device exists check
      .mockResolvedValueOnce({
        id: 'dep_1',
        created_at: '2026-02-23T00:00:00.000Z',
        updated_at: '2026-02-23T00:00:00.000Z',
      } as never);

    const oncDocument = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [
        {
          Name: 'Device WiFi',
          Type: 'WiFi',
          WiFi: { SSID: 'DeviceNet', Security: 'None', AutoConnect: true },
        },
      ],
    };

    const res = await handler(
      makeRequest({
        environment_id: 'env_1',
        name: 'Device WiFi',
        scope_type: 'device',
        scope_id: 'dev_1',
        onc_document: oncDocument,
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(201);

    // syncAffectedPoliciesToAmapi should be called with device scope
    expect(mockSyncAffectedPolicies).toHaveBeenCalledTimes(1);
    expect(mockSyncAffectedPolicies).toHaveBeenCalledWith(
      ['pol_1'],
      'env_1',
      'device',
      'dev_1',
    );

    expect(body.amapi_sync.synced).toBe(1);
  });

  it('skips AMAPI sync when no policies are affected', async () => {
    // selectPoliciesForDeploymentScope returns no policies
    mockSelectPolicies.mockResolvedValueOnce({ rows: [] } as never);

    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO network_deployments')) {
        return { rows: [{ id: 'dep_1' }] };
      }
      return { rows: [] };
    });
    mockTransaction.mockImplementation(async (fn: (tx: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    // syncAffectedPoliciesToAmapi called with empty array returns 0 synced
    mockSyncAffectedPolicies.mockResolvedValueOnce({
      attempted: 0,
      synced: 0,
      failed: 0,
      skipped_reason: null,
      failures: [],
    } as never);

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'dep_1',
        created_at: '2026-02-23T00:00:00.000Z',
        updated_at: '2026-02-23T00:00:00.000Z',
      } as never);

    const oncDocument = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [
        {
          Name: 'WiFi',
          Type: 'WiFi',
          WiFi: { SSID: 'TestNet', Security: 'None', AutoConnect: true },
        },
      ],
    };

    const res = await handler(
      makeRequest({
        environment_id: 'env_1',
        scope_type: 'environment',
        scope_id: 'env_1',
        onc_document: oncDocument,
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.amapi_sync.synced).toBe(0);
  });

  it('does not modify policies.config in the transaction', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO network_deployments')) {
        return { rows: [{ id: 'dep_1' }] };
      }
      if (sql.includes('SELECT') && sql.includes('policies')) {
        return {
          rows: [{
            id: 'pol_1',
            config: { existingField: 'should-not-change' },
            amapi_name: 'enterprises/e1/policies/pol_1',
          }],
        };
      }
      // This should NOT be called — the new flow does NOT update policies.config
      if (sql.startsWith('UPDATE policies SET config =')) {
        throw new Error('policies.config should NOT be updated directly — this is handled by derivative infrastructure');
      }
      return { rows: [] };
    });
    mockTransaction.mockImplementation(async (fn: (tx: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        id: 'dep_1',
        created_at: '2026-02-23T00:00:00.000Z',
        updated_at: '2026-02-23T00:00:00.000Z',
      } as never);

    const oncDocument = {
      Type: 'UnencryptedConfiguration',
      NetworkConfigurations: [
        {
          Name: 'WiFi',
          Type: 'WiFi',
          WiFi: { SSID: 'TestNet', Security: 'WPA-PSK', Passphrase: 'secret', AutoConnect: true },
        },
      ],
    };

    const res = await handler(
      makeRequest({
        environment_id: 'env_1',
        scope_type: 'environment',
        scope_id: 'env_1',
        onc_document: oncDocument,
      }),
      {} as never
    );

    expect(res.status).toBe(201);

    // Verify no UPDATE policies SET config was called
    const updateCalls = clientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE policies SET config')
    );
    expect(updateCalls).toHaveLength(0);
  });
});
