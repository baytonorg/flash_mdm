import { amapiCall, getAmapiErrorHttpStatus } from './amapi.js';
import { query } from './db.js';

type PolicyScopeType = 'environment' | 'group' | 'device';

type AmapiContext = {
  workspace_id: string;
  gcp_project_id: string;
  enterprise_name: string;
};

type ScopedDevice = {
  id: string;
  amapi_name: string;
};

type AmapiDevicePolicyState = {
  policyName?: string;
  appliedPolicyName?: string;
};

export type DerivativeCleanupResult =
  | { deleted: true; reason: 'deleted' | 'already_absent'; checked_devices: number }
  | {
      deleted: false;
      reason: 'still_requested_or_applied' | 'device_check_uncertain' | 'delete_uncertain';
      checked_devices: number;
    };

async function listDevicesForDerivativeScope(input: {
  environmentId: string;
  scopeType: PolicyScopeType;
  scopeId: string;
}): Promise<ScopedDevice[]> {
  if (input.scopeType === 'device') {
    return query<ScopedDevice>(
      `SELECT id, amapi_name
       FROM devices
       WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL`,
      [input.scopeId, input.environmentId]
    );
  }

  if (input.scopeType === 'group') {
    return query<ScopedDevice>(
      `SELECT DISTINCT d.id, d.amapi_name
       FROM devices d
       JOIN group_closures gc
         ON gc.descendant_id = d.group_id
        AND gc.ancestor_id = $1
       WHERE d.environment_id = $2 AND d.deleted_at IS NULL`,
      [input.scopeId, input.environmentId]
    );
  }

  return query<ScopedDevice>(
    `SELECT id, amapi_name
     FROM devices
     WHERE environment_id = $1 AND deleted_at IS NULL`,
    [input.environmentId]
  );
}

/**
 * Delete a remote derivative only after authoritative AMAPI reads prove that no
 * active device in its former scope still requests or applies it. Any uncertain
 * read or delete leaves the remote resource and local cleanup record intact so a
 * later retry can finish safely.
 */
export async function deletePolicyDerivativeWhenUnused(input: {
  environmentId: string;
  scopeType: PolicyScopeType;
  scopeId: string;
  amapiName: string;
  amapiContext: AmapiContext;
}): Promise<DerivativeCleanupResult> {
  const devices = await listDevicesForDerivativeScope(input);
  let checkedDevices = 0;

  for (const device of devices) {
    try {
      const state = await amapiCall<AmapiDevicePolicyState>(
        device.amapi_name,
        input.amapiContext.workspace_id,
        {
          projectId: input.amapiContext.gcp_project_id,
          enterpriseName: input.amapiContext.enterprise_name,
          resourceType: 'devices',
          resourceId: device.amapi_name.split('/').pop(),
        }
      );
      checkedDevices += 1;
      if (state.policyName === input.amapiName || state.appliedPolicyName === input.amapiName) {
        return {
          deleted: false,
          reason: 'still_requested_or_applied',
          checked_devices: checkedDevices,
        };
      }
    } catch (err) {
      if (getAmapiErrorHttpStatus(err) === 404) {
        checkedDevices += 1;
        continue;
      }
      return {
        deleted: false,
        reason: 'device_check_uncertain',
        checked_devices: checkedDevices,
      };
    }
  }

  try {
    await amapiCall(input.amapiName, input.amapiContext.workspace_id, {
      method: 'DELETE',
      projectId: input.amapiContext.gcp_project_id,
      enterpriseName: input.amapiContext.enterprise_name,
      resourceType: 'policies',
      resourceId: input.amapiName.split('/').pop(),
      retryMode: 'safe',
    });
    return { deleted: true, reason: 'deleted', checked_devices: checkedDevices };
  } catch (err) {
    if (getAmapiErrorHttpStatus(err) === 404) {
      return { deleted: true, reason: 'already_absent', checked_devices: checkedDevices };
    }
    return { deleted: false, reason: 'delete_uncertain', checked_devices: checkedDevices };
  }
}
