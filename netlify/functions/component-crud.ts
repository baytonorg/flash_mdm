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

  // GET /api/components/list?environment_id=...
  if (request.method === 'GET' && action === 'list') {
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');
    await requireEnvironmentResourcePermission(auth, environmentId, 'policy', 'read');

    const components = await query(
      `SELECT id, environment_id, name, description, category, config_fragment, created_at, updated_at
       FROM policy_components
       WHERE environment_id = $1
       ORDER BY category, name`,
      [environmentId]
    );

    return jsonResponse({ components });
  }

  // GET /api/components/:id (but not 'list', 'create', 'update', 'assign', 'unassign', 'policy')
  if (request.method === 'GET' && action && !['list', 'create', 'update', 'assign', 'unassign', 'policy'].includes(action)) {
    const component = await queryOne<{ id: string; environment_id: string; name: string; description: string | null; category: string; config_fragment: Record<string, unknown>; created_at: string; updated_at: string }>(
      `SELECT id, environment_id, name, description, category, config_fragment, created_at, updated_at
       FROM policy_components
       WHERE id = $1`,
      [action]
    );
    if (!component) return errorResponse('Component not found', 404);
    await requireEnvironmentResourcePermission(auth, component.environment_id, 'policy', 'read');

    return jsonResponse({ component });
  }

  // POST /api/components/create
  if (request.method === 'POST' && action === 'create') {
    const body = await parseJsonBody<{
      environment_id: string;
      name: string;
      description?: string;
      category: string;
      config_fragment: Record<string, unknown>;
    }>(request);

    if (!body.environment_id || !body.name || !body.category || !body.config_fragment) {
      return errorResponse('environment_id, name, category, and config_fragment are required');
    }
    await requireEnvironmentResourcePermission(auth, body.environment_id, 'policy', 'write');

    const id = crypto.randomUUID();

    await execute(
      `INSERT INTO policy_components (id, environment_id, name, description, category, config_fragment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, body.environment_id, body.name, body.description ?? null, body.category, JSON.stringify(body.config_fragment)]
    );

    await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'component.created',
      resource_type: 'policy_component',
      resource_id: id,
      details: { name: body.name, category: body.category },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      component: {
        id,
        environment_id: body.environment_id,
        name: body.name,
        description: body.description ?? null,
        category: body.category,
        config_fragment: body.config_fragment,
      },
    }, 201);
  }

  // PUT /api/components/update
  if (request.method === 'PUT' && action === 'update') {
    const body = await parseJsonBody<{
      id: string;
      name?: string;
      description?: string;
      category?: string;
      config_fragment?: Record<string, unknown>;
    }>(request);

    if (!body.id) return errorResponse('Component ID is required');

    const existing = await queryOne<{ id: string; environment_id: string }>(
      'SELECT id, environment_id FROM policy_components WHERE id = $1',
      [body.id]
    );
    if (!existing) return errorResponse('Component not found', 404);
    await requireEnvironmentResourcePermission(auth, existing.environment_id, 'policy', 'write');

    await execute(
      `UPDATE policy_components SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         category = COALESCE($3, category),
         config_fragment = COALESCE($4, config_fragment),
         updated_at = now()
       WHERE id = $5`,
      [
        body.name ?? null,
        body.description ?? null,
        body.category ?? null,
        body.config_fragment ? JSON.stringify(body.config_fragment) : null,
        body.id,
      ]
    );

    await logAudit({
      environment_id: existing.environment_id,
      user_id: auth.user.id,
      action: 'component.updated',
      resource_type: 'policy_component',
      resource_id: body.id,
      details: { name: body.name, category: body.category },
      ip_address: getClientIp(request),
    });

    // Recompile all policies using this component
    if (body.config_fragment) {
      const affectedPolicies = await query<{ policy_id: string }>(
        'SELECT DISTINCT policy_id FROM policy_component_assignments WHERE component_id = $1',
        [body.id]
      );
      const recompileErrors: string[] = [];
      for (const { policy_id } of affectedPolicies) {
        try {
          await recompilePolicy(policy_id, auth.user.id);
        } catch (err) {
          recompileErrors.push(policy_id);
        }
      }
      if (recompileErrors.length > 0) {
        return jsonResponse({
          message: 'Component updated but some policies failed to recompile',
          failed_policy_ids: recompileErrors,
        });
      }
    }

    return jsonResponse({ message: 'Component updated' });
  }

  // DELETE /api/components/:id
  if (request.method === 'DELETE' && action && !['list', 'create', 'update', 'assign', 'unassign', 'policy'].includes(action)) {
    const component = await queryOne<{ id: string; environment_id: string; name: string }>(
      'SELECT id, environment_id, name FROM policy_components WHERE id = $1',
      [action]
    );
    if (!component) return errorResponse('Component not found', 404);
    await requireEnvironmentResourcePermission(auth, component.environment_id, 'policy', 'write');

    // Get affected policies before removing assignments
    const affectedPolicies = await query<{ policy_id: string }>(
      'SELECT DISTINCT policy_id FROM policy_component_assignments WHERE component_id = $1',
      [action]
    );

    // Remove all assignments, then the component
    await execute('DELETE FROM policy_component_assignments WHERE component_id = $1', [action]);
    await execute('DELETE FROM policy_components WHERE id = $1', [action]);

    // Recompile affected policies (component is now removed from the merge)
    for (const { policy_id } of affectedPolicies) {
      try {
        await recompilePolicy(policy_id, auth.user.id);
      } catch {
        // Best effort — policy will be recompiled on next save/component change
      }
    }

    await logAudit({
      environment_id: component.environment_id,
      user_id: auth.user.id,
      action: 'component.deleted',
      resource_type: 'policy_component',
      resource_id: action,
      details: { name: component.name },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Component deleted' });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('component-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
