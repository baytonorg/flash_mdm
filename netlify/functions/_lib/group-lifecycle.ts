import type { PoolClient } from 'pg';
import type { AuthContext } from './auth.js';
import { transaction } from './db.js';
import { lockMembershipWorkspaces, requireScopeManagementPaths } from './membership-lifecycle.js';
import { workspaceRoleMeetsMinimum } from './rbac.js';
import { errorResponse } from './helpers.js';
import { logAudit } from './audit.js';
import { enqueueDevicePolicyReconcile } from './device-policy-reconcile.js';
import { withSignupLinkReferenceLock } from './signup-link-reference-lock.js';
import { scopeAuthority } from './scope-authority.js';
import { requirePolicyAssignmentAuthority, requireUnexpiredAssignmentPrincipal, withPolicyAssignmentDeniedAudit } from './policy-assignment-authority.js';

async function groupContext(client: PoolClient, auth: AuthContext, groupId: string, action:'write'|'delete') {
  const hint=(await client.query('SELECT e.workspace_id FROM groups g JOIN environments e ON e.id=g.environment_id WHERE g.id=$1',[groupId])).rows[0];
  if(!hint) throw errorResponse('Group no longer exists',409);
  await lockMembershipWorkspaces(client,[hint.workspace_id]);
  const group=(await client.query(`SELECT g.*,e.workspace_id,e.enterprise_features,w.settings AS workspace_settings FROM groups g JOIN environments e ON e.id=g.environment_id JOIN workspaces w ON w.id=e.workspace_id WHERE g.id=$1 FOR UPDATE OF g`,[groupId])).rows[0];
  if(!group) throw errorResponse('Group no longer exists',409);
  const {role,matrix}=await scopeAuthority(client,auth,group.environment_id,groupId);
  if(!role||!workspaceRoleMeetsMinimum(role,matrix.group[action]))throw errorResponse('Forbidden: no authority for this group operation',403);
  return group;
}

export async function requireGroupCreationScope(client:PoolClient,auth:AuthContext,environmentId:string,parentId:string|null) {
  if(parentId) {
    const parent=await groupContext(client,auth,parentId,'write');
    if(parent.environment_id!==environmentId)throw errorResponse('Parent group must be in this environment',400);
  } else {
    const scope=await scopeAuthority(client,auth,environmentId);
    if(!scope.role||!workspaceRoleMeetsMinimum(scope.role,scope.matrix.group.write))throw errorResponse('Creating a root group requires environment-wide authority',403);
  }
}

async function audit(client:PoolClient,auth:AuthContext,groupId:string,environmentId:string,action:string,details:Record<string,unknown>,ip:string){
  await logAudit({environment_id:environmentId,user_id:auth.user.id,actor_type:auth.authType==='api_key'?'api_key':'user',api_key_id:auth.authType==='api_key'?auth.apiKey.id:null,action,resource_type:'group',resource_id:groupId,details,ip_address:ip},client);
}

async function requireConsistentSubtree(client:PoolClient,groupId:string) {
  const result=await client.query(`WITH RECURSIVE subtree AS (
    SELECT id,ARRAY[id] AS path,false AS cycle FROM groups WHERE id=$1
    UNION ALL SELECT g.id,s.path||g.id,g.id=ANY(s.path) FROM groups g JOIN subtree s ON g.parent_group_id=s.id WHERE NOT s.cycle
  ), actual AS (SELECT DISTINCT id FROM subtree), cached AS (SELECT descendant_id AS id FROM group_closures WHERE ancestor_id=$1)
  SELECT EXISTS(SELECT 1 FROM subtree WHERE cycle) OR EXISTS(SELECT id FROM actual EXCEPT SELECT id FROM cached) OR EXISTS(SELECT id FROM cached EXCEPT SELECT id FROM actual) AS inconsistent`,[groupId]);
  if(result.rows[0]?.inconsistent)throw errorResponse('Group hierarchy needs repair before this operation; no changes were committed',409);
}

export async function updateGroupLifecycle(input:{auth:AuthContext;groupId:string;parentId?:string|null;name?:string;description?:string;clearDirectAssignments?:boolean;ip:string}) {
  const mutate=()=>transaction(async client=>{
    const group=await groupContext(client,input.auth,input.groupId,'write');
    if(input.clearDirectAssignments)await requirePolicyAssignmentAuthority(client,input.auth,{scope_type:'group',scope_id:input.groupId});
    await requireConsistentSubtree(client,input.groupId);
    const parentChanged=input.parentId!==undefined&&input.parentId!==group.parent_group_id;
    if(parentChanged&&input.parentId) {
      const destination=(await client.query('SELECT environment_id FROM groups WHERE id=$1',[input.parentId])).rows[0];
      if(!destination||destination.environment_id!==group.environment_id)throw errorResponse('Parent group must be in the same environment',400);
      const parent=await groupContext(client,input.auth,input.parentId,'write');
      if(parent.environment_id!==group.environment_id)throw errorResponse('Parent group must be in the same environment',400);
      if((await client.query('SELECT 1 FROM group_closures WHERE ancestor_id=$1 AND descendant_id=$2',[input.groupId,input.parentId])).rows.length)throw errorResponse('Cannot move a group under itself or its descendants',400);
    } else if(parentChanged) {
      const scope=await scopeAuthority(client,input.auth,group.environment_id);
      if(!scope.role||!workspaceRoleMeetsMinimum(scope.role,scope.matrix.group.write))throw errorResponse('Moving to the environment root requires environment-wide management authority',403);
    }
    const affected=(await client.query(`SELECT d.id FROM devices d JOIN group_closures gc ON gc.descendant_id=d.group_id WHERE gc.ancestor_id=$1 AND d.deleted_at IS NULL`,[input.groupId])).rows.map(r=>r.id);
    if(input.clearDirectAssignments)await requireUnexpiredAssignmentPrincipal(client,input.auth);
    await client.query(`UPDATE groups SET name=COALESCE($2,name),description=COALESCE($3,description),parent_group_id=CASE WHEN $4 THEN $5::uuid ELSE parent_group_id END,updated_at=now() WHERE id=$1`,[input.groupId,input.name??null,input.description??null,parentChanged,input.parentId??null]);
    if(parentChanged) {
      await client.query(`DELETE FROM group_closures gc USING group_closures old_anc,group_closures sub WHERE old_anc.descendant_id=$1 AND old_anc.ancestor_id<>$1 AND sub.ancestor_id=$1 AND gc.ancestor_id=old_anc.ancestor_id AND gc.descendant_id=sub.descendant_id`,[input.groupId]);
      if(input.parentId)await client.query(`INSERT INTO group_closures (ancestor_id,descendant_id,depth) SELECT a.ancestor_id,s.descendant_id,a.depth+s.depth+1 FROM group_closures a CROSS JOIN group_closures s WHERE a.descendant_id=$2 AND s.ancestor_id=$1 ON CONFLICT (ancestor_id,descendant_id) DO UPDATE SET depth=EXCLUDED.depth`,[input.groupId,input.parentId]);
    }
    if(input.clearDirectAssignments)for(const table of ['policy_assignments','app_deployments','network_deployments'])await client.query(`DELETE FROM ${table} WHERE scope_type='group' AND scope_id=$1`,[input.groupId]);
    if(parentChanged)await requireScopeManagementPaths(client,group.workspace_id);
    if(parentChanged||input.clearDirectAssignments)await enqueueDevicePolicyReconcile(client,group.environment_id,affected);
    const queued=parentChanged||input.clearDirectAssignments?affected.length:0;
    await audit(client,input.auth,input.groupId,group.environment_id,'group.updated',{parent_changed:parentChanged,previous_parent_group_id:group.parent_group_id,new_parent_group_id:input.parentId??null,clear_direct_assignments:input.clearDirectAssignments===true,policy_reconciliation_queued:queued},input.ip);
    return {affected_devices:queued};
  });
  return input.clearDirectAssignments ? withPolicyAssignmentDeniedAudit(input.auth,'group','clear_direct_assignments',mutate) : mutate();
}

export async function deleteGroupLifecycle(input:{auth:AuthContext;groupId:string;ip:string}) {
  return withSignupLinkReferenceLock(()=>transaction(async client=>{
    const group=await groupContext(client,input.auth,input.groupId,'delete');
    await requireConsistentSubtree(client,input.groupId);
    const ids=(await client.query('SELECT descendant_id FROM group_closures WHERE ancestor_id=$1',[input.groupId])).rows.map(r=>r.descendant_id);
    if(!ids.includes(input.groupId))ids.push(input.groupId);
    for(const id of ids)await groupContext(client,input.auth,id,'delete');
    const dependencies=(await client.query(`SELECT
      EXISTS(SELECT 1 FROM enrollment_tokens WHERE group_id=ANY($1::uuid[])) OR
      EXISTS(SELECT 1 FROM signin_configurations WHERE default_group_id=ANY($1::uuid[])) OR
      EXISTS(SELECT 1 FROM user_invites WHERE group_id=ANY($1::uuid[]) OR group_ids ?| $2::text[]) OR
      EXISTS(SELECT 1 FROM signup_links WHERE (scope_type='group' AND scope_id=ANY($1::uuid[])) OR auto_assign_group_ids ?| $2::text[]) AS protected_references`,[ids,ids])).rows[0];
    if(dependencies?.protected_references)throw errorResponse('Group deletion is blocked by enrolment, sign-in, invitation or signup-link references. Handle those explicitly first; no credentials or links were changed.',409);
    const affected=(await client.query('SELECT id FROM devices WHERE group_id=ANY($1::uuid[]) AND deleted_at IS NULL',[ids])).rows.map(r=>r.id);
    await client.query('UPDATE devices SET group_id=NULL,updated_at=now() WHERE group_id=ANY($1::uuid[])',[ids]);
    for(const table of ['app_deployments','network_deployments','policy_assignments','policy_derivatives'])await client.query(`DELETE FROM ${table} WHERE scope_type='group' AND scope_id=ANY($1::uuid[])`,[ids]);
    await client.query('DELETE FROM groups WHERE id=ANY($1::uuid[])',[ids]);
    await enqueueDevicePolicyReconcile(client,group.environment_id,affected);
    await audit(client,input.auth,input.groupId,group.environment_id,'group.deleted',{groups_removed:ids.length,devices_ungrouped:affected.length,policy_reconciliation_queued:affected.length,external_policy_resources_retained:true},input.ip);
    return {affected_devices:affected.length};
  }));
}
