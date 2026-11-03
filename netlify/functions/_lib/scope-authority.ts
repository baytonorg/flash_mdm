import type { PoolClient } from 'pg';
import type { AuthContext } from './auth.js';
import { mergePermissionMatrixWithDefaults } from './rbac-matrix.js';
import { errorResponse } from './helpers.js';

// Caller holds the workspace lifecycle lock. Resolve direct/nearest-ancestor
// precedence with the same client, without relying on a cached permission matrix.
export async function scopeAuthority(client:PoolClient,auth:AuthContext,environmentId:string,groupId?:string|null) {
  const environment=(await client.query(`SELECT e.workspace_id,e.enterprise_features,w.settings FROM environments e JOIN workspaces w ON w.id=e.workspace_id WHERE e.id=$1`,[environmentId])).rows[0];
  if(!environment)throw errorResponse('Environment no longer exists',409);
  const matrix=mergePermissionMatrixWithDefaults(environment.enterprise_features?.rbac?.permission_matrix??environment.settings?.rbac?.permission_matrix);
  let role:string|null=null;
  if(auth.authType==='api_key') {
    const key=(await client.query(`SELECT role,scope_type,workspace_id,environment_id FROM api_keys WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,[auth.apiKey.id])).rows[0];
    if(key && key.role===auth.apiKey.role && key.workspace_id===environment.workspace_id && (key.scope_type==='workspace'||key.environment_id===environmentId))role=key.role;
  } else {
    const user=(await client.query('SELECT is_superadmin FROM users WHERE id=$1',[auth.user.id])).rows[0];
    if(user?.is_superadmin)role='owner';
    else {
      const grant=(await client.query(`SELECT COALESCE(direct.role,em.role,CASE WHEN wm.access_scope='workspace' THEN wm.role END) AS role
        FROM workspace_memberships wm LEFT JOIN environment_memberships em ON em.user_id=wm.user_id AND em.environment_id=$3
        LEFT JOIN LATERAL (SELECT gm.role FROM group_memberships gm JOIN groups assigned ON assigned.id=gm.group_id AND assigned.environment_id=$3 JOIN group_closures gc ON gc.ancestor_id=gm.group_id WHERE gm.user_id=wm.user_id AND gc.descendant_id=$1 ORDER BY gc.depth LIMIT 1) direct ON true
        WHERE wm.workspace_id=$2 AND wm.user_id=$4`,[groupId??null,environment.workspace_id,environmentId,auth.user.id])).rows[0];
      role=grant?.role??null;
    }
  }
  return {role,matrix,workspaceId:environment.workspace_id};
}
