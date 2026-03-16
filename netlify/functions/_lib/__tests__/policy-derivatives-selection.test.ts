import { describe, expect, it } from 'vitest';
import {
  chooseDerivativeCandidateForDeviceAssignment,
  decidePreferredDerivativeSelection,
} from '../policy-derivatives.ts';

describe('chooseDerivativeCandidateForDeviceAssignment', () => {
  const environmentId = 'env-1';
  const groupId = 'group-1';
  const deviceId = 'device-1';

  it('prefers group derivative over stale device derivative when per-device derivative is not required', () => {
    const selected = chooseDerivativeCandidateForDeviceAssignment({
      sourceScope: { scope_type: 'group', scope_id: groupId },
      environmentId,
      deviceId,
      deviceGroupId: groupId,
      candidates: [
        {
          scope_type: 'device',
          scope_id: deviceId,
          amapi_name: 'enterprises/e/policies/device-old',
          metadata: { requires_per_device_derivative: false },
        },
        {
          scope_type: 'group',
          scope_id: groupId,
          amapi_name: 'enterprises/e/policies/group-current',
          metadata: { requires_per_device_derivative: false },
        },
      ],
    });

    expect(selected?.scope_type).toBe('group');
    expect(selected?.amapi_name).toBe('enterprises/e/policies/group-current');
  });

  it('uses device derivative when the source derivative requires per-device derivatives', () => {
    const selected = chooseDerivativeCandidateForDeviceAssignment({
      sourceScope: { scope_type: 'group', scope_id: groupId },
      environmentId,
      deviceId,
      deviceGroupId: groupId,
      candidates: [
        {
          scope_type: 'device',
          scope_id: deviceId,
          amapi_name: 'enterprises/e/policies/device-current',
          metadata: { requires_per_device_derivative: true },
        },
        {
          scope_type: 'group',
          scope_id: groupId,
          amapi_name: 'enterprises/e/policies/group-base',
          metadata: { requires_per_device_derivative: true },
        },
      ],
    });

    expect(selected?.scope_type).toBe('device');
    expect(selected?.amapi_name).toBe('enterprises/e/policies/device-current');
  });

  it('keeps device derivative for direct device assignments', () => {
    const selected = chooseDerivativeCandidateForDeviceAssignment({
      sourceScope: { scope_type: 'device', scope_id: deviceId },
      environmentId,
      deviceId,
      deviceGroupId: groupId,
      candidates: [
        {
          scope_type: 'device',
          scope_id: deviceId,
          amapi_name: 'enterprises/e/policies/device-direct',
          metadata: { requires_per_device_derivative: false },
        },
        {
          scope_type: 'group',
          scope_id: groupId,
          amapi_name: 'enterprises/e/policies/group',
          metadata: { requires_per_device_derivative: false },
        },
      ],
    });

    expect(selected?.scope_type).toBe('device');
    expect(selected?.amapi_name).toBe('enterprises/e/policies/device-direct');
  });
});

describe('decidePreferredDerivativeSelection', () => {
  const sourceGroupScope = { scope_type: 'group' as const, scope_id: 'group-1' };
  const sourceDerivative = {
    scope_type: 'group' as const,
    scope_id: 'group-1',
    amapi_name: 'enterprises/e/policies/group',
    payload_hash: 'hash-group',
    metadata: { requires_per_device_derivative: false } as any,
    created_or_updated: false,
    skipped_amapi_patch: true,
  };

  it('collapses to source when existing device derivative is redundant and no requirement exists', () => {
    const decision = decidePreferredDerivativeSelection({
      sourceScope: sourceGroupScope,
      sourceDerivative,
      deviceDerivative: null,
      requiresPerDeviceDerivative: false,
      deviceSpecificPayloadDiffers: false,
      existingDeviceDerivativePayloadHash: 'hash-group',
    });

    expect(decision.selected).toBe('source');
    expect(decision.reason_code).toBe('source_scope_group_no_device_requirement');
    expect(decision.device_derivative_required).toBe(false);
    expect(decision.device_derivative_redundant).toBe(true);
  });

  it('selects device derivative when payload differs without device variables', () => {
    const decision = decidePreferredDerivativeSelection({
      sourceScope: sourceGroupScope,
      sourceDerivative,
      deviceDerivative: {
        ...sourceDerivative,
        scope_type: 'device',
        scope_id: 'device-1',
        amapi_name: 'enterprises/e/policies/device',
        payload_hash: 'hash-device',
      },
      requiresPerDeviceDerivative: false,
      deviceSpecificPayloadDiffers: true,
    });

    expect(decision.selected).toBe('device');
    expect(decision.reason_code).toBe('device_derivative_required_payload_diff');
    expect(decision.device_derivative_required).toBe(true);
    expect(decision.device_derivative_redundant).toBe(false);
  });

  it('selects device derivative when per-device variable interpolation is required', () => {
    const decision = decidePreferredDerivativeSelection({
      sourceScope: sourceGroupScope,
      sourceDerivative,
      deviceDerivative: {
        ...sourceDerivative,
        scope_type: 'device',
        scope_id: 'device-1',
        amapi_name: 'enterprises/e/policies/device',
        payload_hash: 'hash-device-var',
      },
      requiresPerDeviceDerivative: true,
      deviceSpecificPayloadDiffers: false,
    });

    expect(decision.selected).toBe('device');
    expect(decision.reason_code).toBe('device_derivative_required_variables');
  });

  it('keeps source selection for device source assignments even if payloads match', () => {
    const decision = decidePreferredDerivativeSelection({
      sourceScope: { scope_type: 'device', scope_id: 'device-1' },
      sourceDerivative: {
        ...sourceDerivative,
        scope_type: 'device',
        scope_id: 'device-1',
        amapi_name: 'enterprises/e/policies/device-direct',
      },
      deviceDerivative: null,
      requiresPerDeviceDerivative: false,
      deviceSpecificPayloadDiffers: false,
    });

    expect(decision.selected).toBe('source');
    expect(decision.reason_code).toBe('source_scope_device_assignment');
    expect(decision.used_device_derivative).toBe(true);
  });

  it('defensively falls back to source when payload-diff requirement converges to identical payload hash', () => {
    const decision = decidePreferredDerivativeSelection({
      sourceScope: sourceGroupScope,
      sourceDerivative,
      deviceDerivative: {
        ...sourceDerivative,
        scope_type: 'device',
        scope_id: 'device-1',
        amapi_name: 'enterprises/e/policies/device',
        payload_hash: 'hash-group',
      },
      requiresPerDeviceDerivative: false,
      deviceSpecificPayloadDiffers: true,
    });

    expect(decision.selected).toBe('source');
    expect(decision.reason_code).toBe('device_derivative_redundant_payload_match');
    expect(decision.device_derivative_redundant).toBe(true);
    expect(decision.device_derivative_required).toBe(false);
  });
});
