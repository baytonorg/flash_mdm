import { queryOne, withClient } from './db.js';
import type { PoolClient } from 'pg';
import { assignPolicyToDeviceWithDerivative, getPolicyAmapiContext } from './policy-derivatives.js';
import { preparePolicyBaseForDerivativeGeneration } from './policy-merge.js';
import { logAudit } from './audit.js';

export async function enqueueDevicePolicyReconcile(client: PoolClient, environmentId: string, deviceIds: string[]) {
  if (!deviceIds.length) return;
  await client.query(`INSERT INTO job_queue (job_type, environment_id, payload)
    SELECT 'device_policy_reconcile', $1, jsonb_build_object('device_id', id) FROM unnest($2::uuid[]) id`, [environmentId,deviceIds]);
}

export async function currentDevicePolicy(deviceId: string) {
  return queryOne<{id:string;environment_id:string;group_id:string|null;amapi_name:string;policy_id:string|null;config:Record<string,unknown>|string|null}>(`SELECT d.id,d.environment_id,d.group_id,d.amapi_name,p.id AS policy_id,p.config FROM devices d
    LEFT JOIN LATERAL (SELECT pa.policy_id FROM policy_assignments pa WHERE pa.scope_type='device' AND pa.scope_id=d.id LIMIT 1) direct ON true
    LEFT JOIN LATERAL (SELECT pa.policy_id FROM group_closures gc JOIN policy_assignments pa ON pa.scope_type='group' AND pa.scope_id=gc.ancestor_id WHERE gc.descendant_id=d.group_id ORDER BY gc.depth LIMIT 1) inherited ON true
    LEFT JOIN LATERAL (SELECT pa.policy_id FROM policy_assignments pa WHERE pa.scope_type='environment' AND pa.scope_id=d.environment_id LIMIT 1) environment ON true
    LEFT JOIN policies p ON p.id=COALESCE(direct.policy_id,inherited.policy_id,environment.policy_id) AND p.environment_id=d.environment_id
    WHERE d.id=$1 AND d.deleted_at IS NULL`, [deviceId]);
}

export async function reconcileDevicePolicy(deviceId: string) {
  // Jobs carry identity, never a stale policy decision or access credential.
  // A non-blocking per-device lock serialises duplicate jobs without exhausting
  // the pool while the holder performs ordinary pooled queries/API calls.
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    const attempt=await withClient(async client=>{
      const lock=await client.query('SELECT pg_try_advisory_lock(1179404628, hashtext($1)) AS locked',[deviceId]);
      if(!lock.rows[0]?.locked) return false;
      try {
        for(let attempt=0;attempt<3;attempt++) {
          const device=await currentDevicePolicy(deviceId);
          if(!device) return true;
          if(!device.policy_id)throw new Error('No effective policy exists for this device; reconciliation needs review');
          const context=await getPolicyAmapiContext(device.environment_id);
          if(!context) {
            await logAudit({environment_id:device.environment_id,actor_type:'system',action:'device.policy_reconciliation_skipped',resource_type:'device',resource_id:deviceId,details:{reason:'environment_unbound'}});
            return true;
          }
          const config=typeof device.config==='string'?JSON.parse(device.config):device.config??{};
          await assignPolicyToDeviceWithDerivative({policyId:device.policy_id,environmentId:device.environment_id,deviceId,deviceAmapiName:device.amapi_name,amapiContext:context,baseConfig:preparePolicyBaseForDerivativeGeneration(config)});
          const current=await currentDevicePolicy(deviceId);
          if(!current || current.policy_id===device.policy_id && current.group_id===device.group_id) {
            await logAudit({environment_id:device.environment_id,device_id:deviceId,actor_type:'system',action:'device.policy_reconciled',resource_type:'device',resource_id:deviceId,details:{source:'group_lifecycle'}});
            return true;
          }
        }
        throw new Error('Device policy context changed during reconciliation; retry required');
      } finally {await client.query('SELECT pg_advisory_unlock(1179404628, hashtext($1))',[deviceId]);}
    });
    if(attempt) return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Device policy reconciliation is busy; retry required');
}
