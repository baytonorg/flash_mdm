import type { Context } from '@netlify/functions';
import { updateGroupLifecycle, deleteGroupLifecycle, requireGroupCreationScope } from './_lib/group-lifecycle.js';
import { wakePolicyReconciliation } from './_lib/policy-reconcile-wake.js';
import { lockMembershipWorkspaces } from './_lib/membership-lifecycle.js';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  requireEnvironmentResourcePermission,
  requireEnvironmentAccessScopeForResourcePermission,
} from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams, isValidUuid } from './_lib/helpers.js';

/**
 * Build nested group list with depth indicators.
 * Port of beam_twinkle groupStore.ts nestedGroupList getter.
 */
function buildNestedGroupList(groups: Array<{ id: string; parent_group_id: string | null; name: string; description: string | null }>) {
  const byParent = new Map<string | null, typeof groups>();
  for (const g of groups) {
    const key = g.parent_group_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(g);
  }

  const result: Array<typeof groups[0] & { depth: number }> = [];
  function traverse(parentId: string | null, depth: number) {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      result.push({ ...child, depth });
      traverse(child.id, depth + 1);
    }
  }
  traverse(null, 0);
  return result;
}

type BulkSelection = {
  ids?: string[];
  all_matching?: boolean;
  excluded_ids?: string[];
};

type GroupsBulkBody = {
  environment_id?: string;
  operation?: 'delete' | 'move';
  selection?: BulkSelection;
  options?: {
    target_parent_id?: string | null;
    clear_direct_assignments?: boolean;
  };
};

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/groups/', '').split('/').filter(Boolean);
    const action = segments[0];

  // GET /api/groups/list?environment_id=...
  if (request.method === 'GET' && action === 'list') {
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');
    if (!isValidUuid(environmentId)) return errorResponse('environment_id must be a valid UUID');
    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, environmentId, 'group', 'read');

    const groups = await query<{ id: string; parent_group_id: string | null; parent_id: string | null; name: string; description: string | null; environment_id: string; policy_id: string | null; created_at: string }>(
      `SELECT g.id, g.environment_id, g.parent_group_id, g.parent_group_id AS parent_id, g.name, g.description, g.created_at, g.updated_at,
              pa.policy_id
       FROM groups g
       LEFT JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = g.id
       WHERE g.environment_id = $1
         ${envScope.mode === 'group' ? 'AND g.id = ANY($2::uuid[])' : ''}
       ORDER BY g.name`,
      envScope.mode === 'group'
        ? [environmentId, envScope.accessible_group_ids ?? []]
        : [environmentId]
    );

    const groupsForView = envScope.mode === 'group'
      ? (() => {
          const visible = new Set((envScope.accessible_group_ids ?? []));
          return groups.map((g) => (
            visible.has(g.parent_group_id ?? '')
              ? g
              : { ...g, parent_group_id: null, parent_id: null }
          ));
        })()
      : groups;

    const nested = buildNestedGroupList(groupsForView);
    return jsonResponse({ groups: nested });
  }

  // POST /api/groups/bulk
  if (request.method === 'POST' && action === 'bulk') {
    const body = await parseJsonBody<GroupsBulkBody>(request);
    const environmentId = body.environment_id;
    const operation = body.operation;
    const selection = body.selection;
    if (!environmentId) return errorResponse('environment_id is required');
    if (!operation) return errorResponse('operation is required');
    if (!selection) return errorResponse('selection is required');
    if (!isValidUuid(environmentId)) return errorResponse('environment_id must be a valid UUID');
    await requireEnvironmentResourcePermission(auth, environmentId, 'group', operation === 'delete' ? 'delete' : 'write');

    const excludedIds = Array.from(new Set((selection.excluded_ids ?? []).filter(Boolean)));
    if (excludedIds.length > 0 && !excludedIds.every(isValidUuid)) {
      return errorResponse('selection.excluded_ids must contain valid UUIDs');
    }
    const excludedIdSet = new Set(excludedIds);

    let targetIds: string[] = [];
    if (selection.all_matching) {
      const rows = await query<{ id: string }>(
        'SELECT id FROM groups WHERE environment_id = $1',
        [environmentId]
      );
      targetIds = rows
        .map((r) => r.id)
        .filter((id) => !excludedIdSet.has(id));
    } else {
      targetIds = Array.from(new Set((selection.ids ?? []).filter(Boolean)));
      if (targetIds.length === 0) return errorResponse('selection.ids must include at least one id');
      if (!targetIds.every(isValidUuid)) return errorResponse('selection.ids must contain valid UUIDs');
    }

    if (operation === 'delete') {
      const roots: string[] = [];
      for (const id of targetIds) {
        const hasSelectedAncestor = await queryOne<{ exists: number }>(
          `SELECT 1 as exists
           FROM group_closures
           WHERE descendant_id = $1
             AND ancestor_id <> $1
             AND ancestor_id = ANY($2::uuid[])
           LIMIT 1`,
          [id, targetIds]
        );
        if (!hasSelectedAncestor) roots.push(id);
      }

      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      const covered = new Set<string>();
      for (const rootId of roots) {
        try {
          const descendantRows = await query<{ descendant_id: string }>(
            'SELECT descendant_id FROM group_closures WHERE ancestor_id = $1',
            [rootId]
          );
          descendantRows.forEach((d) => covered.add(d.descendant_id));
          await performGroupDelete(auth, request, rootId);
          results.push({ id: rootId, ok: true });
        } catch (err) {
          results.push({ id: rootId, ok: false, error: await groupOperationError(err) });
        }
      }

      // Mark descendants covered by selected roots as successful no-ops for transparent reporting.
      for (const id of targetIds) {
        if (results.some((r) => r.id === id)) continue;
        if (covered.has(id)) {
          results.push({ id, ok: true });
        }
      }

      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.length - succeeded;
      return jsonResponse({
        total_targeted: results.length,
        succeeded,
        failed,
        results,
      });
    }

    if (operation === 'move') {
      const targetParentId = body.options?.target_parent_id ?? null;
      const clearDirectAssignments = body.options?.clear_direct_assignments === true;
      if (targetParentId && !isValidUuid(targetParentId)) {
        return errorResponse('options.target_parent_id must be a valid UUID');
      }

      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const groupId of targetIds) {
        try {
          await performGroupMove(auth, request, {
            groupId,
            targetParentId,
            clearDirectAssignments,
            expectedEnvironmentId: environmentId,
          });
          results.push({ id: groupId, ok: true });
        } catch (err) {
          results.push({ id: groupId, ok: false, error: await groupOperationError(err) });
        }
      }

      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.length - succeeded;
      return jsonResponse({
        total_targeted: results.length,
        succeeded,
        failed,
        results,
      });
    }

    return errorResponse(`Unsupported operation: ${operation}`, 400);
  }

  // GET /api/groups/descendants?group_id=...
  if (request.method === 'GET' && action === 'descendants') {
    const params = getSearchParams(request);
    const groupId = params.get('group_id');
    if (!groupId) return errorResponse('group_id is required');
    if (!isValidUuid(groupId)) return errorResponse('group_id must be a valid UUID');

    const groupForAccess = await queryOne<{ environment_id: string }>('SELECT environment_id FROM groups WHERE id = $1', [groupId]);
    if (!groupForAccess) return errorResponse('Group not found', 404);
    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, groupForAccess.environment_id, 'group', 'read');
    if (envScope.mode === 'group' && !(envScope.accessible_group_ids ?? []).includes(groupId)) {
      return errorResponse('Forbidden: no access to this group', 403);
    }

    const descendants = await query(
      `SELECT g.id, g.name, g.parent_group_id, g.parent_group_id AS parent_id, gc.depth
       FROM group_closures gc
       JOIN groups g ON g.id = gc.descendant_id
       WHERE gc.ancestor_id = $1 AND gc.depth > 0
         ${envScope.mode === 'group' ? 'AND g.id = ANY($2::uuid[])' : ''}
       ORDER BY gc.depth, g.name`,
      envScope.mode === 'group'
        ? [groupId, envScope.accessible_group_ids ?? []]
        : [groupId]
    );

    return jsonResponse({ groups: descendants, descendants });
  }

  // POST /api/groups/create
  if (request.method === 'POST' && action === 'create') {
    const body = await parseJsonBody<{
      environment_id: string; name: string; description?: string; parent_group_id?: string; parent_id?: string;
    }>(request);

    if (!body.environment_id || !body.name) {
      return errorResponse('environment_id and name are required');
    }
    if (!isValidUuid(body.environment_id)) return errorResponse('environment_id must be a valid UUID');
    await requireEnvironmentResourcePermission(auth, body.environment_id, 'group', 'write');

    const parentGroupId = body.parent_group_id ?? body.parent_id ?? null;
    if (parentGroupId && !isValidUuid(parentGroupId)) return errorResponse('parent_group_id must be a valid UUID');
    if (parentGroupId) {
      const parentGroup = await queryOne<{ environment_id: string }>(
        'SELECT environment_id FROM groups WHERE id = $1',
        [parentGroupId]
      );
      if (!parentGroup) return errorResponse('Parent group not found', 404);
      if (parentGroup.environment_id !== body.environment_id) {
        return errorResponse('Parent group must be in the same environment', 400);
      }
    }

    const groupId = crypto.randomUUID();

    await transaction(async (client) => {
      // Create group
      const workspace = (await client.query('SELECT workspace_id FROM environments WHERE id = $1', [body.environment_id])).rows[0];
      if (!workspace) throw errorResponse('Environment no longer exists', 409);
      await lockMembershipWorkspaces(client, [workspace.workspace_id]);
      await requireGroupCreationScope(client,auth,body.environment_id,parentGroupId);
      await client.query(
        `INSERT INTO groups (id, environment_id, parent_group_id, name, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [groupId, body.environment_id, parentGroupId, body.name, body.description ?? null]
      );

      // Closure table: self-link (depth = 0)
      await client.query(
        'INSERT INTO group_closures (ancestor_id, descendant_id, depth) VALUES ($1, $2, 0)',
        [groupId, groupId]
      );

      // Closure table: link to all ancestors of parent
      // Port of bdm_core Group::booted() closure table logic
      if (parentGroupId) {
        const ancestors = await client.query(
          'SELECT ancestor_id, depth FROM group_closures WHERE descendant_id = $1',
          [parentGroupId]
        );

        for (const ancestor of ancestors.rows) {
          await client.query(
            'INSERT INTO group_closures (ancestor_id, descendant_id, depth) VALUES ($1, $2, $3)',
            [ancestor.ancestor_id, groupId, ancestor.depth + 1]
          );
        }
      }

      // API keys are principals, not human creator memberships.
      if (auth.authType === 'session') await client.query(
        `INSERT INTO group_memberships (group_id, user_id, role, permissions)
         SELECT $1::uuid, $2::uuid, 'admin', $3::jsonb WHERE EXISTS (
           SELECT 1 FROM workspace_memberships wm JOIN environments e ON e.workspace_id = wm.workspace_id
           JOIN groups g ON g.environment_id = e.id WHERE g.id = $1 AND wm.user_id = $2)`,
        [groupId, auth.user.id, JSON.stringify({ devices: true, policies: true, apps: true, reports: true, settings: true, users: true })]
      );
      await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'group.created',
      resource_type: 'group',
      resource_id: groupId,
      details: { name: body.name, parent_group_id: parentGroupId },
      ip_address: getClientIp(request),
      },client);
    });

    return jsonResponse({
      group: {
        id: groupId,
        name: body.name,
        environment_id: body.environment_id,
        parent_group_id: parentGroupId,
        parent_id: parentGroupId,
      }
    }, 201);
  }

  // PUT /api/groups/update
  if (request.method === 'PUT' && action === 'update') {
    const body = await parseJsonBody<{
      id: string;
      name?: string;
      description?: string;
      parent_group_id?: string | null;
      parent_id?: string | null;
    }>(request);
    if (!body.id) return errorResponse('Group ID is required');
    if (!isValidUuid(body.id)) return errorResponse('id must be a valid UUID');

    const groupToUpdate = await queryOne<{ environment_id: string; parent_group_id: string | null }>(
      'SELECT environment_id, parent_group_id FROM groups WHERE id = $1',
      [body.id]
    );
    if (!groupToUpdate) return errorResponse('Group not found', 404);
    await requireEnvironmentResourcePermission(auth, groupToUpdate.environment_id, 'group', 'write');

    const parentFieldProvided = Object.prototype.hasOwnProperty.call(body, 'parent_group_id')
      || Object.prototype.hasOwnProperty.call(body, 'parent_id');
    const requestedParentId = parentFieldProvided
      ? (body.parent_group_id ?? body.parent_id ?? null)
      : undefined;
    if (requestedParentId && !isValidUuid(requestedParentId)) {
      return errorResponse('parent_group_id must be a valid UUID');
    }
    const parentChanged = requestedParentId !== undefined && requestedParentId !== groupToUpdate.parent_group_id;

    if (parentChanged && requestedParentId === body.id) {
      return errorResponse('A group cannot be its own parent', 400);
    }

    if (parentChanged && requestedParentId) {
      const requestedParent = await queryOne<{ id: string; environment_id: string }>(
        'SELECT id, environment_id FROM groups WHERE id = $1',
        [requestedParentId]
      );
      if (!requestedParent) return errorResponse('Parent group not found', 404);
      if (requestedParent.environment_id !== groupToUpdate.environment_id) {
        return errorResponse('Parent group must be in the same environment', 400);
      }

      const wouldCreateCycle = await queryOne<{ exists: number }>(
        `SELECT 1 as exists
         FROM group_closures
         WHERE ancestor_id = $1 AND descendant_id = $2`,
        [body.id, requestedParentId]
      );
      if (wouldCreateCycle) {
        return errorResponse('Cannot move a group under one of its descendants', 400);
      }
    }

    const result = await updateGroupLifecycle({auth,groupId:body.id,parentId:requestedParentId,name:body.name,description:body.description,ip:getClientIp(request)});
    if(result.affected_devices)await wakePolicyReconciliation();

    return jsonResponse({ message: 'Group updated', policy_reconciliation: result.affected_devices ? 'queued' : 'not_required', affected_devices: result.affected_devices });
  }

  // DELETE /api/groups/:id
  if (request.method === 'DELETE' && action) {
    if (!isValidUuid(action)) return errorResponse('group_id must be a valid UUID');
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM groups WHERE id = $1',
      [action]
    );
    if (!existing) return errorResponse('Group not found', 404);

    await performGroupDelete(auth, request, action);
    return jsonResponse({ message: 'Group and descendants deleted' });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('group-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};

async function performGroupMove(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  request: Request,
  input: {
    groupId: string;
    targetParentId: string | null;
    clearDirectAssignments: boolean;
    expectedEnvironmentId?: string;
  }
): Promise<void> {
  const { groupId, targetParentId, clearDirectAssignments, expectedEnvironmentId } = input;
  if (!isValidUuid(groupId)) throw new Error('group_id must be a valid UUID');
  if (targetParentId && !isValidUuid(targetParentId)) throw new Error('target_parent_id must be a valid UUID');

  const groupToUpdate = await queryOne<{ id: string; environment_id: string; parent_group_id: string | null }>(
    'SELECT id, environment_id, parent_group_id FROM groups WHERE id = $1',
    [groupId]
  );
  if (!groupToUpdate) throw new Error('Group not found');
  if (expectedEnvironmentId && groupToUpdate.environment_id !== expectedEnvironmentId) {
    throw new Error('Group is outside selected environment');
  }
  await requireEnvironmentResourcePermission(auth, groupToUpdate.environment_id, 'group', 'write');

  if (targetParentId === groupId) throw new Error('A group cannot be its own parent');
  if (targetParentId) {
    const requestedParent = await queryOne<{ id: string; environment_id: string }>(
      'SELECT id, environment_id FROM groups WHERE id = $1',
      [targetParentId]
    );
    if (!requestedParent) throw new Error('Parent group not found');
    if (requestedParent.environment_id !== groupToUpdate.environment_id) {
      throw new Error('Parent group must be in the same environment');
    }
    const wouldCreateCycle = await queryOne<{ exists: number }>(
      `SELECT 1 as exists
       FROM group_closures
       WHERE ancestor_id = $1 AND descendant_id = $2`,
      [groupId, targetParentId]
    );
    if (wouldCreateCycle) throw new Error('Cannot move a group under one of its descendants');
  }

  const result=await updateGroupLifecycle({auth,groupId,parentId:targetParentId,clearDirectAssignments,ip:getClientIp(request)});
  if(result.affected_devices)await wakePolicyReconciliation();
}

async function performGroupDelete(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  request: Request,
  groupId: string
): Promise<void> {
  if (!isValidUuid(groupId)) throw new Error('group_id must be a valid UUID');
  const groupToDelete = await queryOne<{ environment_id: string }>('SELECT environment_id FROM groups WHERE id = $1', [groupId]);
  if (!groupToDelete) throw new Error('Group not found');
  await requireEnvironmentResourcePermission(auth, groupToDelete.environment_id, 'group', 'delete');

  const result=await deleteGroupLifecycle({auth,groupId,ip:getClientIp(request)});
  if(result.affected_devices)await wakePolicyReconciliation();
}

async function groupOperationError(error:unknown) {
  if(error instanceof Response) {try {return (await error.json()).error??'Group operation was rejected';}catch{return 'Group operation was rejected';}}
  if(error&&typeof error==='object'&&'code' in error)return 'Group operation failed; no local changes were committed. Review related records.';
  return error instanceof Error?error.message:'Group operation failed';
}
