import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  requireEnvironmentAccessScopeForResourcePermission,
  requireEnvironmentResourcePermission,
  requireGroupPermission,
} from './_lib/rbac.js';
import { canModifyLocks } from './_lib/policy-locks.js';
import { logAudit } from './_lib/audit.js';
import {
  assignPolicyToDeviceWithDerivative,
  syncPolicyDerivativesForPolicy,
  getPolicyAmapiContext,
  ensurePolicyDerivativeForScope,
  listAffectedDevicesForPolicyContext,
} from './_lib/policy-derivatives.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';

/**
 * Derive the environment_id from a scope target.
 */
async function deriveEnvironmentId(
  scopeType: string,
  scopeId: string
): Promise<string | null> {
  if (scopeType === 'environment') {
    const env = await queryOne<{ id: string }>(
      'SELECT id FROM environments WHERE id = $1',
      [scopeId]
    );
    return env?.id ?? null;
  }
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

/**
 * Resolve a human-readable name for a scope target.
 */
async function resolveScopeName(scopeType: string, scopeId: string): Promise<string | null> {
  if (scopeType === 'environment') {
    const row = await queryOne<{ name: string }>(
      'SELECT name FROM environments WHERE id = $1',
      [scopeId]
    );
    return row?.name ?? null;
  }
  if (scopeType === 'group') {
    const row = await queryOne<{ name: string }>(
      'SELECT name FROM groups WHERE id = $1',
      [scopeId]
    );
    return row?.name ?? null;
  }
  if (scopeType === 'device') {
    const row = await queryOne<{ serial_number: string | null; amapi_name: string }>(
      'SELECT serial_number, amapi_name FROM devices WHERE id = $1',
      [scopeId]
    );
    return row?.serial_number ?? row?.amapi_name ?? null;
  }
  return null;
}

/**
 * Find the effective policy for a device using the standard cascade:
 * device assignment → group hierarchy → environment assignment → legacy fallback.
 */
async function findEffectivePolicyForDevice(
  deviceId: string,
  environmentId: string
): Promise<{ policy_id: string } | null> {
  // 1. Direct device assignment
  const deviceAssignment = await queryOne<{ policy_id: string }>(
    "SELECT policy_id FROM policy_assignments WHERE scope_type = 'device' AND scope_id = $1",
    [deviceId]
  );
  if (deviceAssignment) return deviceAssignment;

  // 2. Group hierarchy (nearest ancestor first)
  const device = await queryOne<{ group_id: string | null; policy_id: string | null }>(
    'SELECT group_id, policy_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
    [deviceId]
  );
  if (device?.group_id) {
    const groupAssignment = await queryOne<{ policy_id: string }>(
      `SELECT pa.policy_id
       FROM group_closures gc
       JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
       WHERE gc.descendant_id = $1
       ORDER BY gc.depth ASC
       LIMIT 1`,
      [device.group_id]
    );
    if (groupAssignment) return groupAssignment;
  }

  // 3. Environment assignment
  const envAssignment = await queryOne<{ policy_id: string }>(
    "SELECT policy_id FROM policy_assignments WHERE scope_type = 'environment' AND scope_id = $1",
    [environmentId]
  );
  if (envAssignment) return envAssignment;

  // 4. Legacy fallback
  if (device?.policy_id) return { policy_id: device.policy_id };

  return null;
}

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/policies/', '').split('/').filter(Boolean);
    const action = segments[0];

  // POST /api/policies/assign
  if (request.method === 'POST' && action === 'assign') {
    const body = await parseJsonBody<{
      policy_id: string;
      scope_type: 'environment' | 'group' | 'device';
      scope_id: string;
      locked?: boolean;
      locked_sections?: string[];
    }>(request);

    if (!body.policy_id || !body.scope_type || !body.scope_id) {
      return errorResponse('policy_id, scope_type, and scope_id are required');
    }

    if (!['environment', 'group', 'device'].includes(body.scope_type)) {
      return errorResponse('scope_type must be environment, group, or device');
    }

    // Validate policy exists
    const policy = await queryOne<{ id: string; name: string; environment_id: string }>(
      'SELECT id, name, environment_id FROM policies WHERE id = $1',
      [body.policy_id]
    );
    if (!policy) return errorResponse('Policy not found', 404);

    // Validate scope target exists and derive environment_id
    const envId = await deriveEnvironmentId(body.scope_type, body.scope_id);
    if (!envId) return errorResponse('Scope target not found', 404);

    // RBAC check — env admins can assign at any scope, group admins within their subtree
    if (body.scope_type === 'group') {
      try {
        await requireEnvironmentResourcePermission(auth, envId, 'policy', 'write');
      } catch {
        // Fall back to group-level admin check
        await requireGroupPermission(auth, body.scope_id, 'write');
      }
    } else if (body.scope_type === 'device') {
      try {
        await requireEnvironmentResourcePermission(auth, envId, 'policy', 'write');
      } catch {
        // Fall back — get device's group and check group permission
        const device = await queryOne<{ group_id: string | null }>(
          'SELECT group_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
          [body.scope_id]
        );
        if (device?.group_id) {
          await requireGroupPermission(auth, device.group_id, 'write');
        } else {
          await requireEnvironmentResourcePermission(auth, envId, 'policy', 'write');
        }
      }
    } else {
      // Environment-level assignment requires env admin
      await requireEnvironmentResourcePermission(auth, envId, 'policy', 'write');
    }

    // Prevent cross-environment assignment
    if (policy.environment_id !== envId) {
      return errorResponse('Policy does not belong to this environment', 400);
    }

    // RBAC: Determine if user can modify locks at this scope
    let locked = body.locked ?? false;
    let lockedSections = body.locked_sections ?? [];
    const wantsToSetLocks = locked || lockedSections.length > 0;
    const hasLockPermission = (await canModifyLocks(auth, body.scope_type, body.scope_id, envId)).allowed;

    if (wantsToSetLocks && !hasLockPermission) {
      return errorResponse('Insufficient permissions to set locks. Only environment admins or group admins at this scope can set locks.', 403);
    }

    // If user doesn't have lock permission and existing assignment has locks,
    // preserve the existing lock state (allows policy reassignment without clearing locks)
    if (!hasLockPermission) {
      const existingAssignment = await queryOne<{ locked: boolean; locked_sections: string[] | null }>(
        'SELECT locked, locked_sections FROM policy_assignments WHERE scope_type = $1 AND scope_id = $2',
        [body.scope_type, body.scope_id]
      );
      if (existingAssignment) {
        locked = existingAssignment.locked;
        lockedSections = existingAssignment.locked_sections ?? [];
      }
    }
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO policy_assignments (policy_id, scope_type, scope_id, locked, locked_sections, locked_by, locked_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 OR array_length($5::text[], 1) > 0 THEN now() ELSE NULL END)
         ON CONFLICT (scope_type, scope_id) DO UPDATE
           SET policy_id = EXCLUDED.policy_id,
               locked = EXCLUDED.locked,
               locked_sections = EXCLUDED.locked_sections,
               locked_by = EXCLUDED.locked_by,
               locked_at = EXCLUDED.locked_at,
               created_at = now()`,
        [body.policy_id, body.scope_type, body.scope_id, locked, lockedSections, auth.user.id]
      );

      // If scope_type is device, also update devices.policy_id
      if (body.scope_type === 'device') {
        await client.query(
          'UPDATE devices SET policy_id = $1, updated_at = now() WHERE id = $2',
          [body.policy_id, body.scope_id]
        );
      }
    });

    await logAudit({
      environment_id: envId,
      user_id: auth.user.id,
      action: 'policy.assigned',
      resource_type: 'policy',
      resource_id: body.policy_id,
      details: { scope_type: body.scope_type, scope_id: body.scope_id },
      ip_address: getClientIp(request),
    });

    // ── AMAPI derivative sync for all scope types ──────────────────────────
    let amapiSync: Record<string, unknown> = {};
    try {
      const amapiContext = await getPolicyAmapiContext(envId);
      if (!amapiContext) {
        amapiSync = { skipped: true, reason: 'Environment is not bound to an enterprise or workspace GCP project is not configured' };
      } else {
        // Fetch and strip the policy base config (deployment-managed fields are re-applied by the generator)
        const policyRow = await queryOne<{ config: Record<string, unknown> | string | null }>(
          'SELECT config FROM policies WHERE id = $1',
          [body.policy_id]
        );
        const rawConfig = typeof policyRow?.config === 'string'
          ? JSON.parse(policyRow.config)
          : (policyRow?.config ?? {});
        const { openNetworkConfiguration: _onc, deviceConnectivityManagement: _dcm, applications: _apps, ...cleanBase } = rawConfig as Record<string, unknown>;

        // For group/device scope: ensure a scope-specific derivative exists
        if (body.scope_type !== 'environment') {
          await ensurePolicyDerivativeForScope({
            policyId: body.policy_id,
            environmentId: envId,
            scopeType: body.scope_type,
            scopeId: body.scope_id,
            amapiContext,
          });
        }

        // Sync all derivatives for this policy (regenerates AMAPI payloads)
        await syncPolicyDerivativesForPolicy({
          policyId: body.policy_id,
          environmentId: envId,
          baseConfig: cleanBase,
          amapiContext,
        });

        // Assign affected devices to their derivative policies in AMAPI
        const devices = await listAffectedDevicesForPolicyContext(
          body.policy_id, envId, body.scope_type, body.scope_id
        );
        let devicesSynced = 0;
        const deviceFailures: string[] = [];
        for (const device of devices) {
          try {
            await assignPolicyToDeviceWithDerivative({
              policyId: body.policy_id,
              environmentId: envId,
              deviceId: device.id,
              deviceAmapiName: device.amapi_name,
              amapiContext,
              baseConfig: cleanBase,
            });
            devicesSynced += 1;
          } catch (err) {
            deviceFailures.push(device.id);
            console.warn('policy-assign: device derivative assignment failed (non-fatal)', {
              policy_id: body.policy_id,
              device_id: device.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        amapiSync = { synced: true, devices_synced: devicesSynced, device_failures: deviceFailures };
      }
    } catch (err) {
      amapiSync = { synced: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }

    if (amapiSync.synced === false) {
      return jsonResponse({
        message: 'Policy assigned locally but AMAPI sync failed',
        amapi_sync: amapiSync,
      });
    }

    return jsonResponse({
      message: 'Policy assigned',
      amapi_sync: amapiSync,
    });
  }

  // POST /api/policies/unassign
  if (request.method === 'POST' && action === 'unassign') {
    const body = await parseJsonBody<{
      scope_type: 'environment' | 'group' | 'device';
      scope_id: string;
    }>(request);

    if (!body.scope_type || !body.scope_id) {
      return errorResponse('scope_type and scope_id are required');
    }

    if (!['environment', 'group', 'device'].includes(body.scope_type)) {
      return errorResponse('scope_type must be environment, group, or device');
    }

    // Derive environment_id for RBAC
    const envId = await deriveEnvironmentId(body.scope_type, body.scope_id);
    if (!envId) return errorResponse('Scope target not found', 404);

    await requireEnvironmentResourcePermission(auth, envId, 'policy', 'write');

    // Look up old assignment before deleting
    const oldAssignment = await queryOne<{ policy_id: string }>(
      'SELECT policy_id FROM policy_assignments WHERE scope_type = $1 AND scope_id = $2',
      [body.scope_type, body.scope_id]
    );

    // Capture affected devices BEFORE deleting the assignment (M6 fix).
    // After the delete, the assignment row is gone so the cascade query finds nothing.
    let affectedDevicesSnapshot: Array<{ id: string; amapi_name: string }> = [];
    let deleted = false;

    await transaction(async (client) => {
      if (oldAssignment) {
        if (body.scope_type === 'device') {
          const d = await client.query(
            'SELECT id, amapi_name FROM devices WHERE id = $1 AND deleted_at IS NULL',
            [body.scope_id]
          );
          affectedDevicesSnapshot = d.rows as Array<{ id: string; amapi_name: string }>;
        } else if (body.scope_type === 'group') {
          const d = await client.query(
            `SELECT DISTINCT d.id, d.amapi_name FROM devices d
             JOIN group_closures gc ON gc.descendant_id = d.group_id AND gc.ancestor_id = $1
             WHERE d.environment_id = $2 AND d.deleted_at IS NULL`,
            [body.scope_id, envId]
          );
          affectedDevicesSnapshot = d.rows as Array<{ id: string; amapi_name: string }>;
        } else {
          // environment scope — all devices in environment
          const d = await client.query(
            'SELECT id, amapi_name FROM devices WHERE environment_id = $1 AND deleted_at IS NULL',
            [envId]
          );
          affectedDevicesSnapshot = d.rows as Array<{ id: string; amapi_name: string }>;
        }
      }

      const result = await client.query(
        'DELETE FROM policy_assignments WHERE scope_type = $1 AND scope_id = $2',
        [body.scope_type, body.scope_id]
      );
      deleted = (result.rowCount ?? 0) > 0;

      // If scope_type is device, clear devices.policy_id
      if (deleted && body.scope_type === 'device') {
        await client.query(
          'UPDATE devices SET policy_id = NULL, updated_at = now() WHERE id = $1',
          [body.scope_id]
        );
      }
    });

    if (!deleted) {
      return errorResponse('Assignment not found', 404);
    }

    await logAudit({
      environment_id: envId,
      user_id: auth.user.id,
      action: 'policy.unassigned',
      resource_type: 'policy_assignment',
      resource_id: body.scope_id,
      details: { scope_type: body.scope_type, scope_id: body.scope_id, old_policy_id: oldAssignment?.policy_id },
      ip_address: getClientIp(request),
    });

    // ── Post-unassignment: re-sync affected devices to their new effective policy ──
    let amapiSync: Record<string, unknown> = {};
    if (oldAssignment) {
      try {
        const amapiContext = await getPolicyAmapiContext(envId);
        if (!amapiContext) {
          amapiSync = { skipped: true, reason: 'No AMAPI context' };
        } else {
          // Use pre-captured device list (captured before assignment was deleted)
          let devicesSynced = 0;
          const deviceFailures: string[] = [];

          for (const device of affectedDevicesSnapshot) {
            try {
              // Resolve the device's NEW effective policy after unassignment
              const newPolicy = await findEffectivePolicyForDevice(device.id, envId);
              if (newPolicy) {
                // Fetch and strip base config
                const policyRow = await queryOne<{ config: Record<string, unknown> | string | null }>(
                  'SELECT config FROM policies WHERE id = $1',
                  [newPolicy.policy_id]
                );
                const rawConfig = typeof policyRow?.config === 'string'
                  ? JSON.parse(policyRow.config)
                  : (policyRow?.config ?? {});
                const { openNetworkConfiguration: _onc, deviceConnectivityManagement: _dcm, applications: _apps, ...cleanBase } = rawConfig as Record<string, unknown>;

                await assignPolicyToDeviceWithDerivative({
                  policyId: newPolicy.policy_id,
                  environmentId: envId,
                  deviceId: device.id,
                  deviceAmapiName: device.amapi_name,
                  amapiContext,
                  baseConfig: cleanBase,
                });
              }
              devicesSynced += 1;
            } catch (err) {
              deviceFailures.push(device.id);
              console.warn('policy-unassign: device re-sync failed (non-fatal)', {
                device_id: device.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // Clean up orphaned derivative for the removed scope
          try {
            await execute(
              'DELETE FROM policy_derivatives WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3',
              [oldAssignment.policy_id, body.scope_type, body.scope_id]
            );
          } catch (err) {
            console.warn('policy-unassign: derivative cleanup failed (non-fatal)', {
              policy_id: oldAssignment.policy_id,
              scope_type: body.scope_type,
              scope_id: body.scope_id,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          amapiSync = { synced: true, devices_synced: devicesSynced, device_failures: deviceFailures };
        }
      } catch (err) {
        amapiSync = { synced: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }

    return jsonResponse({ message: 'Policy unassigned', amapi_sync: amapiSync });
  }

  // GET /api/policies/assignments?environment_id=...
  if (request.method === 'GET' && action === 'assignments') {
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');

    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, environmentId, 'policy', 'read');
    const assignments = envScope.mode === 'group'
      ? await query<{
          id: string;
          policy_id: string;
          policy_name: string;
          scope_type: string;
          scope_id: string;
          locked: boolean;
          locked_sections: string[] | null;
          created_at: string;
        }>(
          `SELECT DISTINCT pa.id, pa.policy_id, p.name as policy_name,
                  pa.scope_type, pa.scope_id, pa.locked, pa.locked_sections, pa.created_at
           FROM policy_assignments pa
           JOIN policies p ON p.id = pa.policy_id
           LEFT JOIN groups g_assigned
             ON pa.scope_type = 'group' AND g_assigned.id = pa.scope_id
           LEFT JOIN group_closures gc
             ON pa.scope_type = 'group' AND gc.ancestor_id = pa.scope_id
           LEFT JOIN devices d_scope
             ON pa.scope_type = 'device' AND d_scope.id = pa.scope_id AND d_scope.deleted_at IS NULL
           WHERE p.environment_id = $1
             AND (
               (pa.scope_type = 'environment' AND pa.scope_id = $1::uuid)
               OR (
                 pa.scope_type = 'group'
                 AND g_assigned.environment_id = $1
                 AND gc.descendant_id = ANY($2::uuid[])
               )
               OR (
                 pa.scope_type = 'device'
                 AND d_scope.environment_id = $1
                 AND d_scope.group_id = ANY($2::uuid[])
               )
             )
           ORDER BY pa.scope_type, pa.created_at`,
          [environmentId, envScope.accessible_group_ids ?? []]
        )
      : await query<{
          id: string;
          policy_id: string;
          policy_name: string;
          scope_type: string;
          scope_id: string;
          locked: boolean;
          locked_sections: string[] | null;
          created_at: string;
        }>(
          `SELECT pa.id, pa.policy_id, p.name as policy_name,
                  pa.scope_type, pa.scope_id, pa.locked, pa.locked_sections, pa.created_at
           FROM policy_assignments pa
           JOIN policies p ON p.id = pa.policy_id
           WHERE p.environment_id = $1
           ORDER BY pa.scope_type, pa.created_at`,
          [environmentId]
        );

    // Resolve scope names
    const enriched = await Promise.all(
      assignments.map(async (a) => ({
        ...a,
        scope_name: await resolveScopeName(a.scope_type, a.scope_id),
      }))
    );

    return jsonResponse({ assignments: enriched });
  }

  // GET /api/policies/effective?device_id=...
  if (request.method === 'GET' && action === 'effective') {
    const params = getSearchParams(request);
    const deviceId = params.get('device_id');
    if (!deviceId) return errorResponse('device_id is required');

    const device = await queryOne<{
      id: string;
      environment_id: string;
      group_id: string | null;
      policy_id: string | null;
    }>(
      'SELECT id, environment_id, group_id, policy_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [deviceId]
    );
    if (!device) return errorResponse('Device not found', 404);

    try {
      await requireEnvironmentResourcePermission(auth, device.environment_id, 'policy', 'read');
    } catch (err) {
      if (!(err instanceof Response)) throw err;
      if (device.group_id) {
        await requireGroupPermission(auth, device.group_id, 'read');
      } else {
        throw err;
      }
    }

    // 1. Check direct device assignment in policy_assignments
    const deviceAssignment = await queryOne<{ policy_id: string }>(
      "SELECT policy_id FROM policy_assignments WHERE scope_type = 'device' AND scope_id = $1",
      [deviceId]
    );
    if (deviceAssignment) {
      const policy = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM policies WHERE id = $1',
        [deviceAssignment.policy_id]
      );
      if (policy) {
        return jsonResponse({
          policy_id: policy.id,
          policy_name: policy.name,
          source: 'device',
          source_id: deviceId,
          source_name: await resolveScopeName('device', deviceId),
        });
      }
    }

    // 2. Walk up group hierarchy via group_closures
    if (device.group_id) {
      const groupAssignment = await queryOne<{
        policy_id: string;
        ancestor_id: string;
      }>(
        `SELECT pa.policy_id, gc.ancestor_id
         FROM group_closures gc
         JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
         WHERE gc.descendant_id = $1
         ORDER BY gc.depth ASC
         LIMIT 1`,
        [device.group_id]
      );
      if (groupAssignment) {
        const policy = await queryOne<{ id: string; name: string }>(
          'SELECT id, name FROM policies WHERE id = $1',
          [groupAssignment.policy_id]
        );
        if (policy) {
          return jsonResponse({
            policy_id: policy.id,
            policy_name: policy.name,
            source: 'group',
            source_id: groupAssignment.ancestor_id,
            source_name: await resolveScopeName('group', groupAssignment.ancestor_id),
          });
        }
      }
    }

    // 3. Check environment-level assignment
    const envAssignment = await queryOne<{ policy_id: string }>(
      "SELECT policy_id FROM policy_assignments WHERE scope_type = 'environment' AND scope_id = $1",
      [device.environment_id]
    );
    if (envAssignment) {
      const policy = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM policies WHERE id = $1',
        [envAssignment.policy_id]
      );
      if (policy) {
        return jsonResponse({
          policy_id: policy.id,
          policy_name: policy.name,
          source: 'environment',
          source_id: device.environment_id,
          source_name: await resolveScopeName('environment', device.environment_id),
        });
      }
    }

    // 4. Legacy fallback — check devices.policy_id (last resort)
    if (device.policy_id) {
      const policy = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM policies WHERE id = $1',
        [device.policy_id]
      );
      if (policy) {
        return jsonResponse({
          policy_id: policy.id,
          policy_name: policy.name,
          source: 'device_legacy',
          source_id: deviceId,
          source_name: await resolveScopeName('device', deviceId),
        });
      }
    }

    // 5. No policy found
    return jsonResponse({
      policy_id: null,
      policy_name: null,
      source: null,
      source_id: null,
      source_name: null,
    });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
};
