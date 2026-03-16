import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface WorkflowBody {
  environment_id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  trigger_type: string;
  trigger_config?: Record<string, unknown>;
  conditions?: ConditionRow[];
  action_type: string;
  action_config?: Record<string, unknown>;
  scope_type?: string;
  scope_id?: string;
}

interface ConditionRow {
  field: string;
  operator: string;
  value: unknown;
}

interface Workflow {
  id: string;
  environment_id: string;
  name: string;
  enabled: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: ConditionRow[];
  action_type: string;
  action_config: Record<string, unknown>;
  scope_type: string;
  scope_id: string | null;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowWithStats extends Workflow {
  execution_count: string;
  last_execution_status: string | null;
}

interface WorkflowExecution {
  id: string;
  workflow_id: string;
  device_id: string | null;
  trigger_data: Record<string, unknown> | null;
  status: string;
  result: Record<string, unknown> | null;
  created_at: string;
}

type BulkSelection = {
  ids?: string[];
  all_matching?: boolean;
  excluded_ids?: string[];
};

type WorkflowBulkBody = {
  environment_id?: string;
  operation?: 'enable' | 'disable' | 'delete';
  selection?: BulkSelection;
};

// ─── Validation ─────────────────────────────────────────────────────────────

const VALID_TRIGGER_TYPES = [
  'device.enrolled',
  'device.state_changed',
  'compliance.changed',
  'app.installed',
  'app.removed',
  'location.fence_entered',
  'location.fence_exited',
  'scheduled',
];

const VALID_ACTION_TYPES = [
  'device.command',
  'device.move_group',
  'device.assign_policy',
  'notification.email',
  'notification.webhook',
  'audit.log',
];

const VALID_CONDITION_FIELDS = [
  'device.state',
  'device.ownership',
  'device.os_version',
  'device.manufacturer',
  'device.group',
  'device.compliant',
  'custom.field',
];

function validateWorkflowBody(body: Partial<WorkflowBody>): string | null {
  if (!body.name?.trim()) return 'name is required';
  if (!body.trigger_type) return 'trigger_type is required';
  if (!body.action_type) return 'action_type is required';
  if (!VALID_TRIGGER_TYPES.includes(body.trigger_type)) {
    return `Invalid trigger_type. Must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`;
  }
  if (!VALID_ACTION_TYPES.includes(body.action_type)) {
    return `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`;
  }
  if (body.conditions && Array.isArray(body.conditions)) {
    for (const c of body.conditions) {
      if (!VALID_CONDITION_FIELDS.includes(c.field)) {
        return `Invalid condition field: ${c.field}`;
      }
    }
  }
  return null;
}

async function validateAndNormalizeWorkflowScope(
  environmentId: string,
  scopeTypeRaw: string | undefined,
  scopeIdRaw: string | undefined
): Promise<{ scopeType: string; scopeId: string | null; error: string | null }> {
  const scopeType = scopeTypeRaw ?? 'environment';
  const scopeId = scopeIdRaw ?? null;

  if (scopeType === 'environment') {
    if (scopeId && scopeId !== environmentId) {
      return {
        scopeType,
        scopeId,
        error: 'For environment scope, scope_id must equal environment_id',
      };
    }
    return { scopeType: 'environment', scopeId: null, error: null };
  }

  if (scopeType !== 'group' && scopeType !== 'device') {
    return {
      scopeType,
      scopeId,
      error: 'scope_type must be one of: environment, group, device',
    };
  }

  if (!scopeId) {
    return {
      scopeType,
      scopeId,
      error: `scope_id is required when scope_type is ${scopeType}`,
    };
  }

  if (scopeType === 'group') {
    const group = await queryOne<{ id: string }>(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      [scopeId, environmentId]
    );
    if (!group) {
      return {
        scopeType,
        scopeId,
        error: `scope_id does not belong to environment ${environmentId}`,
      };
    }
    return { scopeType, scopeId, error: null };
  }

  const device = await queryOne<{ id: string }>(
    'SELECT id FROM devices WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL',
    [scopeId, environmentId]
  );
  if (!device) {
    return {
      scopeType,
      scopeId,
      error: `scope_id does not belong to environment ${environmentId}`,
    };
  }
  return { scopeType, scopeId, error: null };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/workflows/', '').split('/').filter(Boolean);
    const action = segments[0];

  // POST /api/workflows/bulk
  if (request.method === 'POST' && action === 'bulk') {
    const body = await parseJsonBody<WorkflowBulkBody>(request);
    const operation = body.operation;
    const environmentId = body.environment_id;
    const selection = body.selection;

    if (!operation) return errorResponse('operation is required');
    if (!environmentId) return errorResponse('environment_id is required');
    if (!selection) return errorResponse('selection is required');
    await requireEnvironmentPermission(auth, environmentId, 'write');

    const excludedIds = Array.from(new Set((selection.excluded_ids ?? []).filter(Boolean)));
    const excludedIdSet = new Set(excludedIds);

    let targetIds: string[] = [];
    if (selection.all_matching) {
      const rows = await query<{ id: string }>(
        'SELECT id FROM workflows WHERE environment_id = $1',
        [environmentId]
      );
      targetIds = rows
        .map((r) => r.id)
        .filter((id) => !excludedIdSet.has(id));
    } else {
      const ids = Array.from(new Set((selection.ids ?? []).filter(Boolean)));
      if (ids.length === 0) return errorResponse('selection.ids must include at least one id');
      targetIds = ids;
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const workflowId of targetIds) {
      const workflow = await queryOne<Workflow>(
        'SELECT * FROM workflows WHERE id = $1',
        [workflowId]
      );
      if (!workflow) {
        results.push({ id: workflowId, ok: false, error: 'Workflow not found' });
        continue;
      }
      if (workflow.environment_id !== environmentId) {
        results.push({ id: workflowId, ok: false, error: 'Workflow is outside selected environment' });
        continue;
      }

      try {
        if (operation === 'delete') {
          await execute('DELETE FROM workflows WHERE id = $1', [workflowId]);
          await logAudit({
            environment_id: workflow.environment_id,
            user_id: auth.user.id,
            action: 'workflow.deleted',
            resource_type: 'workflow',
            resource_id: workflowId,
            details: { name: workflow.name, source: 'bulk' },
            ip_address: getClientIp(request),
          });
        } else {
          const nextEnabled = operation === 'enable';
          if (workflow.enabled !== nextEnabled) {
            await execute(
              'UPDATE workflows SET enabled = $1, updated_at = now() WHERE id = $2',
              [nextEnabled, workflowId]
            );
          }
          await logAudit({
            environment_id: workflow.environment_id,
            user_id: auth.user.id,
            action: nextEnabled ? 'workflow.enabled' : 'workflow.disabled',
            resource_type: 'workflow',
            resource_id: workflowId,
            details: { name: workflow.name, enabled: nextEnabled, source: 'bulk' },
            ip_address: getClientIp(request),
          });
        }
        results.push({ id: workflowId, ok: true });
      } catch (err) {
        results.push({ id: workflowId, ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
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

  // GET /api/workflows/list?environment_id=...
  if (request.method === 'GET' && action === 'list') {
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');
    await requireEnvironmentPermission(auth, environmentId, 'read');

    const workflows = await query<WorkflowWithStats>(
      `SELECT w.*,
              COALESCE(e.cnt, 0) AS execution_count,
              e.last_status AS last_execution_status
       FROM workflows w
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt,
                (SELECT status FROM workflow_executions WHERE workflow_id = w.id ORDER BY created_at DESC LIMIT 1) AS last_status
         FROM workflow_executions WHERE workflow_id = w.id
       ) e ON true
       WHERE w.environment_id = $1
       ORDER BY w.created_at DESC`,
      [environmentId]
    );

    return jsonResponse({ workflows });
  }

  // GET /api/workflows/:id
  if (request.method === 'GET' && action && action !== 'list') {
    const workflow = await queryOne<Workflow>(
      'SELECT * FROM workflows WHERE id = $1',
      [action]
    );
    if (!workflow) return errorResponse('Workflow not found', 404);
    await requireEnvironmentPermission(auth, workflow.environment_id, 'read');

    const recent_executions = await query<WorkflowExecution>(
      `SELECT we.*, d.manufacturer, d.model, d.serial_number
       FROM workflow_executions we
       LEFT JOIN devices d ON d.id = we.device_id
       WHERE we.workflow_id = $1
       ORDER BY we.created_at DESC
       LIMIT 50`,
      [action]
    );

    return jsonResponse({ workflow, recent_executions });
  }

  // POST /api/workflows/create
  if (request.method === 'POST' && action === 'create') {
    const body = await parseJsonBody<WorkflowBody>(request);

    if (!body.environment_id) return errorResponse('environment_id is required');
    await requireEnvironmentPermission(auth, body.environment_id, 'write');
    const validationError = validateWorkflowBody(body);
    if (validationError) return errorResponse(validationError);
    const scopeValidation = await validateAndNormalizeWorkflowScope(
      body.environment_id,
      body.scope_type,
      body.scope_id
    );
    if (scopeValidation.error) return errorResponse(scopeValidation.error);

    const id = crypto.randomUUID();

    await execute(
      `INSERT INTO workflows (id, environment_id, name, enabled, trigger_type, trigger_config, conditions, action_type, action_config, scope_type, scope_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        body.environment_id,
        body.name.trim(),
        body.enabled !== false,
        body.trigger_type,
        JSON.stringify(body.trigger_config ?? {}),
        JSON.stringify(body.conditions ?? []),
        body.action_type,
        JSON.stringify(body.action_config ?? {}),
        scopeValidation.scopeType,
        scopeValidation.scopeId,
      ]
    );

    await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'workflow.created',
      resource_type: 'workflow',
      resource_id: id,
      details: { name: body.name, trigger_type: body.trigger_type, action_type: body.action_type },
      ip_address: getClientIp(request),
    });

    const workflow = await queryOne<Workflow>('SELECT * FROM workflows WHERE id = $1', [id]);
    return jsonResponse({ workflow }, 201);
  }

  // PUT /api/workflows/update
  if (request.method === 'PUT' && action === 'update') {
    const body = await parseJsonBody<WorkflowBody & { id: string }>(request);
    if (!body.id) return errorResponse('Workflow ID is required');

    const existing = await queryOne<Workflow>(
      'SELECT * FROM workflows WHERE id = $1',
      [body.id]
    );
    if (!existing) return errorResponse('Workflow not found', 404);
    await requireEnvironmentPermission(auth, existing.environment_id, 'write');

    const validationError = validateWorkflowBody(body);
    if (validationError) return errorResponse(validationError);
    const scopeValidation = await validateAndNormalizeWorkflowScope(
      existing.environment_id,
      body.scope_type,
      body.scope_id
    );
    if (scopeValidation.error) return errorResponse(scopeValidation.error);

    await execute(
      `UPDATE workflows SET
         name = $1,
         enabled = $2,
         trigger_type = $3,
         trigger_config = $4,
         conditions = $5,
         action_type = $6,
         action_config = $7,
         scope_type = $8,
         scope_id = $9,
         updated_at = now()
       WHERE id = $10`,
      [
        body.name.trim(),
        body.enabled !== false,
        body.trigger_type,
        JSON.stringify(body.trigger_config ?? {}),
        JSON.stringify(body.conditions ?? []),
        body.action_type,
        JSON.stringify(body.action_config ?? {}),
        scopeValidation.scopeType,
        scopeValidation.scopeId,
        body.id,
      ]
    );

    await logAudit({
      environment_id: existing.environment_id,
      user_id: auth.user.id,
      action: 'workflow.updated',
      resource_type: 'workflow',
      resource_id: body.id,
      details: { name: body.name, trigger_type: body.trigger_type, action_type: body.action_type },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Workflow updated' });
  }

  // DELETE /api/workflows/:id
  if (request.method === 'DELETE' && action) {
    const workflow = await queryOne<Workflow>(
      'SELECT * FROM workflows WHERE id = $1',
      [action]
    );
    if (!workflow) return errorResponse('Workflow not found', 404);
    await requireEnvironmentPermission(auth, workflow.environment_id, 'delete');

    await execute('DELETE FROM workflows WHERE id = $1', [action]);

    await logAudit({
      environment_id: workflow.environment_id,
      user_id: auth.user.id,
      action: 'workflow.deleted',
      resource_type: 'workflow',
      resource_id: action,
      details: { name: workflow.name },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Workflow deleted' });
  }

  // POST /api/workflows/:id/toggle
  if (request.method === 'POST' && segments[1] === 'toggle') {
    const workflowId = segments[0];
    const workflow = await queryOne<Workflow>(
      'SELECT * FROM workflows WHERE id = $1',
      [workflowId]
    );
    if (!workflow) return errorResponse('Workflow not found', 404);
    await requireEnvironmentPermission(auth, workflow.environment_id, 'write');

    const newEnabled = !workflow.enabled;
    await execute(
      'UPDATE workflows SET enabled = $1, updated_at = now() WHERE id = $2',
      [newEnabled, workflowId]
    );

    await logAudit({
      environment_id: workflow.environment_id,
      user_id: auth.user.id,
      action: newEnabled ? 'workflow.enabled' : 'workflow.disabled',
      resource_type: 'workflow',
      resource_id: workflowId,
      details: { name: workflow.name, enabled: newEnabled },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: `Workflow ${newEnabled ? 'enabled' : 'disabled'}`, enabled: newEnabled });
  }

  // POST /api/workflows/:id/test
  if (request.method === 'POST' && segments[1] === 'test') {
    const workflowId = segments[0];
    const body = await parseJsonBody<{ device_id?: string }>(request);

    const workflow = await queryOne<Workflow>(
      'SELECT * FROM workflows WHERE id = $1',
      [workflowId]
    );
    if (!workflow) return errorResponse('Workflow not found', 404);
    await requireEnvironmentPermission(auth, workflow.environment_id, 'write');

    // Get a target device (either specified or first in scope)
    let deviceId = body.device_id;
    if (!deviceId) {
      const device = await queryOne<{ id: string }>(
        'SELECT id FROM devices WHERE environment_id = $1 AND deleted_at IS NULL LIMIT 1',
        [workflow.environment_id]
      );
      if (!device) return errorResponse('No devices found in environment to test against');
      deviceId = device.id;
    }

    // Create a dry-run execution
    const executionId = crypto.randomUUID();
    await execute(
      `INSERT INTO workflow_executions (id, workflow_id, device_id, trigger_data, status, result)
       VALUES ($1, $2, $3, $4, 'dry_run', $5)`,
      [
        executionId,
        workflowId,
        deviceId,
        JSON.stringify({ test: true, triggered_by: auth.user.id }),
        JSON.stringify({ dry_run: true, message: 'Test execution - no actions performed' }),
      ]
    );

    await logAudit({
      environment_id: workflow.environment_id,
      user_id: auth.user.id,
      action: 'workflow.tested',
      resource_type: 'workflow',
      resource_id: workflowId,
      details: { device_id: deviceId },
      ip_address: getClientIp(request),
    });

    const execution = await queryOne<WorkflowExecution>(
      'SELECT * FROM workflow_executions WHERE id = $1',
      [executionId]
    );

    return jsonResponse({ execution });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('workflow-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
