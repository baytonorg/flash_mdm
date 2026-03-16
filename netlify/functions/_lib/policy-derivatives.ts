import { createHash } from 'node:crypto';
import { amapiCall } from './amapi.js';
import { assertValidAmapiPolicyPayload } from './amapi-policy-validation.js';
import { execute, query, queryOne, transaction } from './db.js';
import {
  buildGeneratedPolicyPayload,
  computePolicyGenerationHash,
  type PolicyGenerationMetadata,
  type PolicyScopeType,
} from './policy-generation.js';
import { buildPolicyUpdateMask } from './policy-update-mask.js';
import { resolveVariables, buildVariableContextForDevice } from './variable-resolution.js';

type JsonObject = Record<string, unknown>;

type PolicyAssignmentRow = {
  scope_type: PolicyScopeType;
  scope_id: string;
};

type PolicyRow = {
  id: string;
  environment_id: string;
  config: JsonObject | string | null;
};

type DerivativeRow = {
  id: string;
  policy_id: string;
  environment_id: string;
  scope_type: PolicyScopeType;
  scope_id: string;
  payload_hash: string;
  amapi_name: string | null;
  config: JsonObject | string | null;
  metadata: JsonObject | string | null;
  status: string;
};

export type DeviceRow = {
  id: string;
  amapi_name: string;
};

export type PolicyAmapiContext = {
  workspace_id: string;
  gcp_project_id: string;
  enterprise_name: string;
};

export type SyncedDerivative = {
  scope_type: PolicyScopeType;
  scope_id: string;
  amapi_name: string;
  payload_hash: string;
  metadata: PolicyGenerationMetadata;
  created_or_updated: boolean;
  skipped_amapi_patch: boolean;
};

type DerivativeMetadataLike = {
  requires_per_device_derivative?: boolean;
};

type DeviceAssignmentDerivativeCandidate = {
  scope_type: PolicyScopeType;
  scope_id: string;
  amapi_name: string | null;
  metadata?: DerivativeMetadataLike | null;
};

type EffectivePolicySource = {
  scope_type: PolicyScopeType;
  scope_id: string;
};

export type PreferredDerivativeReasonCode =
  | 'source_scope_device_assignment'
  | 'source_scope_group_no_device_requirement'
  | 'source_scope_environment_no_device_requirement'
  | 'device_derivative_required_variables'
  | 'device_derivative_required_payload_diff'
  | 'device_derivative_redundant_payload_match'
  | 'fallback_missing_source_derivative'
  | 'fallback_missing_device_derivative';

export type PreferredDerivativeDecision = {
  derivative: SyncedDerivative;
  source_scope: EffectivePolicySource;
  used_device_derivative: boolean;
  reason_code: PreferredDerivativeReasonCode;
  reason_details: Record<string, unknown>;
  device_derivative_required: boolean;
  device_derivative_redundant: boolean;
};

type DerivativeDecisionInput = {
  sourceScope: EffectivePolicySource;
  sourceDerivative: SyncedDerivative;
  deviceDerivative: SyncedDerivative | null;
  requiresPerDeviceDerivative: boolean;
  deviceSpecificPayloadDiffers: boolean;
  existingDeviceDerivativePayloadHash?: string | null;
};

export function decidePreferredDerivativeSelection(input: DerivativeDecisionInput): Omit<PreferredDerivativeDecision, 'derivative' | 'source_scope'> & {
  selected: 'source' | 'device';
} {
  const {
    sourceScope,
    sourceDerivative,
    deviceDerivative,
    requiresPerDeviceDerivative,
    deviceSpecificPayloadDiffers,
    existingDeviceDerivativePayloadHash = null,
  } = input;

  const reasonDetailsBase: Record<string, unknown> = {
    source_scope: sourceScope.scope_type,
    source_scope_id: sourceScope.scope_id,
    source_payload_hash: sourceDerivative.payload_hash,
    requires_per_device_derivative: requiresPerDeviceDerivative,
    device_specific_payload_differs: deviceSpecificPayloadDiffers,
    device_derivative_present: !!deviceDerivative,
    existing_device_derivative_payload_hash: existingDeviceDerivativePayloadHash,
  };

  if (sourceScope.scope_type === 'device') {
    return {
      selected: 'source',
      used_device_derivative: true,
      reason_code: 'source_scope_device_assignment',
      reason_details: reasonDetailsBase,
      device_derivative_required: true,
      device_derivative_redundant: false,
    };
  }

  const deviceDerivativeRequired = requiresPerDeviceDerivative || deviceSpecificPayloadDiffers;
  const existingDeviceDerivativeRedundant =
    !!existingDeviceDerivativePayloadHash && existingDeviceDerivativePayloadHash === sourceDerivative.payload_hash;

  if (!deviceDerivativeRequired) {
    return {
      selected: 'source',
      used_device_derivative: false,
      reason_code:
        sourceScope.scope_type === 'group'
          ? 'source_scope_group_no_device_requirement'
          : 'source_scope_environment_no_device_requirement',
      reason_details: {
        ...reasonDetailsBase,
        ignored_existing_device_derivative: existingDeviceDerivativeRedundant || !!existingDeviceDerivativePayloadHash,
      },
      device_derivative_required: false,
      device_derivative_redundant: existingDeviceDerivativeRedundant,
    };
  }

  if (!deviceDerivative) {
    return {
      selected: 'source',
      used_device_derivative: false,
      reason_code: 'fallback_missing_device_derivative',
      reason_details: reasonDetailsBase,
      device_derivative_required: true,
      device_derivative_redundant: false,
    };
  }

  // Defensive equivalence guard: if payload-diff requirement was inferred but final hashes match,
  // collapse to source derivative and treat device derivative as redundant.
  if (!requiresPerDeviceDerivative && deviceDerivative.payload_hash === sourceDerivative.payload_hash) {
    return {
      selected: 'source',
      used_device_derivative: false,
      reason_code: 'device_derivative_redundant_payload_match',
      reason_details: {
        ...reasonDetailsBase,
        device_payload_hash: deviceDerivative.payload_hash,
      },
      device_derivative_required: false,
      device_derivative_redundant: true,
    };
  }

  return {
    selected: 'device',
    used_device_derivative: true,
    reason_code: requiresPerDeviceDerivative
      ? 'device_derivative_required_variables'
      : 'device_derivative_required_payload_diff',
    reason_details: {
      ...reasonDetailsBase,
      device_payload_hash: deviceDerivative.payload_hash,
    },
    device_derivative_required: true,
    device_derivative_redundant: false,
  };
}

export type PolicyDerivativeSyncSummary = {
  policy_id: string;
  preferred_amapi_name: string | null;
  derivatives: SyncedDerivative[];
  direct_contexts: Array<{ scope_type: PolicyScopeType; scope_id: string }>;
  forced_device_derivatives: number;
  warnings: string[];
};

export function chooseDerivativeCandidateForDeviceAssignment(input: {
  sourceScope: EffectivePolicySource;
  environmentId: string;
  deviceId: string;
  deviceGroupId: string | null;
  candidates: DeviceAssignmentDerivativeCandidate[];
}): DeviceAssignmentDerivativeCandidate | null {
  const candidates = input.candidates.filter((c) => !!c.amapi_name);
  if (candidates.length === 0) return null;

  const get = (scope_type: PolicyScopeType, scope_id: string | null | undefined) => (
    scope_id
      ? candidates.find((c) => c.scope_type === scope_type && c.scope_id === scope_id) ?? null
      : null
  );

  const deviceCandidate = get('device', input.deviceId);
  const groupCandidate = get('group', input.deviceGroupId);
  const envCandidate = get('environment', input.environmentId);

  if (input.sourceScope.scope_type === 'device') {
    return deviceCandidate ?? groupCandidate ?? envCandidate ?? candidates[0];
  }
  if (input.sourceScope.scope_type === 'group') {
    const sourceGroupCandidate = get('group', input.sourceScope.scope_id);
    if (sourceGroupCandidate) {
      const requiresPerDevice = sourceGroupCandidate.metadata?.requires_per_device_derivative === true;
      if (requiresPerDevice && deviceCandidate) return deviceCandidate;
      return sourceGroupCandidate;
    }
    return envCandidate ?? deviceCandidate ?? candidates[0];
  }

  const sourceEnvCandidate = get('environment', input.environmentId);
  if (sourceEnvCandidate) {
    const requiresPerDevice = sourceEnvCandidate.metadata?.requires_per_device_derivative === true;
    if (requiresPerDevice && deviceCandidate) return deviceCandidate;
    return sourceEnvCandidate;
  }
  return groupCandidate ?? deviceCandidate ?? candidates[0];
}

export async function getPolicyAmapiContext(environmentId: string): Promise<PolicyAmapiContext | null> {
  const env = await queryOne<{ workspace_id: string; enterprise_name: string | null }>(
    'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env?.enterprise_name) return null;

  const ws = await queryOne<{ gcp_project_id: string | null }>(
    'SELECT gcp_project_id FROM workspaces WHERE id = $1',
    [env.workspace_id]
  );
  if (!ws?.gcp_project_id) return null;

  return {
    workspace_id: env.workspace_id,
    gcp_project_id: ws.gcp_project_id,
    enterprise_name: env.enterprise_name,
  };
}

export async function syncPolicyDerivativesForPolicy(input: {
  policyId: string;
  environmentId: string;
  baseConfig: JsonObject | string | null | undefined;
  amapiContext: PolicyAmapiContext;
}): Promise<PolicyDerivativeSyncSummary> {
  const directContexts = await listDirectDerivativeContexts(input.policyId, input.environmentId);
  const derivatives: SyncedDerivative[] = [];
  const warnings: string[] = [];
  let forcedDeviceDerivatives = 0;
  const processedDeviceIds = new Set<string>();
  const pendingUpserts: PendingUpsert[] = [];

  // Phase 1: Generate payloads + call AMAPI for each scope (outside transaction).
  // DB writes are deferred to pendingUpserts for atomic batch commit (M2 fix).
  for (const context of directContexts) {
    const synced = await syncPolicyDerivativeForScope({
      policyId: input.policyId,
      environmentId: input.environmentId,
      baseConfig: input.baseConfig,
      scopeType: context.scope_type,
      scopeId: context.scope_id,
      amapiContext: input.amapiContext,
      pendingUpserts,
    });
    derivatives.push(synced);

    if (synced.metadata.ambiguous_assignment_targets && synced.metadata.ambiguous_reason) {
      warnings.push(synced.metadata.ambiguous_reason);
    }
    if (synced.metadata.requires_per_device_derivative && context.scope_type !== 'device') {
      warnings.push(
        `Policy ${input.policyId} uses device-scoped variables; generating per-device derivatives for ${context.scope_type}:${context.scope_id}`
      );
      const devices = await listAffectedDevicesForPolicyContext(input.policyId, input.environmentId, context.scope_type, context.scope_id);
      for (const device of devices) {
        if (processedDeviceIds.has(device.id)) continue;
        processedDeviceIds.add(device.id);
        const deviceSynced = await syncPolicyDerivativeForScope({
          policyId: input.policyId,
          environmentId: input.environmentId,
          baseConfig: input.baseConfig,
          scopeType: 'device',
          scopeId: device.id,
          amapiContext: input.amapiContext,
          pendingUpserts,
        });
        derivatives.push(deviceSynced);
        forcedDeviceDerivatives += 1;
      }
    }
  }

  // Phase 2: Batch all DB upserts in a single transaction for atomicity
  if (pendingUpserts.length > 0) {
    await transaction(async (client) => {
      for (const upsert of pendingUpserts) {
        await client.query(
          `INSERT INTO policy_derivatives (
             policy_id, environment_id, scope_type, scope_id, payload_hash, amapi_name, config, metadata, status, last_synced_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'production', now(), now())
           ON CONFLICT (policy_id, scope_type, scope_id)
           DO UPDATE SET
             payload_hash = EXCLUDED.payload_hash,
             amapi_name = EXCLUDED.amapi_name,
             config = EXCLUDED.config,
             metadata = EXCLUDED.metadata,
             status = 'production',
             last_synced_at = now(),
             updated_at = now()`,
          [
            upsert.policyId,
            upsert.environmentId,
            upsert.scopeType,
            upsert.scopeId,
            upsert.payloadHash,
            upsert.amapiName,
            JSON.stringify(upsert.payload),
            JSON.stringify(upsert.metadata),
          ]
        );
      }
      // Update canonical AMAPI name for environment-scoped derivatives
      for (const upsert of pendingUpserts) {
        if (upsert.scopeType === 'environment' && upsert.scopeId === input.environmentId) {
          await client.query(
            `UPDATE policies
             SET amapi_name = COALESCE($1, amapi_name),
                 status = 'production',
                 updated_at = now()
             WHERE id = $2`,
            [upsert.amapiName, upsert.policyId]
          );
        }
      }
    });
  }

  const preferred = pickPreferredDerivative(derivatives, input.environmentId);
  return {
    policy_id: input.policyId,
    preferred_amapi_name: preferred?.amapi_name ?? null,
    derivatives,
    direct_contexts: directContexts,
    forced_device_derivatives: forcedDeviceDerivatives,
    warnings: [...new Set(warnings)],
  };
}

export async function ensurePolicyDerivativeForScope(input: {
  policyId: string;
  environmentId: string;
  scopeType: PolicyScopeType;
  scopeId: string;
  amapiContext?: PolicyAmapiContext;
  baseConfig?: JsonObject | string | null;
}): Promise<SyncedDerivative> {
  const amapiContext = input.amapiContext ?? await getPolicyAmapiContext(input.environmentId);
  if (!amapiContext) {
    throw new Error('Environment is not bound to an enterprise or workspace GCP project is not configured');
  }

  let baseConfig = input.baseConfig;
  if (baseConfig === undefined) {
    const policy = await queryOne<PolicyRow>(
      'SELECT id, environment_id, config FROM policies WHERE id = $1 AND environment_id = $2',
      [input.policyId, input.environmentId]
    );
    if (!policy) throw new Error('Policy not found in environment');
    baseConfig = policy.config ?? {};
  }

  return syncPolicyDerivativeForScope({
    policyId: input.policyId,
    environmentId: input.environmentId,
    baseConfig,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    amapiContext,
  });
}

export async function assignPolicyToDeviceWithDerivative(input: {
  policyId: string;
  environmentId: string;
  deviceId: string;
  deviceAmapiName?: string;
  amapiContext?: PolicyAmapiContext;
  baseConfig?: JsonObject | string | null;
}): Promise<{ policy_name: string; derivative: SyncedDerivative }> {
  const amapiContext = input.amapiContext ?? await getPolicyAmapiContext(input.environmentId);
  if (!amapiContext) {
    throw new Error('Environment is not bound to an enterprise or workspace GCP project is not configured');
  }

  const device = input.deviceAmapiName
    ? await queryOne<{ id: string; amapi_name: string; group_id: string | null }>(
        `SELECT id, amapi_name, group_id
         FROM devices
         WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL`,
        [input.deviceId, input.environmentId]
      )
    : await queryOne<DeviceRow>(
        `SELECT id, amapi_name
         FROM devices
         WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL`,
        [input.deviceId, input.environmentId]
      );
  if (!device?.amapi_name) throw new Error('Device not found in environment');

  const preferred = await ensurePreferredDerivativeForDevicePolicy({
    policyId: input.policyId,
    environmentId: input.environmentId,
    deviceId: input.deviceId,
    deviceAmapiName: device.amapi_name,
    amapiContext,
    baseConfig: input.baseConfig,
  });
  const derivative = preferred.derivative;
  const expectedGenerationHash =
    typeof derivative.metadata?.generation_hash === 'string' && derivative.metadata.generation_hash.trim()
      ? derivative.metadata.generation_hash.trim()
      : null;

  if (expectedGenerationHash) {
    const currentDeviceSync = await queryOne<{ last_policy_sync_name: string | null }>(
      'SELECT last_policy_sync_name FROM devices WHERE id = $1',
      [input.deviceId]
    );
    if (currentDeviceSync?.last_policy_sync_name === derivative.amapi_name) {
      const derivativeRow = await queryOne<{ metadata: JsonObject | string | null }>(
        `SELECT metadata
         FROM policy_derivatives
         WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3
         LIMIT 1`,
        [input.policyId, derivative.scope_type, derivative.scope_id]
      );
      const derivativeMetadata = normalizeJsonObject(derivativeRow?.metadata) ?? {};
      const storedGenerationHash =
        typeof derivativeMetadata.generation_hash === 'string' && derivativeMetadata.generation_hash.trim()
          ? derivativeMetadata.generation_hash.trim()
          : null;
      if (storedGenerationHash === expectedGenerationHash) {
        await execute(
          `UPDATE devices
           SET last_policy_sync_at = now(),
               last_policy_sync_name = $2,
               updated_at = now()
           WHERE id = $1`,
          [input.deviceId, derivative.amapi_name]
        );
        return { policy_name: derivative.amapi_name, derivative };
      }
    }
  }

  const path = `${device.amapi_name}?updateMask=${encodeURIComponent('policyName')}`;
  await amapiCall(path, amapiContext.workspace_id, {
    method: 'PATCH',
    body: { policyName: derivative.amapi_name },
    projectId: amapiContext.gcp_project_id,
    enterpriseName: amapiContext.enterprise_name,
    resourceType: 'devices',
    resourceId: device.amapi_name,
  });

  await execute(
    `UPDATE devices
     SET last_policy_sync_at = now(),
         last_policy_sync_name = $2,
         updated_at = now()
     WHERE id = $1`,
    [input.deviceId, derivative.amapi_name]
  );

  return { policy_name: derivative.amapi_name, derivative };
}

export async function ensurePreferredDerivativeForDevicePolicy(input: {
  policyId: string;
  environmentId: string;
  deviceId: string;
  deviceAmapiName?: string;
  amapiContext?: PolicyAmapiContext;
  baseConfig?: JsonObject | string | null;
}): Promise<PreferredDerivativeDecision> {
  const amapiContext = input.amapiContext ?? await getPolicyAmapiContext(input.environmentId);
  if (!amapiContext) {
    throw new Error('Environment is not bound to an enterprise or workspace GCP project is not configured');
  }

  const device = await queryOne<{ id: string; amapi_name: string; group_id: string | null }>(
    `SELECT id, amapi_name, group_id
     FROM devices
     WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL`,
    [input.deviceId, input.environmentId]
  );
  if (!device?.amapi_name) throw new Error('Device not found in environment');

  const sourceScope = await resolveEffectivePolicySourceForDevice({
    policyId: input.policyId,
    environmentId: input.environmentId,
    deviceId: input.deviceId,
    deviceGroupId: device.group_id,
  });

  const sourceDerivative = await ensurePolicyDerivativeForScope({
    policyId: input.policyId,
    environmentId: input.environmentId,
    scopeType: sourceScope.scope_type,
    scopeId: sourceScope.scope_id,
    amapiContext,
    baseConfig: input.baseConfig,
  });

  const requiresPerDeviceDerivative = sourceDerivative.metadata.requires_per_device_derivative === true;
  let deviceSpecificPayloadDiffers = false;
  let existingDeviceDerivativePayloadHash: string | null = null;
  if (sourceScope.scope_type !== 'device') {
    const existingDeviceDerivative = await queryOne<{ payload_hash: string | null }>(
      `SELECT payload_hash
       FROM policy_derivatives
       WHERE policy_id = $1 AND scope_type = 'device' AND scope_id = $2
       LIMIT 1`,
      [input.policyId, input.deviceId]
    );
    existingDeviceDerivativePayloadHash = existingDeviceDerivative?.payload_hash ?? null;
  }
  if (sourceScope.scope_type !== 'device' && !requiresPerDeviceDerivative) {
    const devicePreview = await buildGeneratedPolicyPayload({
      policyId: input.policyId,
      environmentId: input.environmentId,
      baseConfig: input.baseConfig,
      target: { mode: 'scope', scope_type: 'device', scope_id: input.deviceId },
    });
    // When there are no device-scoped variables, compare generated payload hashes directly.
    // This catches device-scoped app/network deployments that require a device derivative.
    if (devicePreview.metadata.device_scoped_variables.length === 0) {
      deviceSpecificPayloadDiffers = hashPayload(devicePreview.payload) !== sourceDerivative.payload_hash;
    }
  }

  let deviceDerivative: SyncedDerivative | null = null;
  if (sourceScope.scope_type !== 'device' && (requiresPerDeviceDerivative || deviceSpecificPayloadDiffers)) {
    deviceDerivative = await ensurePolicyDerivativeForScope({
      policyId: input.policyId,
      environmentId: input.environmentId,
      scopeType: 'device',
      scopeId: input.deviceId,
      amapiContext,
      baseConfig: input.baseConfig,
    });
  }

  const decision = decidePreferredDerivativeSelection({
    sourceScope,
    sourceDerivative,
    deviceDerivative,
    requiresPerDeviceDerivative,
    deviceSpecificPayloadDiffers,
    existingDeviceDerivativePayloadHash,
  });

  return {
    derivative: decision.selected === 'device' && deviceDerivative ? deviceDerivative : sourceDerivative,
    source_scope: sourceScope,
    used_device_derivative: decision.used_device_derivative,
    reason_code: decision.reason_code,
    reason_details: decision.reason_details,
    device_derivative_required: decision.device_derivative_required,
    device_derivative_redundant: decision.device_derivative_redundant,
  };
}

async function listDirectDerivativeContexts(policyId: string, environmentId: string): Promise<Array<{ scope_type: PolicyScopeType; scope_id: string }>> {
  const assignments = await query<PolicyAssignmentRow>(
    `SELECT scope_type, scope_id
     FROM policy_assignments
     WHERE policy_id = $1
     ORDER BY CASE scope_type WHEN 'environment' THEN 1 WHEN 'group' THEN 2 ELSE 3 END, created_at ASC`,
    [policyId]
  );

  const unique = new Map<string, { scope_type: PolicyScopeType; scope_id: string }>();
  for (const row of assignments) {
    unique.set(`${row.scope_type}:${row.scope_id}`, { scope_type: row.scope_type, scope_id: row.scope_id });
  }
  if (unique.size === 0) {
    // No assignments — no derivatives needed (M5 fix: don't create phantom env derivative)
    return [];
  }
  return [...unique.values()];
}

type PendingUpsert = {
  policyId: string;
  environmentId: string;
  scopeType: PolicyScopeType;
  scopeId: string;
  payloadHash: string;
  amapiName: string;
  payload: JsonObject;
  metadata: PolicyGenerationMetadata;
};

async function syncPolicyDerivativeForScope(input: {
  policyId: string;
  environmentId: string;
  baseConfig: JsonObject | string | null | undefined;
  scopeType: PolicyScopeType;
  scopeId: string;
  amapiContext: PolicyAmapiContext;
  pendingUpserts?: PendingUpsert[];
}): Promise<SyncedDerivative> {
  const generated = await buildGeneratedPolicyPayload({
    policyId: input.policyId,
    environmentId: input.environmentId,
    baseConfig: input.baseConfig,
    target: { mode: 'scope', scope_type: input.scopeType, scope_id: input.scopeId },
  });

  let payload = generated.payload;

  // Resolve variables for device-scoped derivatives
  if (input.scopeType === 'device' && generated.metadata.device_scoped_variables.length > 0) {
    try {
      const variableContext = await buildVariableContextForDevice(input.scopeId, input.environmentId);
      const resolution = resolveVariables(payload, variableContext);
      payload = resolution.config;
      generated.metadata.device_variable_interpolation_supported = true;

      if (resolution.unresolved_variables.length > 0) {
        console.warn('policy-derivatives: unresolved variables', {
          policy_id: input.policyId,
          device_id: input.scopeId,
          unresolved: resolution.unresolved_variables,
        });
      }
    } catch (err) {
      console.warn('policy-derivatives: variable resolution failed (non-fatal)', {
        policy_id: input.policyId,
        device_id: input.scopeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  generated.metadata.generation_hash = computePolicyGenerationHash(payload, generated.metadata);
  const payloadHash = hashPayload(payload);
  const existing = await queryOne<DerivativeRow>(
    `SELECT id, policy_id, environment_id, scope_type, scope_id, payload_hash, amapi_name, config, metadata, status
     FROM policy_derivatives
     WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3`,
    [input.policyId, input.scopeType, input.scopeId]
  );

  const resourceName = existing?.amapi_name ?? `${input.amapiContext.enterprise_name}/policies/${buildDerivativeResourceId(
    input.policyId,
    input.scopeType,
    input.scopeId
  )}`;

  const skippedAmapiPatch = false;
  let createdOrUpdated = false;
  const existingMetadata = normalizeJsonObject(existing?.metadata);
  const existingGenerationHash =
    typeof existingMetadata?.generation_hash === 'string' && existingMetadata.generation_hash.trim()
      ? existingMetadata.generation_hash.trim()
      : null;
  const currentGenerationHash =
    typeof generated.metadata.generation_hash === 'string' && generated.metadata.generation_hash.trim()
      ? generated.metadata.generation_hash.trim()
      : null;
  const generationHashMatches = !!currentGenerationHash && existingGenerationHash === currentGenerationHash;

  if (existing?.payload_hash === payloadHash && existing.amapi_name) {
    // Payload unchanged: skip AMAPI patch. If generation metadata hash is missing/stale,
    // do a local metadata backfill/update so downstream no-op checks can rely on it.
    if (!generationHashMatches) {
      const metadataOnlyUpsert: PendingUpsert = {
        policyId: input.policyId,
        environmentId: input.environmentId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        payloadHash,
        amapiName: existing.amapi_name,
        payload,
        metadata: generated.metadata,
      };
      if (input.pendingUpserts) {
        input.pendingUpserts.push(metadataOnlyUpsert);
      } else {
        await upsertDerivativeRow(metadataOnlyUpsert);
        await maybeUpdatePolicyCanonicalAmapiName(
          input.policyId,
          existing.amapi_name,
          input.scopeType,
          input.scopeId,
          input.environmentId
        );
      }
      createdOrUpdated = true;
    }
    return {
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      amapi_name: existing.amapi_name,
      payload_hash: payloadHash,
      metadata: generated.metadata,
      created_or_updated: createdOrUpdated,
      skipped_amapi_patch: true,
    };
  } else {
    const previousConfig = normalizeJsonObject(existing?.config) ?? {};
    const updateMask = buildPolicyUpdateMask(previousConfig, payload);
    const path = updateMask ? `${resourceName}?updateMask=${encodeURIComponent(updateMask)}` : resourceName;
    assertValidAmapiPolicyPayload(payload);
    const result = await amapiCall<{ name?: string }>(path, input.amapiContext.workspace_id, {
      method: 'PATCH',
      body: payload,
      projectId: input.amapiContext.gcp_project_id,
      enterpriseName: input.amapiContext.enterprise_name,
      resourceType: 'policies',
      resourceId: buildDerivativeResourceId(input.policyId, input.scopeType, input.scopeId),
    });
    const finalName = result.name ?? resourceName;

    const upsertData: PendingUpsert = {
      policyId: input.policyId,
      environmentId: input.environmentId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      payloadHash,
      amapiName: finalName,
      payload,
      metadata: generated.metadata,
    };

    if (input.pendingUpserts) {
      // M2 fix: defer DB write to batch transaction
      input.pendingUpserts.push(upsertData);
    } else {
      await upsertDerivativeRow(upsertData);
      await maybeUpdatePolicyCanonicalAmapiName(input.policyId, finalName, input.scopeType, input.scopeId, input.environmentId);
    }

    createdOrUpdated = true;

    return {
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      amapi_name: finalName,
      payload_hash: payloadHash,
      metadata: generated.metadata,
      created_or_updated: createdOrUpdated,
      skipped_amapi_patch: skippedAmapiPatch,
    };
  }

  // Unreachable: hash-match returns early above, and the else branch returns after AMAPI patch.
  // Guard for safety.
  throw new Error('Failed to synchronize policy derivative');
}

async function upsertDerivativeRow(input: {
  policyId: string;
  environmentId: string;
  scopeType: PolicyScopeType;
  scopeId: string;
  payloadHash: string;
  amapiName: string;
  payload: JsonObject;
  metadata: PolicyGenerationMetadata;
}): Promise<void> {
  await execute(
    `INSERT INTO policy_derivatives (
       policy_id, environment_id, scope_type, scope_id, payload_hash, amapi_name, config, metadata, status, last_synced_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'production', now(), now())
     ON CONFLICT (policy_id, scope_type, scope_id)
     DO UPDATE SET
       payload_hash = EXCLUDED.payload_hash,
       amapi_name = EXCLUDED.amapi_name,
       config = EXCLUDED.config,
       metadata = EXCLUDED.metadata,
       status = 'production',
       last_synced_at = now(),
       updated_at = now()`,
    [
      input.policyId,
      input.environmentId,
      input.scopeType,
      input.scopeId,
      input.payloadHash,
      input.amapiName,
      JSON.stringify(input.payload),
      JSON.stringify(input.metadata),
    ]
  );
}

async function maybeUpdatePolicyCanonicalAmapiName(
  policyId: string,
  amapiName: string,
  scopeType: PolicyScopeType,
  scopeId: string,
  environmentId: string
): Promise<void> {
  if (scopeType === 'environment' && scopeId === environmentId) {
    await execute(
      `UPDATE policies
       SET amapi_name = COALESCE($1, amapi_name),
           status = 'production',
           updated_at = now()
       WHERE id = $2`,
      [amapiName, policyId]
    );
  }
}

function pickPreferredDerivative(derivatives: SyncedDerivative[], environmentId: string): SyncedDerivative | null {
  if (derivatives.length === 0) return null;
  const env = derivatives.find((d) => d.scope_type === 'environment' && d.scope_id === environmentId);
  if (env) return env;
  const group = derivatives.find((d) => d.scope_type === 'group');
  if (group) return group;
  return derivatives[0];
}

async function resolveEffectivePolicySourceForDevice(input: {
  policyId: string;
  environmentId: string;
  deviceId: string;
  deviceGroupId: string | null;
}): Promise<EffectivePolicySource> {
  const deviceAssignment = await queryOne<{ scope_id: string }>(
    `SELECT scope_id
     FROM policy_assignments
     WHERE policy_id = $1
       AND scope_type = 'device'
       AND scope_id = $2
     LIMIT 1`,
    [input.policyId, input.deviceId]
  );
  if (deviceAssignment) {
    return { scope_type: 'device', scope_id: input.deviceId };
  }

  if (input.deviceGroupId) {
    const groupAssignment = await queryOne<{ scope_id: string }>(
      `SELECT pa.scope_id
       FROM group_closures gc
       JOIN policy_assignments pa
         ON pa.scope_type = 'group'
        AND pa.scope_id = gc.ancestor_id
        AND pa.policy_id = $2
       WHERE gc.descendant_id = $1
       ORDER BY gc.depth ASC
       LIMIT 1`,
      [input.deviceGroupId, input.policyId]
    );
    if (groupAssignment) {
      return { scope_type: 'group', scope_id: groupAssignment.scope_id };
    }
  }

  const envAssignment = await queryOne<{ scope_id: string }>(
    `SELECT scope_id
     FROM policy_assignments
     WHERE policy_id = $1
       AND scope_type = 'environment'
       AND scope_id = $2
     LIMIT 1`,
    [input.policyId, input.environmentId]
  );
  if (envAssignment) {
    return { scope_type: 'environment', scope_id: input.environmentId };
  }

  // Fallback: preserve historical behavior by using a device derivative if no explicit assignment row exists.
  return { scope_type: 'device', scope_id: input.deviceId };
}

export async function listAffectedDevicesForPolicyContext(
  policyId: string,
  environmentId: string,
  scopeType: PolicyScopeType,
  scopeId: string
): Promise<DeviceRow[]> {
  if (scopeType === 'device') {
    return query<DeviceRow>(
      `SELECT id, amapi_name
       FROM devices
       WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL`,
      [scopeId, environmentId]
    );
  }

  if (scopeType === 'group') {
    return query<DeviceRow>(
      `SELECT DISTINCT d.id, d.amapi_name
       FROM devices d
       JOIN group_closures scope_gc
         ON scope_gc.descendant_id = d.group_id
        AND scope_gc.ancestor_id = $3
       LEFT JOIN LATERAL (
         SELECT pa.policy_id
         FROM policy_assignments pa
         WHERE pa.scope_type = 'device' AND pa.scope_id = d.id
         LIMIT 1
       ) dpa ON TRUE
       LEFT JOIN LATERAL (
         SELECT pa.policy_id
         FROM group_closures gc
         JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
         WHERE gc.descendant_id = d.group_id
         ORDER BY gc.depth ASC
         LIMIT 1
       ) gpa ON TRUE
       LEFT JOIN LATERAL (
         SELECT pa.policy_id
         FROM policy_assignments pa
         WHERE pa.scope_type = 'environment' AND pa.scope_id = d.environment_id
         LIMIT 1
       ) epa ON TRUE
       WHERE d.environment_id = $1
         AND d.deleted_at IS NULL
         AND COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id) = $2`,
      [environmentId, policyId, scopeId]
    );
  }

  return query<DeviceRow>(
    `SELECT DISTINCT d.id, d.amapi_name
     FROM devices d
     LEFT JOIN LATERAL (
       SELECT pa.policy_id
       FROM policy_assignments pa
       WHERE pa.scope_type = 'device' AND pa.scope_id = d.id
       LIMIT 1
     ) dpa ON TRUE
     LEFT JOIN LATERAL (
       SELECT pa.policy_id
       FROM group_closures gc
       JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
       WHERE d.group_id IS NOT NULL AND gc.descendant_id = d.group_id
       ORDER BY gc.depth ASC
       LIMIT 1
     ) gpa ON TRUE
     LEFT JOIN LATERAL (
       SELECT pa.policy_id
       FROM policy_assignments pa
       WHERE pa.scope_type = 'environment' AND pa.scope_id = d.environment_id
       LIMIT 1
     ) epa ON TRUE
     WHERE d.environment_id = $1
       AND d.deleted_at IS NULL
       AND COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id) = $2`,
    [environmentId, policyId]
  );
}

function buildDerivativeResourceId(policyId: string, scopeType: PolicyScopeType, scopeId: string): string {
  const policyToken = policyId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || 'policy';
  const scopeToken = scopeId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16) || 'scope';
  const hashToken = createHash('sha256').update(`${policyId}:${scopeType}:${scopeId}`).digest('hex').slice(0, 12);
  return `pd-${policyToken}-${scopeType}-${scopeToken}-${hashToken}`.slice(0, 120);
}

function hashPayload(payload: JsonObject): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeJsonObject(value: unknown): JsonObject | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}
