import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  requireEnvironmentAccessScopeForResourcePermission,
  requireEnvironmentResourcePermission,
} from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { AmapiPolicyValidationError, assertValidAmapiPolicyPayload } from './_lib/amapi-policy-validation.js';
import { logAudit } from './_lib/audit.js';
import { storeBlob } from './_lib/blobs.js';
import { buildPolicyUpdateMask } from './_lib/policy-update-mask.js';
import { sanitizeConfig } from './_lib/policy-recompile.js';
import { buildGeneratedPolicyPayload } from './_lib/policy-generation.js';
import { syncPolicyDerivativesForPolicy, getPolicyAmapiContext } from './_lib/policy-derivatives.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams, isValidUuid } from './_lib/helpers.js';

type BulkSelection = {
  ids?: string[];
  all_matching?: boolean;
  excluded_ids?: string[];
  filters?: {
    status?: string;
    scenario?: string;
    search?: string;
  };
};

type PolicyBulkBody = {
  environment_id?: string;
  operation?: 'copy' | 'delete' | 'set_draft' | 'set_production' | 'push_to_amapi';
  selection?: BulkSelection;
  options?: {
    copy_name_prefix?: string;
  };
};

async function canViewPolicyInScopedEnvironment(
  policyId: string,
  environmentId: string,
  accessibleGroupIds: string[]
): Promise<boolean> {
  if (accessibleGroupIds.length === 0) return false;

  const row = await queryOne<{ visible: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM policies p
       WHERE p.id = $1
         AND p.environment_id = $2
         AND (
           EXISTS (
             SELECT 1
             FROM policy_assignments pa
             WHERE pa.policy_id = p.id
               AND pa.scope_type = 'environment'
               AND pa.scope_id = $2::uuid
           )
           OR EXISTS (
             SELECT 1
             FROM policy_assignments pa
             JOIN groups g_assigned ON g_assigned.id = pa.scope_id
             JOIN group_closures gc ON gc.ancestor_id = g_assigned.id
             WHERE pa.policy_id = p.id
               AND pa.scope_type = 'group'
               AND g_assigned.environment_id = $2
               AND gc.descendant_id = ANY($3::uuid[])
           )
           OR EXISTS (
             SELECT 1
             FROM policy_assignments pa
             JOIN devices d ON d.id = pa.scope_id
             WHERE pa.policy_id = p.id
               AND pa.scope_type = 'device'
               AND d.environment_id = $2
               AND d.deleted_at IS NULL
               AND d.group_id = ANY($3::uuid[])
           )
           OR EXISTS (
             SELECT 1
             FROM devices d
             WHERE d.policy_id = p.id
               AND d.environment_id = $2
               AND d.deleted_at IS NULL
               AND d.group_id = ANY($3::uuid[])
           )
         )
     ) AS visible`,
    [policyId, environmentId, accessibleGroupIds]
  );

  return row?.visible === true;
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const segments = url.pathname.replace('/api/policies/', '').split('/').filter(Boolean);
  const action = segments[0];
  const requestId = context?.requestId ?? crypto.randomUUID();
  try {
    const auth = await requireAuth(request);

  // GET /api/policies/list?environment_id=...
  if (request.method === 'GET' && action === 'list') {
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');
    if (!isValidUuid(environmentId)) return errorResponse('environment_id must be a valid UUID');
    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, environmentId, 'policy', 'read');

    const policies = envScope.mode === 'group'
      ? await query(
          `SELECT p.id, p.name, p.description, p.deployment_scenario, p.status, p.version, p.amapi_name, p.created_at, p.updated_at,
             (
               SELECT COUNT(*)::int FROM devices d
               LEFT JOIN LATERAL (
                 SELECT pa.policy_id FROM policy_assignments pa
                 WHERE pa.scope_type = 'device' AND pa.scope_id = d.id LIMIT 1
               ) dpa ON TRUE
               LEFT JOIN LATERAL (
                 SELECT pa.policy_id FROM group_closures gc
                 JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
                 WHERE d.group_id IS NOT NULL AND gc.descendant_id = d.group_id
                 ORDER BY gc.depth ASC LIMIT 1
               ) gpa ON TRUE
               LEFT JOIN LATERAL (
                 SELECT pa.policy_id FROM policy_assignments pa
                 WHERE pa.scope_type = 'environment' AND pa.scope_id = d.environment_id LIMIT 1
               ) epa ON TRUE
               WHERE d.environment_id = $1
                 AND d.deleted_at IS NULL
                 AND COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id) = p.id
             ) AS device_count
           FROM policies p
           WHERE p.environment_id = $1
             AND (
               EXISTS (
                 SELECT 1
                 FROM policy_assignments pa
                 WHERE pa.policy_id = p.id
                   AND pa.scope_type = 'environment'
                   AND pa.scope_id = $1::uuid
               )
               OR EXISTS (
                 SELECT 1
                 FROM policy_assignments pa
                 JOIN groups g_assigned ON g_assigned.id = pa.scope_id
                 JOIN group_closures gc ON gc.ancestor_id = g_assigned.id
                 WHERE pa.policy_id = p.id
                   AND pa.scope_type = 'group'
                   AND g_assigned.environment_id = $1
                   AND gc.descendant_id = ANY($2::uuid[])
               )
               OR EXISTS (
                 SELECT 1
                 FROM policy_assignments pa
                 JOIN devices d_assign ON d_assign.id = pa.scope_id
                 WHERE pa.policy_id = p.id
                   AND pa.scope_type = 'device'
                   AND d_assign.environment_id = $1
                   AND d_assign.deleted_at IS NULL
                   AND d_assign.group_id = ANY($2::uuid[])
               )
               OR EXISTS (
                 SELECT 1
                 FROM devices d
                 WHERE d.policy_id = p.id
                   AND d.environment_id = $1
                   AND d.deleted_at IS NULL
                   AND d.group_id = ANY($2::uuid[])
               )
             )
           ORDER BY p.name`,
          [environmentId, envScope.accessible_group_ids ?? []]
        )
      : await query(
          `SELECT p.id, p.name, p.description, p.deployment_scenario, p.status, p.version, p.amapi_name, p.created_at, p.updated_at,
             (
               SELECT COUNT(*)::int FROM devices d
               LEFT JOIN LATERAL (
                 SELECT pa.policy_id FROM policy_assignments pa
                 WHERE pa.scope_type = 'device' AND pa.scope_id = d.id LIMIT 1
               ) dpa ON TRUE
               LEFT JOIN LATERAL (
                 SELECT pa.policy_id FROM group_closures gc
                 JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
                 WHERE d.group_id IS NOT NULL AND gc.descendant_id = d.group_id
                 ORDER BY gc.depth ASC LIMIT 1
               ) gpa ON TRUE
               LEFT JOIN LATERAL (
                 SELECT pa.policy_id FROM policy_assignments pa
                 WHERE pa.scope_type = 'environment' AND pa.scope_id = d.environment_id LIMIT 1
               ) epa ON TRUE
               WHERE d.environment_id = $1
                 AND d.deleted_at IS NULL
                 AND COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id) = p.id
             ) AS device_count
           FROM policies p WHERE p.environment_id = $1 ORDER BY p.name`,
          [environmentId]
        );

    return jsonResponse({ policies });
  }

  // POST /api/policies/bulk
  if (request.method === 'POST' && action === 'bulk') {
    const body = await parseJsonBody<PolicyBulkBody>(request);
    const operation = body.operation;
    const environmentId = body.environment_id;
    const selection = body.selection;
    if (!operation) return errorResponse('operation is required');
    if (!environmentId) return errorResponse('environment_id is required');
    if (!selection) return errorResponse('selection is required');
    if (!isValidUuid(environmentId)) return errorResponse('environment_id must be a valid UUID');
    await requireEnvironmentResourcePermission(
      auth,
      environmentId,
      'policy',
      operation === 'delete' ? 'delete' : 'write'
    );

    const excludedIds = Array.from(new Set((selection.excluded_ids ?? []).filter(Boolean)));
    if (excludedIds.length > 0 && !excludedIds.every(isValidUuid)) {
      return errorResponse('selection.excluded_ids must contain valid UUIDs');
    }
    const excludedIdSet = new Set(excludedIds);

    let targetIds: string[] = [];
    if (selection.all_matching) {
      const filters = selection.filters ?? {};
      const where: string[] = ['environment_id = $1'];
      const values: unknown[] = [environmentId];
      let idx = 2;
      if (filters.status && filters.status !== 'all') {
        where.push(`status = $${idx++}`);
        values.push(filters.status);
      }
      if (filters.scenario && filters.scenario !== 'all') {
        where.push(`deployment_scenario = $${idx++}`);
        values.push(filters.scenario);
      }
      if (filters.search?.trim()) {
        where.push(`(name ILIKE $${idx} OR COALESCE(description, '') ILIKE $${idx})`);
        values.push(`%${filters.search.trim()}%`);
        idx += 1;
      }
      const rows = await query<{ id: string }>(
        `SELECT id FROM policies WHERE ${where.join(' AND ')}`,
        values
      );
      targetIds = rows
        .map((r) => r.id)
        .filter((id) => !excludedIdSet.has(id));
    } else {
      targetIds = Array.from(new Set((selection.ids ?? []).filter(Boolean)));
      if (targetIds.length === 0) return errorResponse('selection.ids must include at least one id');
      if (!targetIds.every(isValidUuid)) return errorResponse('selection.ids must contain valid UUIDs');
    }

    const results: Array<{ id: string; ok: boolean; error?: string; new_id?: string; new_name?: string }> = [];
    const copyPrefix = body.options?.copy_name_prefix?.trim() || 'Copy of';

    for (const policyId of targetIds) {
      try {
        const policy = await queryOne<{
          id: string;
          environment_id: string;
          name: string;
          description: string | null;
          deployment_scenario: string;
          config: Record<string, unknown> | string | null;
          status: string;
          amapi_name: string | null;
        }>(
          'SELECT id, environment_id, name, description, deployment_scenario, config, status, amapi_name FROM policies WHERE id = $1',
          [policyId]
        );
        if (!policy) {
          results.push({ id: policyId, ok: false, error: 'Policy not found' });
          continue;
        }
        if (policy.environment_id !== environmentId) {
          results.push({ id: policyId, ok: false, error: 'Policy is outside selected environment' });
          continue;
        }
        if (policy.name === 'Default') {
          results.push({ id: policyId, ok: false, error: 'Default policy cannot be modified by this action' });
          continue;
        }

        if (operation === 'copy') {
          const newId = crypto.randomUUID();
          const newName = `${copyPrefix} ${policy.name}`;
          const configStr = typeof policy.config === 'string'
            ? policy.config
            : JSON.stringify(policy.config ?? {});
          await transaction(async (client) => {
            await client.query(
              `INSERT INTO policies (id, environment_id, name, description, deployment_scenario, config, status, version)
               VALUES ($1, $2, $3, $4, $5, $6, 'draft', 1)`,
              [newId, policy.environment_id, newName, policy.description, policy.deployment_scenario, configStr]
            );
            await client.query(
              `INSERT INTO policy_versions (policy_id, version, config, changed_by, change_summary)
               VALUES ($1, 1, $2, $3, $4)`,
              [newId, configStr, auth.user.id, `Cloned from "${policy.name}" (bulk)`]
            );
            const assignments = await client.query(
              'SELECT component_id, priority FROM policy_component_assignments WHERE policy_id = $1',
              [policy.id]
            );
            for (const row of assignments.rows) {
              await client.query(
                'INSERT INTO policy_component_assignments (policy_id, component_id, priority) VALUES ($1, $2, $3)',
                [newId, row.component_id, row.priority]
              );
            }
          });
          await logAudit({
            environment_id: policy.environment_id,
            user_id: auth.user.id,
            action: 'policy.cloned',
            resource_type: 'policy',
            resource_id: newId,
            details: { source_policy_id: policy.id, source_name: policy.name, new_name: newName, source: 'bulk' },
            ip_address: getClientIp(request),
          });
          results.push({ id: policyId, ok: true, new_id: newId, new_name: newName });
          continue;
        }

        if (operation === 'delete') {
          const deletion = await performPolicyDelete(auth, request, policy.id);
          if (!deletion.ok) {
            results.push({ id: policyId, ok: false, error: deletion.error });
          } else {
            results.push({ id: policyId, ok: true });
          }
          continue;
        }

        if (operation === 'set_draft') {
          await execute(
            `UPDATE policies
             SET status = 'draft', updated_at = now()
             WHERE id = $1`,
            [policy.id]
          );
          await logAudit({
            environment_id: policy.environment_id,
            user_id: auth.user.id,
            action: 'policy.updated',
            resource_type: 'policy',
            resource_id: policy.id,
            details: { status_changed_to: 'draft', source: 'bulk' },
            ip_address: getClientIp(request),
          });
          results.push({ id: policyId, ok: true });
          continue;
        }

        if (operation === 'set_production' || operation === 'push_to_amapi') {
          const pushResult = await pushPolicyToAmapi(auth, request, policy.id);
          if (!pushResult.ok) {
            results.push({ id: policyId, ok: false, error: pushResult.error });
          } else {
            results.push({ id: policyId, ok: true });
          }
          continue;
        }

        results.push({ id: policyId, ok: false, error: `Unsupported operation: ${operation}` });
      } catch (err) {
        results.push({ id: policyId, ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
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

  // GET /api/policies/external?environment_id=...&amapi_name=...
  if (request.method === 'GET' && action === 'external') {
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    const amapiName = params.get('amapi_name')?.trim();
    const deviceId = params.get('device_id')?.trim();

    if (!environmentId || !amapiName) {
      return errorResponse('environment_id and amapi_name are required');
    }
    if (!isValidUuid(environmentId)) {
      return errorResponse('environment_id must be a valid UUID');
    }
    if (deviceId && !isValidUuid(deviceId)) {
      return errorResponse('device_id must be a valid UUID');
    }
    if (!/^enterprises\/[^/]+\/policies\/[^/]+$/.test(amapiName)) {
      return errorResponse('amapi_name must look like enterprises/<id>/policies/<id>');
    }

    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, environmentId, 'policy', 'read');
    if (envScope.mode === 'group') {
      const accessibleGroupIds = envScope.accessible_group_ids ?? [];
      if (!deviceId) {
        return errorResponse('device_id is required for scoped group access', 403);
      }
      const visibleDevice = await queryOne<{ id: string }>(
        `SELECT id
         FROM devices
         WHERE id = $1
           AND environment_id = $2
           AND deleted_at IS NULL
           AND group_id = ANY($3::uuid[])
           AND snapshot->>'appliedPolicyName' = $4`,
        [deviceId, environmentId, accessibleGroupIds, amapiName]
      );
      if (!visibleDevice) {
        return errorResponse('Forbidden: policy is not visible in your assigned groups', 403);
      }
    }

    const env = await queryOne<{ workspace_id: string; enterprise_name: string | null }>(
      'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
      [environmentId]
    );
    if (!env) return errorResponse('Environment not found', 404);
    if (!env.enterprise_name) return errorResponse('Environment is not bound to an enterprise', 409);

    const ws = await queryOne<{ gcp_project_id: string | null }>(
      'SELECT gcp_project_id FROM workspaces WHERE id = $1',
      [env.workspace_id]
    );
    if (!ws?.gcp_project_id) {
      return errorResponse('Workspace GCP project is not configured', 409);
    }

    if (!amapiName.startsWith(`${env.enterprise_name}/policies/`)) {
      return errorResponse('Policy does not belong to the selected environment enterprise', 400);
    }

    try {
      const amapiPolicy = await amapiCall<Record<string, unknown>>(
        amapiName,
        env.workspace_id,
        {
          method: 'GET',
          projectId: ws.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'policies',
          resourceId: amapiName.split('/').pop(),
        }
      );

      let localPolicy: { id: string; name: string } | null = null;
      try {
        localPolicy = await queryOne<{ id: string; name: string }>(
          `SELECT DISTINCT p.id, p.name
           FROM policies p
           LEFT JOIN policy_derivatives pd ON pd.policy_id = p.id
           WHERE p.environment_id = $1
             AND (p.amapi_name = $2 OR pd.amapi_name = $2)
           LIMIT 1`,
          [environmentId, amapiName]
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('relation "policy_derivatives" does not exist')) throw err;
        localPolicy = await queryOne<{ id: string; name: string }>(
          'SELECT id, name FROM policies WHERE environment_id = $1 AND amapi_name = $2',
          [environmentId, amapiName]
        );
      }

      return jsonResponse({
        policy: amapiPolicy,
        local_policy: localPolicy
          ? { id: localPolicy.id, name: localPolicy.name }
          : null,
      });
    } catch (err) {
      return errorResponse(
        `Failed to fetch AMAPI policy: ${err instanceof Error ? err.message : 'Unknown error'}`,
        getAmapiErrorHttpStatus(err) ?? 502
      );
    }
  }

  if (
    request.method === 'GET'
    && action
    && !['list', 'external', 'derivatives', 'create', 'update'].includes(action)
    && !isValidUuid(action)
  ) {
    return errorResponse('policy_id must be a valid UUID');
  }

  // GET /api/policies/:id
  if (request.method === 'GET' && action && isValidUuid(action)) {
    const policy = await queryOne(
      `SELECT p.*, e.enterprise_name, e.workspace_id
       FROM policies p
       JOIN environments e ON e.id = p.environment_id
       WHERE p.id = $1`,
      [action]
    );
    if (!policy) return errorResponse('Policy not found', 404);
    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, (policy as any).environment_id, 'policy', 'read');
    if (envScope.mode === 'group') {
      const visible = await canViewPolicyInScopedEnvironment(
        action,
        (policy as any).environment_id,
        envScope.accessible_group_ids ?? []
      );
      if (!visible) {
        return errorResponse('Forbidden: policy is not visible in your assigned groups', 403);
      }
    }

    // Get assigned components
    const components = await query(
      `SELECT pc.id, pc.name, pc.category, pc.config_fragment, pca.priority
       FROM policy_component_assignments pca
       JOIN policy_components pc ON pc.id = pca.component_id
       WHERE pca.policy_id = $1
       ORDER BY pca.priority`,
      [action]
    );

    return jsonResponse({ policy, components });
  }

  // POST /api/policies/create
  if (request.method === 'POST' && action === 'create') {
    const body = await parseJsonBody<{
      environment_id: string;
      name: string;
      description?: string;
      deployment_scenario: string;
      config?: Record<string, unknown>;
    }>(request);

    if (!body.environment_id || !body.name || !body.deployment_scenario) {
      return errorResponse('environment_id, name, and deployment_scenario are required');
    }
    if (!isValidUuid(body.environment_id)) return errorResponse('environment_id must be a valid UUID');
    await requireEnvironmentResourcePermission(auth, body.environment_id, 'policy', 'write');

    const id = crypto.randomUUID();
    const cleanConfig = sanitizeConfig(body.config ?? {}) ?? {};

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO policies (id, environment_id, name, description, deployment_scenario, config, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
        [id, body.environment_id, body.name, body.description ?? null, body.deployment_scenario, JSON.stringify(cleanConfig)]
      );

      // Store initial version
      await client.query(
        `INSERT INTO policy_versions (policy_id, version, config, changed_by, change_summary)
         VALUES ($1, 1, $2, $3, 'Initial creation')`,
        [id, JSON.stringify(cleanConfig), auth.user.id]
      );
    });

    await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'policy.created',
      resource_type: 'policy',
      resource_id: id,
      details: { name: body.name, deployment_scenario: body.deployment_scenario },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ policy: { id, name: body.name, status: 'draft' } }, 201);
  }

  // PUT /api/policies/update
  if (request.method === 'PUT' && action === 'update') {
    const body = await parseJsonBody<{
      id: string;
      name?: string;
      description?: string;
      config?: Record<string, unknown>;
      push_to_amapi?: boolean;
    }>(request);

    if (!body.id) return errorResponse('Policy ID is required');
    if (!isValidUuid(body.id)) return errorResponse('id must be a valid UUID');

    const existing = await queryOne<{
      id: string; environment_id: string; name: string; config: Record<string, unknown>; version: number;
      amapi_name: string | null;
    }>(
      'SELECT id, environment_id, name, config, version, amapi_name FROM policies WHERE id = $1',
      [body.id]
    );
    if (!existing) return errorResponse('Policy not found', 404);
    if (existing.name === 'Default') {
      return errorResponse('The Default policy cannot be edited', 403);
    }
    await requireEnvironmentResourcePermission(auth, existing.environment_id, 'policy', 'write');

    const newVersion = existing.version + 1;
    const cleanConfig = body.config ? (sanitizeConfig(body.config) ?? {}) : existing.config;

    await transaction(async (client) => {
      // Store previous version
      await client.query(
        `INSERT INTO policy_versions (policy_id, version, config, changed_by)
         VALUES ($1, $2, $3, $4)`,
        [body.id, newVersion, JSON.stringify(cleanConfig), auth.user.id]
      );

      // Update policy
      await client.query(
        `UPDATE policies SET
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           config = $3,
           version = $4,
           updated_at = now()
         WHERE id = $5`,
        [body.name, body.description, JSON.stringify(cleanConfig), newVersion, body.id]
      );
    });

    // Store policy artifact to Blobs
    await storeBlob(
      'policy-artifacts',
      `${body.id}/v${newVersion}.json`,
      JSON.stringify(cleanConfig)
    );

    // Push to AMAPI if requested
    let generatedPolicyMeta: Record<string, unknown> | null = null;
    if (body.push_to_amapi) {
      const env = await queryOne<{ workspace_id: string; enterprise_name: string }>(
        'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
        [existing.environment_id]
      );

      if (env?.enterprise_name) {
        const ws = await queryOne<{ gcp_project_id: string }>(
          'SELECT gcp_project_id FROM workspaces WHERE id = $1',
          [env.workspace_id]
        );

        if (ws?.gcp_project_id) {
          try {
            const policyName = existing.amapi_name ?? `${env.enterprise_name}/policies/${body.id}`;
            const previousGenerated = await buildGeneratedPolicyPayload({
              policyId: body.id,
              environmentId: existing.environment_id,
              baseConfig: existing.config ?? {},
              target: { mode: 'scope', scope_type: 'environment', scope_id: existing.environment_id },
            });
            const nextGenerated = await buildGeneratedPolicyPayload({
              policyId: body.id,
              environmentId: existing.environment_id,
              baseConfig: cleanConfig,
              target: { mode: 'scope', scope_type: 'environment', scope_id: existing.environment_id },
            });
            generatedPolicyMeta = nextGenerated.metadata;
            const updateMask = buildPolicyUpdateMask(previousGenerated.payload ?? {}, nextGenerated.payload);
            const policyPath = updateMask
              ? `${policyName}?updateMask=${encodeURIComponent(updateMask)}`
              : policyName;

            assertValidAmapiPolicyPayload(nextGenerated.payload);
            const result = await amapiCall<{ name: string }>(
              policyPath,
              env.workspace_id,
              {
                method: 'PATCH',
                body: nextGenerated.payload,
                projectId: ws.gcp_project_id,
                enterpriseName: env.enterprise_name,
                resourceType: 'policies',
                resourceId: policyName.split('/').pop(),
              }
            );

            // Update AMAPI name and status
            await execute(
              `UPDATE policies SET amapi_name = $1, status = 'production', updated_at = now() WHERE id = $2`,
              [result.name ?? policyName, body.id]
            );

            const derivativeSync = await syncPolicyDerivativesForPolicy({
              policyId: body.id,
              environmentId: existing.environment_id,
              baseConfig: cleanConfig,
              amapiContext: {
                workspace_id: env.workspace_id,
                gcp_project_id: ws.gcp_project_id,
                enterprise_name: env.enterprise_name,
              },
            });
            generatedPolicyMeta = {
              ...(nextGenerated.metadata as Record<string, unknown>),
              derivative_sync: {
                direct_contexts: derivativeSync.direct_contexts,
                synced_derivatives: derivativeSync.derivatives.length,
                forced_device_derivatives: derivativeSync.forced_device_derivatives,
                warnings: derivativeSync.warnings,
                preferred_amapi_name: derivativeSync.preferred_amapi_name,
              },
            };
          } catch (err) {
            // Log the audit even on AMAPI failure — the policy was saved locally
            await logAudit({
              environment_id: existing.environment_id,
              user_id: auth.user.id,
              action: 'policy.updated',
              resource_type: 'policy',
              resource_id: body.id,
              details: { version: newVersion, pushed_to_amapi: true, amapi_sync_failed: true },
              ip_address: getClientIp(request),
            });

            return jsonResponse({
              message: 'Policy saved locally but AMAPI sync failed',
              amapi_status: err instanceof AmapiPolicyValidationError ? 400 : getAmapiErrorHttpStatus(err),
              amapi_error: err instanceof AmapiPolicyValidationError
                ? `${err.message} (${err.issues.slice(0, 5).join('; ')})`
                : (err instanceof Error ? err.message : 'Unknown error'),
              version: newVersion,
              policy_generation: generatedPolicyMeta ?? { model: 'layered_overrides' },
            });
          }
        }
      }
    }

    await logAudit({
      environment_id: existing.environment_id,
      user_id: auth.user.id,
      action: 'policy.updated',
      resource_type: 'policy',
      resource_id: body.id,
      details: {
        version: newVersion,
        pushed_to_amapi: body.push_to_amapi,
        policy_generation: generatedPolicyMeta ?? undefined,
      },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      message: 'Policy updated',
      version: newVersion,
      ...(generatedPolicyMeta ? { policy_generation: generatedPolicyMeta } : {}),
    });
  }

  // GET /api/policies/derivatives?policy_id=...
  if (request.method === 'GET' && action === 'derivatives') {
    const params = getSearchParams(request);
    const policyId = params.get('policy_id');
    if (!policyId) return errorResponse('policy_id is required');
    if (!isValidUuid(policyId)) return errorResponse('policy_id must be a valid UUID');

    const policy = await queryOne<{ id: string; environment_id: string }>(
      'SELECT id, environment_id FROM policies WHERE id = $1',
      [policyId]
    );
    if (!policy) return errorResponse('Policy not found', 404);

    const envScope = await requireEnvironmentAccessScopeForResourcePermission(auth, policy.environment_id, 'policy', 'read');
    if (envScope.mode === 'group') {
      const canView = await canViewPolicyInScopedEnvironment(policyId, policy.environment_id, envScope.accessible_group_ids ?? []);
      if (!canView) return errorResponse('Policy not found', 404);
    }

    const derivativeBaseSelect = `
      SELECT
        pd.id,
        pd.scope_type,
        pd.scope_id,
        pd.amapi_name,
        pd.payload_hash,
        %STATUS_COLUMNS%
        pd.created_at,
        pd.updated_at,
        CASE pd.scope_type
          WHEN 'environment' THEN (SELECT e.name FROM environments e WHERE e.id = pd.scope_id)
          WHEN 'group' THEN (SELECT g.name FROM groups g WHERE g.id = pd.scope_id)
          WHEN 'device' THEN COALESCE(
            (SELECT d.serial_number FROM devices d WHERE d.id = pd.scope_id AND d.deleted_at IS NULL),
            pd.scope_id::text
          )
        END AS scope_name,
        (
          SELECT COUNT(*)::int
          FROM devices d
          LEFT JOIN LATERAL (
            SELECT pa.policy_id FROM policy_assignments pa
            WHERE pa.scope_type = 'device' AND pa.scope_id = d.id LIMIT 1
          ) dpa ON TRUE
          LEFT JOIN LATERAL (
            SELECT pa.policy_id FROM group_closures gc
            JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
            WHERE d.group_id IS NOT NULL AND gc.descendant_id = d.group_id
            ORDER BY gc.depth ASC LIMIT 1
          ) gpa ON TRUE
          LEFT JOIN LATERAL (
            SELECT pa.policy_id FROM policy_assignments pa
            WHERE pa.scope_type = 'environment' AND pa.scope_id = d.environment_id LIMIT 1
          ) epa ON TRUE
          WHERE d.environment_id = $2
            AND d.deleted_at IS NULL
            AND COALESCE(dpa.policy_id, gpa.policy_id, epa.policy_id, d.policy_id) = $1
            AND (
              CASE pd.scope_type
                WHEN 'device' THEN d.id = pd.scope_id
                WHEN 'group' THEN EXISTS (
                  SELECT 1 FROM group_closures gc2
                  WHERE gc2.descendant_id = d.group_id AND gc2.ancestor_id = pd.scope_id
                )
                ELSE TRUE
              END
            )
        ) AS device_count
      FROM policy_derivatives pd
      WHERE pd.policy_id = $1
      ORDER BY
        CASE pd.scope_type WHEN 'environment' THEN 1 WHEN 'group' THEN 2 ELSE 3 END,
        pd.created_at`;

    let derivatives: unknown[];
    try {
      derivatives = await query(
        derivativeBaseSelect.replace('%STATUS_COLUMNS%', 'pd.status, pd.last_synced_at,'),
        [policyId, policy.environment_id]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const missingColumn =
        message.includes('column pd.status does not exist') ||
        message.includes('column pd.last_synced_at does not exist');
      if (!missingColumn) throw err;

      console.warn('policy-crud: policy_derivatives schema missing status/last_synced_at columns; using compatibility query');
      const legacyRows = await query<Record<string, unknown>>(
        derivativeBaseSelect.replace('%STATUS_COLUMNS%', 'NULL::text AS status, NULL::timestamptz AS last_synced_at,'),
        [policyId, policy.environment_id]
      );
      derivatives = legacyRows;
    }

    return jsonResponse({ derivatives });
  }

  // DELETE /api/policies/:id
  if (request.method === 'DELETE' && action) {
    if (!isValidUuid(action)) return errorResponse('policy_id must be a valid UUID');
    const policy = await queryOne<{ id: string; environment_id: string; name: string; amapi_name: string | null }>(
      'SELECT id, environment_id, name, amapi_name FROM policies WHERE id = $1',
      [action]
    );
    if (!policy) return errorResponse('Policy not found', 404);
    if (policy.name === 'Default') {
      return errorResponse('The Default policy cannot be deleted', 403);
    }
    await requireEnvironmentResourcePermission(auth, policy.environment_id, 'policy', 'delete');

    // Check if devices are using this policy
    const deviceCount = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM devices WHERE policy_id = $1 AND deleted_at IS NULL',
      [action]
    );
    if (parseInt(deviceCount?.count ?? '0', 10) > 0) {
      return errorResponse('Cannot delete policy: devices are still using it', 409);
    }

    // ── Clean up AMAPI derivative resources before DB delete ──────────────
    let amapiCleanup: Record<string, unknown> = {};
    try {
      const amapiContext = await getPolicyAmapiContext(policy.environment_id);
      if (amapiContext) {
        const derivatives = await query<{ amapi_name: string }>(
          'SELECT amapi_name FROM policy_derivatives WHERE policy_id = $1 AND amapi_name IS NOT NULL',
          [action]
        );

        let deleted = 0;
        const failures: string[] = [];
        for (const d of derivatives) {
          try {
            await amapiCall(d.amapi_name, amapiContext.workspace_id, {
              method: 'DELETE',
              projectId: amapiContext.gcp_project_id,
              enterpriseName: amapiContext.enterprise_name,
              resourceType: 'policies',
              resourceId: d.amapi_name.split('/').pop(),
            });
            deleted += 1;
          } catch (err) {
            const status = getAmapiErrorHttpStatus(err);
            if (status === 404) {
              deleted += 1; // already gone
            } else {
              failures.push(d.amapi_name);
              console.warn('policy-crud: AMAPI derivative delete failed (non-fatal)', {
                amapi_name: d.amapi_name,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        // Also delete the base AMAPI policy if it exists
        if (policy.amapi_name) {
          try {
            await amapiCall(policy.amapi_name, amapiContext.workspace_id, {
              method: 'DELETE',
              projectId: amapiContext.gcp_project_id,
              enterpriseName: amapiContext.enterprise_name,
              resourceType: 'policies',
              resourceId: policy.amapi_name.split('/').pop(),
            });
          } catch (err) {
            const status = getAmapiErrorHttpStatus(err);
            if (status !== 404) {
              console.warn('policy-crud: AMAPI base policy delete failed (non-fatal)', {
                amapi_name: policy.amapi_name,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        amapiCleanup = { derivatives_deleted: deleted, failures };
      }
    } catch (err) {
      console.warn('policy-crud: AMAPI cleanup failed (non-fatal)', {
        policy_id: action,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await execute('DELETE FROM policies WHERE id = $1', [action]);

    await logAudit({
      environment_id: policy.environment_id,
      user_id: auth.user.id,
      action: 'policy.deleted',
      resource_type: 'policy',
      resource_id: action,
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Policy deleted', amapi_cleanup: amapiCleanup });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('policy-crud: unhandled error', {
      request_id: requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse('Internal server error', 500);
  }
};

async function pushPolicyToAmapi(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  request: Request,
  policyId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await queryOne<{
    id: string;
    environment_id: string;
    config: Record<string, unknown> | string | null;
    amapi_name: string | null;
  }>(
    'SELECT id, environment_id, config, amapi_name FROM policies WHERE id = $1',
    [policyId]
  );
  if (!existing) return { ok: false, error: 'Policy not found' };

  const cleanConfig = typeof existing.config === 'string'
    ? JSON.parse(existing.config)
    : (existing.config ?? {});

  const env = await queryOne<{ workspace_id: string; enterprise_name: string }>(
    'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
    [existing.environment_id]
  );
  if (!env?.enterprise_name) {
    return { ok: false, error: 'Environment is not bound to an enterprise' };
  }

  const ws = await queryOne<{ gcp_project_id: string }>(
    'SELECT gcp_project_id FROM workspaces WHERE id = $1',
    [env.workspace_id]
  );
  if (!ws?.gcp_project_id) {
    return { ok: false, error: 'Workspace is missing gcp_project_id' };
  }

  try {
    const policyName = existing.amapi_name ?? `${env.enterprise_name}/policies/${policyId}`;
    const nextGenerated = await buildGeneratedPolicyPayload({
      policyId,
      environmentId: existing.environment_id,
      baseConfig: cleanConfig,
      target: { mode: 'scope', scope_type: 'environment', scope_id: existing.environment_id },
    });
    try {
      assertValidAmapiPolicyPayload(nextGenerated.payload);
    } catch (validationErr) {
      const validationMessage = validationErr instanceof AmapiPolicyValidationError
        ? `${validationErr.message} (${validationErr.issues.slice(0, 5).join('; ')})`
        : (validationErr instanceof Error ? validationErr.message : 'Unknown validation error');
      return { ok: false, error: validationMessage };
    }

    const result = await amapiCall<{ name: string }>(
      policyName,
      env.workspace_id,
      {
        method: 'PATCH',
        body: nextGenerated.payload,
        projectId: ws.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'policies',
        resourceId: policyName.split('/').pop(),
      }
    );

    await execute(
      `UPDATE policies SET amapi_name = $1, status = 'production', updated_at = now() WHERE id = $2`,
      [result.name ?? policyName, policyId]
    );

    await syncPolicyDerivativesForPolicy({
      policyId,
      environmentId: existing.environment_id,
      baseConfig: cleanConfig,
      amapiContext: {
        workspace_id: env.workspace_id,
        gcp_project_id: ws.gcp_project_id,
        enterprise_name: env.enterprise_name,
      },
    });

    await logAudit({
      environment_id: existing.environment_id,
      user_id: auth.user.id,
      action: 'policy.updated',
      resource_type: 'policy',
      resource_id: policyId,
      details: { pushed_to_amapi: true, source: 'bulk' },
      ip_address: getClientIp(request),
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `AMAPI push failed (${getAmapiErrorHttpStatus(err) ?? 500})`,
    };
  }
}

async function performPolicyDelete(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  request: Request,
  policyId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const policy = await queryOne<{ id: string; environment_id: string; name: string; amapi_name: string | null }>(
    'SELECT id, environment_id, name, amapi_name FROM policies WHERE id = $1',
    [policyId]
  );
  if (!policy) return { ok: false, error: 'Policy not found' };
  if (policy.name === 'Default') return { ok: false, error: 'The Default policy cannot be deleted' };
  await requireEnvironmentResourcePermission(auth, policy.environment_id, 'policy', 'delete');

  const deviceCount = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM devices WHERE policy_id = $1 AND deleted_at IS NULL',
    [policyId]
  );
  if (parseInt(deviceCount?.count ?? '0', 10) > 0) {
    return { ok: false, error: 'Cannot delete policy: devices are still using it' };
  }

  try {
    const amapiContext = await getPolicyAmapiContext(policy.environment_id);
    if (amapiContext) {
      const derivatives = await query<{ amapi_name: string }>(
        'SELECT amapi_name FROM policy_derivatives WHERE policy_id = $1 AND amapi_name IS NOT NULL',
        [policyId]
      );
      for (const d of derivatives) {
        try {
          await amapiCall(d.amapi_name, amapiContext.workspace_id, {
            method: 'DELETE',
            projectId: amapiContext.gcp_project_id,
            enterpriseName: amapiContext.enterprise_name,
            resourceType: 'policies',
            resourceId: d.amapi_name.split('/').pop(),
          });
        } catch (err) {
          const status = getAmapiErrorHttpStatus(err);
          if (status !== 404) {
            console.warn('policy-crud bulk delete: AMAPI derivative delete failed (non-fatal)', {
              amapi_name: d.amapi_name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      if (policy.amapi_name) {
        try {
          await amapiCall(policy.amapi_name, amapiContext.workspace_id, {
            method: 'DELETE',
            projectId: amapiContext.gcp_project_id,
            enterpriseName: amapiContext.enterprise_name,
            resourceType: 'policies',
            resourceId: policy.amapi_name.split('/').pop(),
          });
        } catch (err) {
          const status = getAmapiErrorHttpStatus(err);
          if (status !== 404) {
            console.warn('policy-crud bulk delete: AMAPI base delete failed (non-fatal)', {
              amapi_name: policy.amapi_name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('policy-crud bulk delete: AMAPI cleanup failed (non-fatal)', {
      policy_id: policyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await execute('DELETE FROM policies WHERE id = $1', [policyId]);
  await logAudit({
    environment_id: policy.environment_id,
    user_id: auth.user.id,
    action: 'policy.deleted',
    resource_type: 'policy',
    resource_id: policyId,
    details: { source: 'bulk' },
    ip_address: getClientIp(request),
  });
  return { ok: true };
}
