import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  executeMock: vi.fn(),
  transactionMock: vi.fn(),
  amapiCallMock: vi.fn(),
  buildGeneratedPolicyPayloadMock: vi.fn(),
  computePolicyGenerationHashMock: vi.fn(),
}));
const {
  queryMock,
  queryOneMock,
  executeMock,
  transactionMock,
  amapiCallMock,
  buildGeneratedPolicyPayloadMock,
  computePolicyGenerationHashMock,
} = mocks;

vi.mock('../db.js', () => ({
  query: mocks.queryMock,
  queryOne: mocks.queryOneMock,
  execute: mocks.executeMock,
  transaction: mocks.transactionMock,
}));

vi.mock('../amapi.js', () => ({
  amapiCall: mocks.amapiCallMock,
}));

vi.mock('../policy-generation.js', () => ({
  buildGeneratedPolicyPayload: mocks.buildGeneratedPolicyPayloadMock,
  computePolicyGenerationHash: mocks.computePolicyGenerationHashMock,
}));

vi.mock('../policy-update-mask.js', () => ({
  buildPolicyUpdateMask: vi.fn(() => ''),
}));

vi.mock('../variable-resolution.js', () => ({
  resolveVariables: vi.fn((config) => ({ config, unresolved_variables: [] })),
  buildVariableContextForDevice: vi.fn(),
}));

import { ensurePolicyDerivativeForScope } from '../policy-derivatives.ts';

describe('policy-derivatives no-op metadata backfill', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
    executeMock.mockReset();
    transactionMock.mockReset();
    amapiCallMock.mockReset();
    buildGeneratedPolicyPayloadMock.mockReset();
    computePolicyGenerationHashMock.mockReset();
    executeMock.mockResolvedValue({ rowCount: 1 });
    transactionMock.mockImplementation(async (fn: (client: { query: typeof vi.fn }) => Promise<void>) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
      await fn(client);
    });
  });

  it('backfills generation_hash locally when payload is unchanged and skips AMAPI patch', async () => {
    buildGeneratedPolicyPayloadMock.mockResolvedValue({
      payload: { cameraDisabled: true },
      metadata: {
        model: 'layered_overrides',
        assignments_considered: [],
        resolved_target: { scope_type: 'group', scope_id: 'grp_1' },
        ambiguous_assignment_targets: false,
        ambiguous_reason: null,
        device_scoped_variables: [],
        requires_per_device_derivative: false,
        device_variable_interpolation_supported: false,
        group_overrides_applied: [],
        device_overrides_applied: [],
        locked_sections: [],
        generation_hash: 'new-hash',
      },
    });
    computePolicyGenerationHashMock.mockReturnValue('new-hash');

    queryOneMock.mockResolvedValue({
      id: 'deriv_1',
      policy_id: 'pol_1',
      environment_id: 'env_1',
      scope_type: 'group',
      scope_id: 'grp_1',
      payload_hash: '50f9eead0a1e8a25b4362d5121ae8df6b4b085a451809320c86b327148157be7',
      amapi_name: 'enterprises/e/policies/pd-pol1-group-grp1',
      config: { cameraDisabled: true },
      metadata: { requires_per_device_derivative: false }, // no generation_hash yet
      status: 'production',
    });

    const result = await ensurePolicyDerivativeForScope({
      policyId: 'pol_1',
      environmentId: 'env_1',
      scopeType: 'group',
      scopeId: 'grp_1',
      baseConfig: {},
      amapiContext: {
        workspace_id: 'ws_1',
        gcp_project_id: 'proj_1',
        enterprise_name: 'enterprises/e',
      },
    });

    expect(result.amapi_name).toBe('enterprises/e/policies/pd-pol1-group-grp1');
    expect(result.skipped_amapi_patch).toBe(true);
    expect(result.created_or_updated).toBe(true); // local metadata backfill occurred
    expect(result.metadata.generation_hash).toBe('new-hash');
    expect(amapiCallMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(String(executeMock.mock.calls[0]?.[0] ?? '')).toContain('INSERT INTO policy_derivatives');
  });
});
