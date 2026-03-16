import { execute, query, queryOne, transaction } from './db.js';
import { storeBlob } from './blobs.js';
import { amapiCall } from './amapi.js';
import { assertValidAmapiPolicyPayload } from './amapi-policy-validation.js';
import { buildPolicyUpdateMask } from './policy-update-mask.js';
import { buildGeneratedPolicyPayload } from './policy-generation.js';
import { syncPolicyDerivativesForPolicy } from './policy-derivatives.js';

/**
 * Deep-merge two objects. Later (source) wins on conflicts.
 */
export function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Strip null, undefined, empty objects and empty arrays recursively.
 */
export function sanitizeConfig(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    const filtered = obj.map(sanitizeConfig).filter((v) => v !== undefined);
    return filtered.length > 0 ? filtered : undefined;
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const cleaned = sanitizeConfig(value);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return obj;
}

/**
 * Recompile a policy from its assigned components + own config overrides.
 * 1. Fetch all assigned components ordered by priority ASC
 * 2. Deep-merge each component's config_fragment (later priority wins)
 * 3. Deep-merge the policy's own config overrides on top
 * 4. Strip empty/null values
 * 5. Update policies.config with the compiled result
 * 6. Increment version, store in policy_versions
 */
export async function recompilePolicy(policyId: string, userId: string): Promise<void> {
  // Fetch assigned components ordered by priority (read-only, safe outside transaction)
  const assignments = await query<{
    config_fragment: Record<string, any>;
    priority: number;
  }>(
    `SELECT pc.config_fragment, pca.priority
     FROM policy_component_assignments pca
     JOIN policy_components pc ON pc.id = pca.component_id
     WHERE pca.policy_id = $1
     ORDER BY pca.priority ASC`,
    [policyId]
  );

  // Start with empty, merge each component fragment
  let compiled: Record<string, any> = {};
  for (const assignment of assignments) {
    const fragment = typeof assignment.config_fragment === 'string'
      ? JSON.parse(assignment.config_fragment)
      : assignment.config_fragment;
    compiled = deepMerge(compiled, fragment);
  }

  // Use a transaction with FOR UPDATE to prevent version race conditions
  const { version: newVersion, configJson, previousCompiled, environmentId, amapiName } = await transaction(async (client) => {
    // Lock the policy row and get current version atomically
    const result = await client.query(
      'SELECT id, config, version, environment_id, amapi_name FROM policies WHERE id = $1 FOR UPDATE',
      [policyId]
    );
    const policy = result.rows[0];
    if (!policy) throw new Error('Policy not found');

    // Merge policy's own config overrides on top of component fragments
    const policyConfig = typeof policy.config === 'string'
      ? JSON.parse(policy.config)
      : (policy.config ?? {});
    const finalCompiled = deepMerge(compiled, policyConfig);

    // Strip empty/null values
    const cleanConfig = sanitizeConfig(finalCompiled) ?? {};
    const ver = policy.version + 1;
    const serialized = JSON.stringify(cleanConfig);
    const previousCompiled = typeof policy.config === 'string'
      ? JSON.parse(policy.config)
      : (policy.config ?? {});

    // Store version
    await client.query(
      `INSERT INTO policy_versions (policy_id, version, config, changed_by, change_summary)
       VALUES ($1, $2, $3, $4, 'Component recompilation')`,
      [policyId, ver, serialized, userId]
    );

    // Update policy
    await client.query(
      `UPDATE policies SET config = $1, version = $2, updated_at = now() WHERE id = $3`,
      [serialized, ver, policyId]
    );

    return {
      version: ver,
      configJson: serialized,
      previousCompiled,
      environmentId: policy.environment_id as string,
      amapiName: (policy.amapi_name as string | null) ?? null,
    };
  });

  // Store artifact to Blobs (best effort, outside transaction)
  try {
    await storeBlob(
      'policy-artifacts',
      `${policyId}/v${newVersion}.json`,
      configJson
    );
  } catch {
    // Blob storage failure is non-critical — the DB is the source of truth
  }

  // Best-effort AMAPI sync so component assignments/updates propagate to devices.
  // Failures are non-fatal here to preserve existing component workflows.
  try {
    const env = await queryOne<{ workspace_id: string; enterprise_name: string | null }>(
      'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
      [environmentId]
    );
    if (!env?.enterprise_name) return;

    const ws = await queryOne<{ gcp_project_id: string | null }>(
      'SELECT gcp_project_id FROM workspaces WHERE id = $1',
      [env.workspace_id]
    );
    if (!ws?.gcp_project_id) return;

    const nextCompiled = JSON.parse(configJson) as Record<string, unknown>;
    const previousGenerated = await buildGeneratedPolicyPayload({
      policyId,
      environmentId,
      baseConfig: previousCompiled ?? {},
    });
    const nextGenerated = await buildGeneratedPolicyPayload({
      policyId,
      environmentId,
      baseConfig: nextCompiled,
    });
    const policyName = amapiName ?? `${env.enterprise_name}/policies/${policyId}`;
    const updateMask = buildPolicyUpdateMask(previousGenerated.payload ?? {}, nextGenerated.payload);
    const policyPath = updateMask
      ? `${policyName}?updateMask=${encodeURIComponent(updateMask)}`
      : policyName;

    assertValidAmapiPolicyPayload(nextGenerated.payload);
    const result = await amapiCall<{ name?: string }>(
      policyPath,
      env.workspace_id,
      {
        method: 'PATCH',
        body: nextGenerated.payload,
        projectId: ws.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'policies',
        resourceId: policyId,
      }
    );

    await execute(
      `UPDATE policies
       SET amapi_name = COALESCE($1, amapi_name, $2),
           status = 'production',
           updated_at = now()
       WHERE id = $3`,
      [result.name ?? null, policyName, policyId]
    );

    await syncPolicyDerivativesForPolicy({
      policyId,
      environmentId,
      baseConfig: nextCompiled,
      amapiContext: {
        workspace_id: env.workspace_id,
        gcp_project_id: ws.gcp_project_id,
        enterprise_name: env.enterprise_name,
      },
    });
  } catch (err) {
    console.warn('recompilePolicy AMAPI sync skipped/failed', {
      policyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
