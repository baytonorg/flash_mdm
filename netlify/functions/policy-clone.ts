import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  const auth = await requireAuth(request);
  const url = new URL(request.url);
  const segments = url.pathname.replace('/api/policies/', '').split('/').filter(Boolean);
  const action = segments[0];

  // POST /api/policies/clone
  if (request.method === 'POST' && action === 'clone') {
    const body = await parseJsonBody<{
      policy_id: string;
      new_name: string;
    }>(request);

    if (!body.policy_id || !body.new_name) {
      return errorResponse('policy_id and new_name are required');
    }

    // Fetch existing policy
    const existing = await queryOne<{
      id: string;
      environment_id: string;
      name: string;
      description: string | null;
      deployment_scenario: string;
      config: Record<string, unknown>;
    }>(
      'SELECT id, environment_id, name, description, deployment_scenario, config FROM policies WHERE id = $1',
      [body.policy_id]
    );
    if (!existing) return errorResponse('Source policy not found', 404);
    await requireEnvironmentResourcePermission(auth, existing.environment_id, 'policy', 'write');

    const newId = crypto.randomUUID();
    const configStr = typeof existing.config === 'string'
      ? existing.config
      : JSON.stringify(existing.config ?? {});

    await transaction(async (client) => {
      // Create new policy in draft status
      await client.query(
        `INSERT INTO policies (id, environment_id, name, description, deployment_scenario, config, status, version)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', 1)`,
        [newId, existing.environment_id, body.new_name, existing.description, existing.deployment_scenario, configStr]
      );

      // Store initial version
      await client.query(
        `INSERT INTO policy_versions (policy_id, version, config, changed_by, change_summary)
         VALUES ($1, 1, $2, $3, $4)`,
        [newId, configStr, auth.user.id, `Cloned from "${existing.name}"`]
      );

      // Copy component assignments
      const assignments = await client.query(
        'SELECT component_id, priority FROM policy_component_assignments WHERE policy_id = $1',
        [body.policy_id]
      );

      for (const row of assignments.rows) {
        await client.query(
          'INSERT INTO policy_component_assignments (policy_id, component_id, priority) VALUES ($1, $2, $3)',
          [newId, row.component_id, row.priority]
        );
      }
    });

    await logAudit({
      environment_id: existing.environment_id,
      user_id: auth.user.id,
      action: 'policy.cloned',
      resource_type: 'policy',
      resource_id: newId,
      details: { source_policy_id: body.policy_id, source_name: existing.name, new_name: body.new_name },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      policy: {
        id: newId,
        environment_id: existing.environment_id,
        name: body.new_name,
        status: 'draft',
        version: 1,
      },
    }, 201);
  }

  return errorResponse('Not found', 404);
};
