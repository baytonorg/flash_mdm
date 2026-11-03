import type { AuthContext } from './auth.js';
import { transaction } from './db.js';
import { lockMembershipWorkspaces } from './membership-lifecycle.js';
import { scopeAuthority } from './scope-authority.js';
import { mergePermissionMatrixWithDefaults } from './rbac-matrix.js';
import { workspaceRoleMeetsMinimum } from './rbac.js';
import { errorResponse } from './helpers.js';

export async function writeInviteOffer(input:{auth:AuthContext;workspaceId:string|null;email:string;role:string;tokenHash:string;expiresAtIso:string;inviteId:string;inviteType:string;environmentIds:string[];groupIds:string[]}) {
  return transaction(async client=>{
    const scoped=input.environmentIds.length>0||input.groupIds.length>0;
    if(input.workspaceId)await lockMembershipWorkspaces(client,[input.workspaceId]);
    else await client.query('SELECT pg_advisory_xact_lock(1179404629, hashtext($1))',[input.email]);
    const superadmin=input.auth.authType==='session'&&(await client.query('SELECT is_superadmin FROM users WHERE id=$1',[input.auth.user.id])).rows[0]?.is_superadmin;
    if(!input.workspaceId) {
      if(!superadmin||scoped||input.inviteType!=='platform_access')throw errorResponse('Platform invitation authority changed',403);
    } else {
      const envs=await client.query('SELECT id FROM environments WHERE workspace_id=$1 AND id=ANY($2::uuid[]) FOR KEY SHARE',[input.workspaceId,input.environmentIds]);
      const groups=await client.query('SELECT g.id,g.environment_id FROM groups g JOIN environments e ON e.id=g.environment_id WHERE e.workspace_id=$1 AND g.id=ANY($2::uuid[]) FOR KEY SHARE OF g,e',[input.workspaceId,input.groupIds]);
      if(envs.rows.length!==input.environmentIds.length||groups.rows.length!==input.groupIds.length)throw errorResponse('Invitation scopes changed or are outside this workspace',409);
      if(!superadmin) {
        if(!scoped) {
          const workspace=(await client.query('SELECT settings FROM workspaces WHERE id=$1',[input.workspaceId])).rows[0];
          const matrix=mergePermissionMatrixWithDefaults(workspace?.settings?.rbac?.permission_matrix);
          let role:string|null=null;
          if(input.auth.authType==='api_key') {
            const key=(await client.query(`SELECT role FROM api_keys WHERE id=$1 AND scope_type='workspace' AND workspace_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,[input.auth.apiKey.id,input.workspaceId])).rows[0];
            role=key?.role??null;
          } else role=(await client.query("SELECT role FROM workspace_memberships WHERE user_id=$1 AND workspace_id=$2 AND access_scope='workspace'",[input.auth.user.id,input.workspaceId])).rows[0]?.role??null;
          if(!role||!workspaceRoleMeetsMinimum(role,matrix.invite.write)||!workspaceRoleMeetsMinimum(role,input.role as 'owner'|'admin'|'member'|'viewer'))throw errorResponse('Workspace invitation authority changed',403);
        }
        for(const env of envs.rows) {
          const scope=await scopeAuthority(client,input.auth,env.id);
          if(!scope.role||!workspaceRoleMeetsMinimum(scope.role,scope.matrix.environment.manage_users)||!workspaceRoleMeetsMinimum(scope.role,input.role as 'owner'|'admin'|'member'|'viewer'))throw errorResponse('Environment invitation authority changed',403);
        }
        for(const group of groups.rows) {
          const scope=await scopeAuthority(client,input.auth,group.environment_id,group.id);
          if(!scope.role||!workspaceRoleMeetsMinimum(scope.role,scope.matrix.group.manage_users)||!workspaceRoleMeetsMinimum(scope.role,input.role as 'owner'|'admin'|'member'|'viewer'))throw errorResponse('Group invitation authority changed',403);
        }
      }
      if((await client.query('SELECT 1 FROM workspace_memberships wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=$1 AND lower(u.email)=lower($2)',[input.workspaceId,input.email])).rows.length)throw errorResponse('User is already a member of this workspace',409);
    }
    const pending=(await client.query(`SELECT id FROM user_invites WHERE workspace_id IS NOT DISTINCT FROM $1::uuid AND lower(email)=lower($2) AND status='pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[input.workspaceId,input.email])).rows[0];
    const id=pending?.id??input.inviteId;
    const metadata={invite_type:input.inviteType,...(input.auth.authType==='api_key'?{issuer_api_key_id:input.auth.apiKey.id}:{})};
    const values=[id,input.workspaceId,input.email,input.role,input.tokenHash,input.auth.user.id,input.expiresAtIso,JSON.stringify(input.environmentIds),JSON.stringify(input.groupIds),JSON.stringify(metadata)];
    if(pending)await client.query(`UPDATE user_invites SET workspace_id=$2,email=$3,role=$4,token_hash=$5,invited_by=$6,expires_at=$7,environment_ids=$8,group_ids=$9,permissions=$10,status='pending',accepted_at=NULL WHERE id=$1`,values);
    else await client.query(`INSERT INTO user_invites (id,workspace_id,email,role,token_hash,invited_by,expires_at,environment_ids,group_ids,permissions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,values);
    return {id,resent:!!pending};
  });
}
