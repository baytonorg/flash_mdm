import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { recompilePolicy } from './_lib/policy-recompile.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/components/', '').split('/').filter(Boolean);
    const action = segments[0];

  // POST /api/components/assign
  if (request.method === 'POST' && action === 'assign') {
    const body = await parseJsonBody<{
      policy_id: string;
      component_id: string;
      priority?: number;
    }>(request);

    if (!body.policy_id || !body.component_id) {
      return errorResponse('policy_id and component_id are required');
    }

    // Verify policy exists
    const policy = await queryOne<{ id: string; environment_id: string }>(
      'SELECT id, environment_id FROM policies WHERE id = $1',
      [body.policy_id]
    );
    if (!policy) return errorResponse('Policy not found', 404);
    await requireEnvironmentResourcePermission(auth, policy.environment_id, 'policy', 'write');

    // Verify component exists
    const component = await queryOne<{ id: string; name: string; environment_id: string }>(
      'SELECT id, name, environment_id FROM policy_components WHERE id = $1',
      [body.component_id]
    );
    if (!component) return errorResponse('Component not found', 404);
    if (component.environment_id !== policy.environment_id) {
      return errorResponse('Component does not belong to this policy environment', 400);
    }

    // Check for existing assignment
    const existing = await queryOne(
      'SELECT id FROM policy_component_assignments WHERE policy_id = $1 AND component_id = $2',
      [body.policy_id, body.component_id]
    );
    if (existing) return errorResponse('Component is already assigned to this policy', 409);

    // Determine priority: use provided or max+1
    let priority = body.priority;
    if (priority === undefined) {
      const maxPriority = await queryOne<{ max_p: number }>(
        'SELECT COALESCE(MAX(priority), 0) as max_p FROM policy_component_assignments WHERE policy_id = $1',
        [body.policy_id]
      );
      priority = (maxPriority?.max_p ?? 0) + 1;
    }

    await execute(
      `INSERT INTO policy_component_assignments (policy_id, component_id, priority)
       VALUES ($1, $2, $3)`,
      [body.policy_id, body.component_id, priority]
    );

    // Recompile the policy
    await recompilePolicy(body.policy_id, auth.user.id);

    await logAudit({
      environment_id: policy.environment_id,
      user_id: auth.user.id,
      action: 'component.assigned',
      resource_type: 'policy',
      resource_id: body.policy_id,
      details: { component_id: body.component_id, component_name: component.name, priority },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Component assigned and policy recompiled' });
  }

  // POST /api/components/unassign
  if (request.method === 'POST' && action === 'unassign') {
    const body = await parseJsonBody<{
      policy_id: string;
      component_id: string;
    }>(request);

    if (!body.policy_id || !body.component_id) {
      return errorResponse('policy_id and component_id are required');
    }

    // Verify policy exists
    const policy = await queryOne<{ id: string; environment_id: string }>(
      'SELECT id, environment_id FROM policies WHERE id = $1',
      [body.policy_id]
    );
    if (!policy) return errorResponse('Policy not found', 404);
    await requireEnvironmentResourcePermission(auth, policy.environment_id, 'policy', 'write');

    const component = await queryOne<{ id: string; environment_id: string }>(
      'SELECT id, environment_id FROM policy_components WHERE id = $1',
      [body.component_id]
    );
    if (!component) return errorResponse('Component not found', 404);
    if (component.environment_id !== policy.environment_id) {
      return errorResponse('Component does not belong to this policy environment', 400);
    }

    const result = await execute(
      'DELETE FROM policy_component_assignments WHERE policy_id = $1 AND component_id = $2',
      [body.policy_id, body.component_id]
    );

    if (result.rowCount === 0) {
      return errorResponse('Assignment not found', 404);
    }

    // Recompile the policy
    await recompilePolicy(body.policy_id, auth.user.id);

    await logAudit({
      environment_id: policy.environment_id,
      user_id: auth.user.id,
      action: 'component.unassigned',
      resource_type: 'policy',
      resource_id: body.policy_id,
      details: { component_id: body.component_id },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Component unassigned and policy recompiled' });
  }

  // GET /api/components/policy/:policy_id
  if (request.method === 'GET' && action === 'policy') {
    const policyId = segments[1];
    if (!policyId) return errorResponse('policy_id is required');

    const policy = await queryOne<{ environment_id: string }>(
      'SELECT environment_id FROM policies WHERE id = $1',
      [policyId]
    );
    if (!policy) return errorResponse('Policy not found', 404);
    await requireEnvironmentResourcePermission(auth, policy.environment_id, 'policy', 'read');

    const assignments = await query(
      `SELECT pca.id as assignment_id, pca.priority, pca.created_at as assigned_at,
              pc.id, pc.name, pc.description, pc.category, pc.config_fragment
       FROM policy_component_assignments pca
       JOIN policy_components pc ON pc.id = pca.component_id
       WHERE pca.policy_id = $1
       ORDER BY pca.priority ASC`,
      [policyId]
    );

    return jsonResponse({ assignments });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('component-assign error:', err);
    return errorResponse('Internal server error', 500);
  }
};
