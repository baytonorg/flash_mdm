import type { PoolClient } from 'pg';
import type { AuthContext } from './auth.js';
import { errorResponse } from './helpers.js';
import { lockMembershipWorkspaces } from './membership-lifecycle.js';
import { resolvePolicyAssignmentMinimum } from './rbac-matrix.js';
import { workspaceRoleMeetsMinimum } from './rbac.js';
import { logAudit } from './audit.js';
import { runWithoutAuditAuthContext } from './request-auth-context.js';

export type AssignmentTarget = { scope_type: 'environment' | 'group' | 'device'; scope_id: string };

// Call after all potentially blocking scope/policy/assignment reads and directly
// before mutation. The authority check holds the key row FOR SHARE, preventing
// role/scope/revocation changes, but wall-clock expiry can pass while waiting.
export async function requireUnexpiredAssignmentPrincipal(client: PoolClient, auth: AuthContext) {
  if(auth.authType!=='api_key')return;
  const current=(await client.query('SELECT 1 FROM api_keys WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp())',[auth.apiKey.id])).rows[0];
  if(!current)throw errorResponse('API-key authority expired or changed before the operation could be saved',403);
}

export async function withPolicyAssignmentDeniedAudit<T>(auth: AuthContext, scopeType: string, operation: string, fn: () => Promise<T>) {
  try {return await fn();}
  catch(error) {
    if(error instanceof Response && [403,404].includes(error.status)) {
      // Denials survive transaction rollback. Explicit attribution excludes
      // request-time role/creator enrichment and foreign resource identifiers.
      await runWithoutAuditAuthContext(()=>logAudit({user_id:auth.user.id,actor_type:auth.authType==='api_key'?'api_key':'user',api_key_id:auth.authType==='api_key'?auth.apiKey.id:undefined,
        action:'policy.assignment_denied',resource_type:'policy_assignment',details:{scope_type:scopeType,operation,reason:error.status===403?'insufficient_current_authority':'scope_or_policy_unavailable',support:!!auth.user.impersonation?.active,support_actor_user_id:auth.user.impersonation?.by_user_id}}));
    }
    throw error;
  }
}

// All reads and the mutation use this client. The workspace row is the same
// lifecycle anchor used by membership and topology writers, even for a scope
// with no assignment row yet. No provider call belongs inside these locks.
export async function requirePolicyAssignmentAuthority(
  client: PoolClient, auth: AuthContext, target: AssignmentTarget, purpose: 'assign' | 'locks' = 'assign',
) {
  if (typeof target.scope_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.scope_id)) throw errorResponse('A valid scope identifier is required',400);
  if (auth.user.impersonation?.mode === 'read_only') throw errorResponse('This support session is read-only', 403);
  const table = target.scope_type === 'environment' ? 'environments' : target.scope_type === 'group' ? 'groups' : 'devices';
  const initial = (await client.query(
    target.scope_type === 'environment'
      ? 'SELECT id AS environment_id FROM environments WHERE id=$1'
      : `SELECT environment_id FROM ${table} WHERE id=$1${table === 'devices' ? ' AND deleted_at IS NULL' : ''}`,
    [target.scope_id],
  )).rows[0];
  if (!initial) throw errorResponse('Scope target not found', 404);
  const anchor = (await client.query('SELECT workspace_id FROM environments WHERE id=$1', [initial.environment_id])).rows[0];
  if (!anchor) throw errorResponse('Scope target not found', 404);
  await lockMembershipWorkspaces(client, [anchor.workspace_id]);
  const environment = (await client.query('SELECT id, workspace_id, enterprise_features FROM environments WHERE id=$1 FOR UPDATE', [initial.environment_id])).rows[0];
  if (!environment || environment.workspace_id !== anchor.workspace_id) throw errorResponse('Scope changed. Refresh and try again.', 409);
  const current = target.scope_type === 'environment' ? environment : (await client.query(
    `SELECT * FROM ${table} WHERE id=$1${table === 'devices' ? ' AND deleted_at IS NULL' : ''} FOR UPDATE`, [target.scope_id],
  )).rows[0];
  if (!current || (target.scope_type !== 'environment' && current.environment_id !== environment.id)) throw errorResponse('Scope changed. Refresh and try again.', 409);
  const workspace = (await client.query('SELECT settings FROM workspaces WHERE id=$1', [anchor.workspace_id])).rows[0];
  const minimum = purpose === 'locks' ? 'admin' : resolvePolicyAssignmentMinimum(workspace.settings?.rbac?.permission_matrix, environment.enterprise_features?.rbac?.permission_matrix);
  const groupId = target.scope_type === 'group' ? target.scope_id : target.scope_type === 'device' ? current.group_id : null;
  let environmentRole: string | null = null;
  let groupRole: string | null = null;
  if (auth.authType === 'api_key') {
    // Read current key scope and role, never the creator's grants. Credential
    // lifecycle is read-only here, including expired and revoked backing rows.
    const key = (await client.query(`SELECT role, scope_type, workspace_id, environment_id FROM api_keys
      WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE`, [auth.apiKey.id])).rows[0];
    if (key?.workspace_id === anchor.workspace_id && (key.scope_type === 'workspace' || (key.scope_type === 'environment' && key.environment_id === environment.id))) environmentRole = key.role;
  } else {
    const user = (await client.query('SELECT is_superadmin FROM users WHERE id=$1 FOR SHARE', [auth.user.id])).rows[0];
    if (user?.is_superadmin && !auth.user.impersonation?.active) environmentRole = 'owner';
    else if (user) {
      const grants = (await client.query(`SELECT COALESCE(em.role,CASE WHEN wm.access_scope='workspace' THEN wm.role END) AS environment_role,
        nearest.role AS group_role FROM (SELECT $1::uuid AS id) actor
        LEFT JOIN workspace_memberships wm ON wm.user_id=actor.id AND wm.workspace_id=$2
        LEFT JOIN environment_memberships em ON em.user_id=actor.id AND em.environment_id=$3
        LEFT JOIN LATERAL (SELECT gm.role FROM group_memberships gm
          JOIN groups g ON g.id=gm.group_id AND g.environment_id=$3
          JOIN group_closures gc ON gc.ancestor_id=gm.group_id
          WHERE gm.user_id=actor.id AND gc.descendant_id=$4 ORDER BY gc.depth LIMIT 1) nearest ON true`,
      [auth.user.id, anchor.workspace_id, environment.id, groupId])).rows[0];
      environmentRole = grants?.environment_role ?? null;
      groupRole = grants?.group_role ?? null;
    }
  }
  const allowed = !!environmentRole && workspaceRoleMeetsMinimum(environmentRole, minimum)
    || !!groupId && !!groupRole && workspaceRoleMeetsMinimum(groupRole, minimum);
  if (!allowed) throw errorResponse(`Policy ${purpose === 'locks' ? 'lock changes' : 'assignment and revert'} require ${minimum === 'owner' ? 'Owner' : 'Admin'} access to this environment or group.`, 403);
  return { environmentId: environment.id as string, workspaceId: anchor.workspace_id as string, minimum };
}
