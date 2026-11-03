import { transaction } from './db.js';
import type { AuthContext } from './auth.js';
import { lockMembershipWorkspaces } from './membership-lifecycle.js';
import { scopeAuthority } from './scope-authority.js';
import { workspaceRoleMeetsMinimum } from './rbac.js';
import { enqueueDevicePolicyReconcile } from './device-policy-reconcile.js';
import { errorResponse } from './helpers.js';
import { logAudit } from './audit.js';

export async function changeDeviceGroup(input:{auth:AuthContext;deviceId:string;groupId:string|null;ip:string}) {
  return transaction(async client=>{
    const hint=(await client.query('SELECT e.workspace_id FROM devices d JOIN environments e ON e.id=d.environment_id WHERE d.id=$1 AND d.deleted_at IS NULL',[input.deviceId])).rows[0];
    if(!hint)throw errorResponse('Device no longer exists',409);
    await lockMembershipWorkspaces(client,[hint.workspace_id]);
    const device=(await client.query('SELECT id,environment_id,group_id FROM devices WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[input.deviceId])).rows[0];
    if(!device)throw errorResponse('Device no longer exists',409);
    if(input.groupId && !(await client.query('SELECT 1 FROM groups WHERE id=$1 AND environment_id=$2 FOR KEY SHARE',[input.groupId,device.environment_id])).rows.length)throw errorResponse('Group no longer exists in this environment',409);
    for(const groupId of [device.group_id,input.groupId]) {
      const scope=await scopeAuthority(client,input.auth,device.environment_id,groupId);
      if(!scope.role||!workspaceRoleMeetsMinimum(scope.role,scope.matrix.device.write))throw errorResponse('Forbidden: device moves must stay within your authorised scopes',403);
    }
    await client.query('UPDATE devices SET group_id=$1,updated_at=now() WHERE id=$2',[input.groupId,input.deviceId]);
    await enqueueDevicePolicyReconcile(client,device.environment_id,[input.deviceId]);
    await logAudit({environment_id:device.environment_id,user_id:input.auth.user.id,actor_type:input.auth.authType==='api_key'?'api_key':'user',api_key_id:input.auth.authType==='api_key'?input.auth.apiKey.id:null,action:'device.group_changed',resource_type:'device',resource_id:input.deviceId,details:{previous_group_id:device.group_id,new_group_id:input.groupId,policy_reconciliation_queued:true},ip_address:input.ip},client);
  });
}
