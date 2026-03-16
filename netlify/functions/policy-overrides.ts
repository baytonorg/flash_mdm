import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { getInheritedLocks, validateOverrideAgainstLocks, canSaveOverrides } from './_lib/policy-locks.js';
import {
  syncPolicyDerivativesForPolicy,
  getPolicyAmapiContext,
  listAffectedDevicesForPolicyContext,
  assignPolicyToDeviceWithDerivative,
} from './_lib/policy-derivatives.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';

/**
 * Policy Overrides API
 *
 * GET  /api/policies/overrides?policy_id=...&scope_type=group|device&scope_id=...
 *   → Returns override config + inherited lock state for a scope
 *
 * PUT  /api/policies/overrides
 *   → Save override config (validates against locks, triggers derivative regen)
 *
 * DELETE /api/policies/overrides?policy_id=...&scope_type=group|device&scope_id=...
 *   → Reset overrides (remove all overrides for a scope)
 *
 * GET /api/policies/overrides/locks?policy_id=...&scope_type=group|device&scope_id=...
 *   → Returns inherited lock state only
 */

type OverrideRow = {
  id: string;
  override_config: Record<string, unknown> | string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type PolicyRow = {
  config: Record<string, unknown> | string | null;
};

async function deriveEnvironmentId(scopeType: string, scopeId: string): Promise<string | null> {
  if (scopeType === 'group') {
    const group = await queryOne<{ environment_id: string }>(
      'SELECT environment_id FROM groups WHERE id = $1',
      [scopeId]
    );
    return group?.environment_id ?? null;
  }
  if (scopeType === 'device') {
    const device = await queryOne<{ environment_id: string }>(
      'SELECT environment_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [scopeId]
    );
    return device?.environment_id ?? null;
  }
  return null;
}

function parseJsonField<T>(value: T | string | null): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value;
}

function cloneConfig(value: Record<string, unknown> | null): Record<string, unknown> {
  return value ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : {};
}

async function getEffectiveBaseConfig(
  policyId: string,
  scopeType: 'group' | 'device',
  scopeId: string
): Promise<Record<string, unknown>> {
  const policy = await queryOne<PolicyRow>(
    'SELECT config FROM policies WHERE id = $1',
    [policyId]
  );

  const baseConfig = cloneConfig(parseJsonField<Record<string, unknown>>(policy?.config ?? null));
  let inheritedRows: Array<{ override_config: Record<string, unknown> | string | null }> = [];

  if (scopeType === 'group') {
    inheritedRows = await query<{ override_config: Record<string, unknown> | string | null }>(
      `SELECT gpo.override_config
       FROM group_closures gc
       JOIN group_policy_overrides gpo
         ON gpo.group_id = gc.ancestor_id
        AND gpo.policy_id = $2
       WHERE gc.descendant_id = $1
         AND gc.depth > 0
       ORDER BY gc.depth DESC`,
      [scopeId, policyId]
    );
  } else {
    const device = await queryOne<{ group_id: string | null }>(
      'SELECT group_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [scopeId]
    );
    if (!device?.group_id) return baseConfig;

    inheritedRows = await query<{ override_config: Record<string, unknown> | string | null }>(
      `SELECT gpo.override_config
       FROM group_closures gc
       JOIN group_policy_overrides gpo
         ON gpo.group_id = gc.ancestor_id
        AND gpo.policy_id = $2
       WHERE gc.descendant_id = $1
       ORDER BY gc.depth DESC`,
      [device.group_id, policyId]
    );
  }

  for (const row of inheritedRows) {
    const overrideConfig = parseJsonField<Record<string, unknown>>(row.override_config) ?? {};
    for (const [key, value] of Object.entries(overrideConfig)) {
      baseConfig[key] = value;
    }
  }

  return baseConfig;
}

export default async (request: Request, _context: Context) => {
  const auth = await requireAuth(request);
  const url = new URL(request.url);
  const pathSegments = url.pathname.replace('/api/policies/overrides', '').split('/').filter(Boolean);
  const subAction = pathSegments[0]; // 'locks' or undefined

  // ── GET /api/policies/overrides/locks ──────────────────────────────────
  if (request.method === 'GET' && subAction === 'locks') {
    const params = getSearchParams(request);
    const policyId = params.get('policy_id');
    const scopeType = params.get('scope_type') as 'group' | 'device' | null;
    const scopeId = params.get('scope_id');

    if (!policyId || !scopeType || !scopeId) {
      return errorResponse('policy_id, scope_type, and scope_id are required');
    }
    if (!['group', 'device'].includes(scopeType)) {
      return errorResponse('scope_type must be group or device');
    }

    const envId = await deriveEnvironmentId(scopeType, scopeId);
    if (!envId) return errorResponse('Scope target not found', 404);
    await requireEnvironmentResourcePermission(auth, envId, 'policy', 'read');

    const lockState = await getInheritedLocks(scopeType, scopeId, policyId, envId);
    return jsonResponse(lockState);
  }

  // ── GET /api/policies/overrides ────────────────────────────────────────
  if (request.method === 'GET' && !subAction) {
    const params = getSearchParams(request);
    const policyId = params.get('policy_id');
    const scopeType = params.get('scope_type') as 'group' | 'device' | null;
    const scopeId = params.get('scope_id');

    if (!policyId || !scopeType || !scopeId) {
      return errorResponse('policy_id, scope_type, and scope_id are required');
    }
    if (!['group', 'device'].includes(scopeType)) {
      return errorResponse('scope_type must be group or device');
    }

    const envId = await deriveEnvironmentId(scopeType, scopeId);
    if (!envId) return errorResponse('Scope target not found', 404);
    await requireEnvironmentResourcePermission(auth, envId, 'policy', 'read');

    const lockState = await getInheritedLocks(scopeType, scopeId, policyId, envId);

    let override: OverrideRow | null = null;
    if (scopeType === 'group') {
      override = await queryOne<OverrideRow>(
        'SELECT id, override_config, created_by, created_at, updated_at FROM group_policy_overrides WHERE group_id = $1 AND policy_id = $2',
        [scopeId, policyId]
      );
    } else {
      override = await queryOne<OverrideRow>(
        'SELECT id, override_config, created_by, created_at, updated_at FROM device_policy_overrides WHERE device_id = $1 AND policy_id = $2',
        [scopeId, policyId]
      );
    }
    const effectiveBaseConfig = await getEffectiveBaseConfig(policyId, scopeType, scopeId);

    return jsonResponse({
      override_config: parseJsonField(override?.override_config) ?? {},
      has_overrides: override !== null && Object.keys(parseJsonField(override.override_config) ?? {}).length > 0,
      created_by: override?.created_by ?? null,
      created_at: override?.created_at ?? null,
      updated_at: override?.updated_at ?? null,
      effective_base_config: effectiveBaseConfig,
      lock_state: lockState,
    });
  }

  // ── PUT /api/policies/overrides ────────────────────────────────────────
  if (request.method === 'PUT' && !subAction) {
    const body = await parseJsonBody<{
      policy_id: string;
      scope_type: 'group' | 'device';
      scope_id: string;
      override_config: Record<string, unknown>;
    }>(request);

    if (!body.policy_id || !body.scope_type || !body.scope_id || !body.override_config) {
      return errorResponse('policy_id, scope_type, scope_id, and override_config are required');
    }
    if (!['group', 'device'].includes(body.scope_type)) {
      return errorResponse('scope_type must be group or device');
    }

    // Validate policy exists
    const policy = await queryOne<{ id: string; environment_id: string; config: Record<string, unknown> | string | null }>(
      'SELECT id, environment_id, config FROM policies WHERE id = $1',
      [body.policy_id]
    );
    if (!policy) return errorResponse('Policy not found', 404);

    const envId = await deriveEnvironmentId(body.scope_type, body.scope_id);
    if (!envId) return errorResponse('Scope target not found', 404);

    // RBAC: check if user can save overrides at this scope
    // Group admins can override unlocked sections; env admins can override everything
    const overridePermission = await canSaveOverrides(auth, body.scope_type, body.scope_id, envId);
    if (!overridePermission.allowed) {
      return errorResponse(overridePermission.reason ?? 'Insufficient permissions to save overrides', 403);
    }

    // Cross-environment check
    if (policy.environment_id !== envId) {
      return errorResponse('Policy does not belong to this environment', 400);
    }

    // Validate against inherited locks
    // Environment admins can bypass locks; group admins cannot
    const lockState = await getInheritedLocks(body.scope_type, body.scope_id, body.policy_id, envId);
    if (!overridePermission.can_override_locked) {
      const lockError = validateOverrideAgainstLocks(body.override_config, lockState);
      if (lockError) {
        return errorResponse(lockError, 403);
      }
    }

    // Upsert override
    if (body.scope_type === 'group') {
      await execute(
        `INSERT INTO group_policy_overrides (group_id, policy_id, environment_id, override_config, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (group_id, policy_id)
         DO UPDATE SET
           override_config = $4::jsonb,
           updated_at = now()`,
        [body.scope_id, body.policy_id, envId, JSON.stringify(body.override_config), auth.user.id]
      );
    } else {
      await execute(
        `INSERT INTO device_policy_overrides (device_id, policy_id, environment_id, override_config, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (device_id, policy_id)
         DO UPDATE SET
           override_config = $4::jsonb,
           updated_at = now()`,
        [body.scope_id, body.policy_id, envId, JSON.stringify(body.override_config), auth.user.id]
      );
    }

    await logAudit({
      environment_id: envId,
      user_id: auth.user.id,
      action: 'policy.override_saved',
      resource_type: 'policy',
      resource_id: body.policy_id,
      details: {
        scope_type: body.scope_type,
        scope_id: body.scope_id,
        override_keys: Object.keys(body.override_config),
      },
      ip_address: getClientIp(request),
    });

    // Trigger derivative regeneration for the affected scope
    let derivativeSync: Record<string, unknown> = {};
    try {
      const amapiContext = await getPolicyAmapiContext(envId);
      if (amapiContext) {
        const rawConfig = typeof policy.config === 'string' ? JSON.parse(policy.config) : (policy.config ?? {});
        const { openNetworkConfiguration: _onc, deviceConnectivityManagement: _dcm, applications: _apps, ...cleanBase } = rawConfig as Record<string, unknown>;

        const syncResult = await syncPolicyDerivativesForPolicy({
          policyId: body.policy_id,
          environmentId: envId,
          baseConfig: cleanBase,
          amapiContext,
        });

        // Re-assign affected devices to their updated derivative
        let devicesSynced = 0;
        const affectedDevices = await listAffectedDevicesForPolicyContext(
          body.policy_id, envId, body.scope_type, body.scope_id
        );
        for (const device of affectedDevices) {
          try {
            await assignPolicyToDeviceWithDerivative({
              policyId: body.policy_id,
              environmentId: envId,
              deviceId: device.id,
              deviceAmapiName: device.amapi_name,
              amapiContext,
              baseConfig: cleanBase,
            });
            devicesSynced++;
          } catch (assignErr) {
            console.warn('policy-overrides: device re-assignment failed (non-fatal)', {
              policy_id: body.policy_id,
              device_id: device.id,
              error: assignErr instanceof Error ? assignErr.message : String(assignErr),
            });
          }
        }

        derivativeSync = { synced: true, derivatives: syncResult.derivatives.length, devices_synced: devicesSynced };
      } else {
        derivativeSync = { skipped: true, reason: 'No AMAPI context' };
      }
    } catch (err) {
      derivativeSync = { synced: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }

    return jsonResponse({
      message: 'Override saved',
      derivative_sync: derivativeSync,
    });
  }

  // ── DELETE /api/policies/overrides ──────────────────────────────────────
  if (request.method === 'DELETE' && !subAction) {
    const params = getSearchParams(request);
    const policyId = params.get('policy_id');
    const scopeType = params.get('scope_type') as 'group' | 'device' | null;
    const scopeId = params.get('scope_id');

    if (!policyId || !scopeType || !scopeId) {
      return errorResponse('policy_id, scope_type, and scope_id are required');
    }
    if (!['group', 'device'].includes(scopeType)) {
      return errorResponse('scope_type must be group or device');
    }

    const envId = await deriveEnvironmentId(scopeType, scopeId);
    if (!envId) return errorResponse('Scope target not found', 404);

    // RBAC: check if user can save overrides at this scope (resetting is also a write)
    const overridePermission = await canSaveOverrides(auth, scopeType, scopeId, envId);
    if (!overridePermission.allowed) {
      return errorResponse(overridePermission.reason ?? 'Insufficient permissions to reset overrides', 403);
    }

    let deleted = false;
    if (scopeType === 'group') {
      const result = await execute(
        'DELETE FROM group_policy_overrides WHERE group_id = $1 AND policy_id = $2',
        [scopeId, policyId]
      );
      deleted = (result.rowCount ?? 0) > 0;
    } else {
      const result = await execute(
        'DELETE FROM device_policy_overrides WHERE device_id = $1 AND policy_id = $2',
        [scopeId, policyId]
      );
      deleted = (result.rowCount ?? 0) > 0;
    }

    if (!deleted) {
      return jsonResponse({ message: 'No overrides to reset' });
    }

    await logAudit({
      environment_id: envId,
      user_id: auth.user.id,
      action: 'policy.override_reset',
      resource_type: 'policy',
      resource_id: policyId,
      details: { scope_type: scopeType, scope_id: scopeId },
      ip_address: getClientIp(request),
    });

    // Trigger derivative regeneration
    let derivativeSync: Record<string, unknown> = {};
    try {
      const policy = await queryOne<{ config: Record<string, unknown> | string | null }>(
        'SELECT config FROM policies WHERE id = $1',
        [policyId]
      );
      const amapiContext = await getPolicyAmapiContext(envId);
      if (amapiContext && policy) {
        const rawConfig = typeof policy.config === 'string' ? JSON.parse(policy.config) : (policy.config ?? {});
        const { openNetworkConfiguration: _onc, deviceConnectivityManagement: _dcm, applications: _apps, ...cleanBase } = rawConfig as Record<string, unknown>;

        const syncResult = await syncPolicyDerivativesForPolicy({
          policyId,
          environmentId: envId,
          baseConfig: cleanBase,
          amapiContext,
        });

        // Re-assign affected devices to their updated derivative
        let devicesSynced = 0;
        const affectedDevices = await listAffectedDevicesForPolicyContext(
          policyId, envId, scopeType, scopeId
        );
        for (const device of affectedDevices) {
          try {
            await assignPolicyToDeviceWithDerivative({
              policyId,
              environmentId: envId,
              deviceId: device.id,
              deviceAmapiName: device.amapi_name,
              amapiContext,
              baseConfig: cleanBase,
            });
            devicesSynced++;
          } catch (assignErr) {
            console.warn('policy-overrides: device re-assignment on reset failed (non-fatal)', {
              policy_id: policyId,
              device_id: device.id,
              error: assignErr instanceof Error ? assignErr.message : String(assignErr),
            });
          }
        }

        derivativeSync = { synced: true, derivatives: syncResult.derivatives.length, devices_synced: devicesSynced };
      }
    } catch (err) {
      derivativeSync = { synced: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }

    return jsonResponse({
      message: 'Overrides reset',
      derivative_sync: derivativeSync,
    });
  }

  return errorResponse('Not found', 404);
};
