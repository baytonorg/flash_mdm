import { queryOne } from './db.js';
import { getAmapiErrorHttpStatus } from './amapi.js';
import {
  ensurePolicyDerivativeForScope,
  syncPolicyDerivativesForPolicy,
  getPolicyAmapiContext,
  assignPolicyToDeviceWithDerivative,
  listAffectedDevicesForPolicyContext,
} from './policy-derivatives.js';

type PolicyScopeType = 'environment' | 'group' | 'device';

/**
 * Sync affected AMAPI policy derivatives after a deployment change.
 *
 * For each affected policy:
 *  1. Ensure a scope-specific derivative exists (group/device only)
 *  2. Re-sync all derivatives (regenerates payloads from deployment tables)
 *  3. Re-assign all affected devices to their updated derivative
 */
export async function syncAffectedPoliciesToAmapi(
  affectedPolicyIds: string[],
  environmentId: string,
  scopeType: PolicyScopeType,
  scopeId: string,
) {
  const failures: Array<{ policy_id: string; error: string; amapi_status: number | null }> = [];
  let synced = 0;
  let skippedReason: string | null = null;

  if (affectedPolicyIds.length === 0) {
    return { attempted: 0, synced: 0, failed: 0, skipped_reason: null, failures: [] };
  }

  const amapiContext = await getPolicyAmapiContext(environmentId);
  if (!amapiContext) {
    skippedReason = 'Environment is not bound to an enterprise or workspace GCP project is not configured';
  } else {
    for (const policyId of affectedPolicyIds) {
      try {
        // For group/device scope: create/update scope-specific policy derivative
        if (scopeType !== 'environment') {
          await ensurePolicyDerivativeForScope({
            policyId,
            environmentId,
            scopeType,
            scopeId,
            amapiContext,
          });
        }

        // Sync all derivatives (environment + any other assignment contexts).
        const policy = await queryOne<{ config: Record<string, unknown> | string | null }>(
          'SELECT config FROM policies WHERE id = $1',
          [policyId]
        );
        const baseConfig = typeof policy?.config === 'string'
          ? JSON.parse(policy.config)
          : (policy?.config ?? {});
        // Strip deployment-managed fields — generator re-applies from DB
        const { openNetworkConfiguration: _onc, deviceConnectivityManagement: _dcm, applications: _apps, ...cleanBase } = baseConfig as Record<string, unknown>;

        await syncPolicyDerivativesForPolicy({
          policyId,
          environmentId,
          baseConfig: cleanBase,
          amapiContext,
        });

        // Re-assign ALL affected devices to their updated derivative (not just device-scoped)
        const affectedDevices = await listAffectedDevicesForPolicyContext(
          policyId, environmentId, scopeType, scopeId
        );
        for (const device of affectedDevices) {
          try {
            await assignPolicyToDeviceWithDerivative({
              policyId,
              environmentId,
              deviceId: device.id,
              deviceAmapiName: device.amapi_name,
              amapiContext,
              baseConfig: cleanBase,
            });
          } catch (assignErr) {
            console.warn('deployment-sync: device assignment failed (non-fatal)', {
              policy_id: policyId,
              device_id: device.id,
              error: assignErr instanceof Error ? assignErr.message : String(assignErr),
            });
          }
        }

        synced += 1;
      } catch (err) {
        failures.push({
          policy_id: policyId,
          error: err instanceof Error ? err.message : String(err),
          amapi_status: getAmapiErrorHttpStatus(err),
        });
      }
    }
  }

  return {
    attempted: affectedPolicyIds.length,
    synced,
    failed: failures.length,
    skipped_reason: skippedReason,
    failures,
  };
}

/**
 * Find the base policies affected by a deployment at a given scope.
 *
 * For environment scope: returns ALL policies in the environment.
 * For device/group scope: resolves each device's effective policy via
 *   device assignment → group assignment → environment assignment → legacy fallback.
 */
export async function selectPoliciesForDeploymentScope(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  environmentId: string,
  scopeType: string,
  scopeId: string
) {
  if (scopeType === 'environment') {
    return client.query(
      'SELECT id, config, amapi_name FROM policies WHERE environment_id = $1',
      [environmentId]
    );
  }

  if (scopeType === 'device') {
    return client.query(
      `SELECT DISTINCT p.id, p.config, p.amapi_name
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
       JOIN policies p ON p.id = COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id)
       WHERE d.id = $1 AND d.environment_id = $2 AND d.deleted_at IS NULL`,
      [scopeId, environmentId]
    );
  }

  // group scope
  return client.query(
    `SELECT DISTINCT p.id, p.config, p.amapi_name
     FROM devices d
     JOIN group_closures scope_gc
       ON scope_gc.descendant_id = d.group_id
      AND scope_gc.ancestor_id = $2
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
     JOIN policies p ON p.id = COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id)
     WHERE d.environment_id = $1
       AND d.deleted_at IS NULL`,
    [environmentId, scopeId]
  );
}
