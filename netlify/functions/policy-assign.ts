import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth, type AuthContext } from './_lib/auth.js';
import type { PoolClient } from 'pg';
import {
  requireEnvironmentAccessScopeForResourcePermission,
  requireEnvironmentResourcePermission,
  requireGroupPermission,
} from './_lib/rbac.js';
import { requirePolicyAssignmentAuthority, withPolicyAssignmentDeniedAudit } from './_lib/policy-assignment-authority.js';
import { logAudit } from './_lib/audit.js';
import {
  assignPolicyToDeviceWithDerivative,
  syncPolicyDerivativesForPolicy,
  getPolicyAmapiContext,
  ensurePolicyDerivativeForScope,
  listAffectedDevicesForPolicyContext,
} from './_lib/policy-derivatives.js';
import { deletePolicyDerivativeWhenUnused } from './_lib/policy-derivative-cleanup.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';
import { preparePolicyBaseForDerivativeGeneration } from './_lib/policy-merge.js';

async function assignmentTransaction<T>(auth: AuthContext, request: Request, scopeType: string, operation: string, fn: (client: PoolClient) => Promise<T>) {
  return withPolicyAssignmentDeniedAudit(auth,scopeType,operation,()=>transaction(fn));
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

  // Lock editing cannot change assignment intent. Compare the version the UI
  // displayed so a stale panel cannot relock a replaced or recreated assignment.
  if (request.method === 'POST' && action === 'locks') {
    const body = await parseJsonBody<{ policy_id: string; scope_type: 'environment' | 'group' | 'device'; scope_id: string; expected_version: string; locked: boolean; locked_sections: string[] }>(request);
    if (!body.policy_id || !body.scope_id || !['environment', 'group', 'device'].includes(body.scope_type)
      || typeof body.expected_version !== 'string' || !/^[a-f0-9]{32}$/.test(body.expected_version)
      || typeof body.locked !== 'boolean' || !Array.isArray(body.locked_sections) || body.locked_sections.some(s => typeof s !== 'string')) return errorResponse('A current assignment, lock values and version are required. Refresh and try again.');
    const envId = await assignmentTransaction(auth, request, body.scope_type, 'locks', async client => {
      const authority = await requirePolicyAssignmentAuthority(client, auth, body, 'locks');
      const current = (await client.query('SELECT policy_id, md5(row_to_json(pa)::text) AS assignment_version FROM policy_assignments pa WHERE scope_type=$1 AND scope_id=$2 FOR UPDATE', [body.scope_type, body.scope_id])).rows[0];
      if (!current || current.policy_id !== body.policy_id || current.assignment_version !== body.expected_version) throw errorResponse('The assignment changed. Refresh before updating its locks.', 409);
      await client.query(`UPDATE policy_assignments SET locked=$3, locked_sections=$4, locked_by=$5,
        locked_at=CASE WHEN $3 OR cardinality($4::text[])>0 THEN now() ELSE NULL END, created_at=clock_timestamp()
        WHERE scope_type=$1 AND scope_id=$2`, [body.scope_type, body.scope_id, body.locked, body.locked_sections, auth.user.id]);
      await logAudit({ environment_id: authority.environmentId, user_id: auth.user.id, action: 'policy.locks_updated', resource_type: 'policy_assignment', resource_id: body.scope_id, details: { scope_type: body.scope_type }, ip_address: getClientIp(request) },client);
      return authority.environmentId;
    });
    // Locks participate in effective composition. Preserve the previous lock
    // save propagation without routing the request through reassignment.
    let amapiSync: Record<string, unknown> = { skipped: true, reason: 'No AMAPI context' };
    try {
      const amapiContext = await getPolicyAmapiContext(envId);
      if (amapiContext) {
        const row = await queryOne<{ config: Record<string, unknown> | string | null }>('SELECT config FROM policies WHERE id=$1 AND environment_id=$2', [body.policy_id, envId]);
        const baseConfig = preparePolicyBaseForDerivativeGeneration(typeof row?.config === 'string' ? JSON.parse(row.config) : row?.config ?? {});
        await syncPolicyDerivativesForPolicy({policyId:body.policy_id,environmentId:envId,baseConfig,amapiContext});
        const devices = await listAffectedDevicesForPolicyContext(body.policy_id,envId,body.scope_type,body.scope_id);
        const failures: string[] = [];
        for (const device of devices) {
          try { await assignPolicyToDeviceWithDerivative({policyId:body.policy_id,environmentId:envId,deviceId:device.id,deviceAmapiName:device.amapi_name,amapiContext,baseConfig}); }
          catch { failures.push(device.id); }
        }
        amapiSync = {synced:failures.length===0,devices_synced:devices.length-failures.length,device_failures:failures};
      }
    } catch { amapiSync = {synced:false,error:'Policy locks saved locally; device synchronisation needs retry'}; }
    return jsonResponse({ message: amapiSync.synced === false ? 'Policy locks saved locally but device sync is incomplete' : 'Policy locks updated', amapi_sync:amapiSync });
  }

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
    if(typeof body.policy_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.policy_id))return errorResponse('A valid policy identifier is required',400);
    if((body.locked!==undefined&&typeof body.locked!=='boolean')||(body.locked_sections!==undefined&&(!Array.isArray(body.locked_sections)||body.locked_sections.some(section=>typeof section!=='string'))))return errorResponse('Invalid policy lock values',400);
    if(body.locked!==undefined||body.locked_sections!==undefined)return errorResponse('Lock settings now require a current assignment version. Refresh the page and use Lock Settings.',409);

    if (!['environment', 'group', 'device'].includes(body.scope_type)) {
      return errorResponse('scope_type must be environment, group, or device');
    }

    const envId = await assignmentTransaction(auth, request, body.scope_type, 'assign', async (client) => {
      const { environmentId } = await requirePolicyAssignmentAuthority(client, auth, body);
      const policy = (await client.query('SELECT id FROM policies WHERE id=$1 AND environment_id=$2 FOR SHARE', [body.policy_id, environmentId])).rows[0];
      if (!policy) throw errorResponse('Policy not found', 404);
      // Omission means preserve. Reassignment must not attribute existing locks
      // to a different actor or silently clear them.
      await client.query(
        `INSERT INTO policy_assignments (policy_id, scope_type, scope_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (scope_type, scope_id) DO UPDATE
           SET policy_id = EXCLUDED.policy_id,
               created_at = now()`,
        [body.policy_id, body.scope_type, body.scope_id]
      );

      // If scope_type is device, also update devices.policy_id
      if (body.scope_type === 'device') {
        await client.query(
          'UPDATE devices SET policy_id = $1, updated_at = now() WHERE id = $2',
          [body.policy_id, body.scope_id]
        );
      }
      await logAudit({environment_id:environmentId,user_id:auth.user.id,action:'policy.assigned',resource_type:'policy',resource_id:body.policy_id,details:{scope_type:body.scope_type,scope_id:body.scope_id},ip_address:getClientIp(request)},client);
      return environmentId;
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
        const cleanBase = preparePolicyBaseForDerivativeGeneration(
          rawConfig as Record<string, unknown>
        );

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

    // Capture affected devices BEFORE deleting the assignment (M6 fix).
    // After the delete, the assignment row is gone so the cascade query finds nothing.
    let affectedDevicesSnapshot: Array<{ id: string; amapi_name: string }> = [];
    let deleted = false;

    const { environmentId: envId, oldAssignment, oldDerivative } = await assignmentTransaction(auth, request, body.scope_type, 'unassign', async (client) => {
      const { environmentId: envId } = await requirePolicyAssignmentAuthority(client, auth, body);
      const oldAssignment = (await client.query<{ policy_id: string }>(
        'SELECT policy_id FROM policy_assignments WHERE scope_type=$1 AND scope_id=$2 FOR UPDATE', [body.scope_type, body.scope_id],
      )).rows[0];
      const oldDerivative = oldAssignment ? (await client.query<{ amapi_name: string | null }>(
        'SELECT amapi_name FROM policy_derivatives WHERE policy_id=$1 AND scope_type=$2 AND scope_id=$3',
        [oldAssignment.policy_id, body.scope_type, body.scope_id],
      )).rows[0] : null;
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
      if(deleted) await logAudit({environment_id:envId,user_id:auth.user.id,action:'policy.unassigned',resource_type:'policy_assignment',resource_id:body.scope_id,details:{scope_type:body.scope_type,scope_id:body.scope_id,old_policy_id:oldAssignment?.policy_id},ip_address:getClientIp(request)},client);
      return { environmentId: envId, oldAssignment, oldDerivative };
    });

    if (!deleted) {
      return errorResponse('Assignment not found', 404);
    }

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
                const cleanBase = preparePolicyBaseForDerivativeGeneration(
                  rawConfig as Record<string, unknown>
                );

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

          let derivativeCleanup: Record<string, unknown> = { deleted: false, reason: 'not_found' };
          if (!oldDerivative?.amapi_name) {
            await execute(
              'DELETE FROM policy_derivatives WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3',
              [oldAssignment.policy_id, body.scope_type, body.scope_id]
            );
            derivativeCleanup = { deleted: true, reason: 'no_remote_resource', checked_devices: 0 };
          } else if (deviceFailures.length > 0) {
            derivativeCleanup = {
              deleted: false,
              reason: 'device_resync_failed',
              checked_devices: 0,
            };
          } else {
            const result = await deletePolicyDerivativeWhenUnused({
              environmentId: envId,
              scopeType: body.scope_type,
              scopeId: body.scope_id,
              amapiName: oldDerivative.amapi_name,
              amapiContext,
            });
            derivativeCleanup = result;
            if (result.deleted) {
              await execute(
                'DELETE FROM policy_derivatives WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3',
                [oldAssignment.policy_id, body.scope_type, body.scope_id]
              );
            }
          }

          amapiSync = {
            synced: true,
            devices_synced: devicesSynced,
            device_failures: deviceFailures,
            derivative_cleanup: derivativeCleanup,
          };
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
                  pa.scope_type, pa.scope_id, pa.locked, pa.locked_sections, pa.created_at, md5(row_to_json(pa)::text) AS assignment_version
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
                  pa.scope_type, pa.scope_id, pa.locked, pa.locked_sections, pa.created_at, md5(row_to_json(pa)::text) AS assignment_version
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
