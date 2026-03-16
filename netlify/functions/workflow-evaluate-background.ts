import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { amapiCall } from './_lib/amapi.js';
import { buildAmapiCommandPayload } from './_lib/amapi-command.js';
import { logAudit } from './_lib/audit.js';
import { sendEmail } from './_lib/resend.js';
import { BRAND } from './_lib/brand.js';
import { assignPolicyToDeviceWithDerivative } from './_lib/policy-derivatives.js';
import { requireInternalCaller } from './_lib/internal-auth.js';
import { escapeHtml } from './_lib/html.js';
import { validateResolvedWebhookUrlForOutbound } from './_lib/webhook-ssrf.js';

export const config = {
  type: 'background',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface EvaluatePayload {
  workflow_id: string;
  device_id: string;
  trigger_data: Record<string, unknown>;
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
}

interface ConditionRow {
  field: string;
  operator: string;
  value: unknown;
}

interface Device {
  id: string;
  environment_id: string;
  amapi_name: string;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  os_version: string | null;
  state: string | null;
  ownership: string | null;
  policy_compliant: boolean;
  group_id: string | null;
  snapshot: Record<string, unknown> | null;
}

interface EnvironmentContext {
  workspace_id: string;
  enterprise_name: string;
  gcp_project_id: string;
}

interface WorkflowAuditOptions {
  action: string;
  workflow: Workflow;
  device: Device;
  triggerData: Record<string, unknown>;
  executionId: string;
  workspaceId?: string;
  details?: Record<string, unknown>;
}

// ─── Condition Evaluation ───────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function evaluateCondition(condition: ConditionRow, device: Device): Promise<boolean> {
  const { field, operator, value } = condition;

  switch (field) {
    case 'device.state': {
      const deviceState = device.state ?? '';
      if (operator === 'equals') return deviceState === value;
      if (operator === 'not_equals') return deviceState !== value;
      return false;
    }

    case 'device.ownership': {
      const ownership = device.ownership ?? '';
      if (operator === 'equals') return ownership === value;
      if (operator === 'not_equals') return ownership !== value;
      return false;
    }

    case 'device.os_version': {
      const osVersion = device.os_version ?? '0';
      const targetVersion = String(value);
      const cmp = compareVersions(osVersion, targetVersion);
      if (operator === 'eq') return cmp === 0;
      if (operator === 'gt') return cmp > 0;
      if (operator === 'lt') return cmp < 0;
      if (operator === 'gte') return cmp >= 0;
      if (operator === 'lte') return cmp <= 0;
      return false;
    }

    case 'device.manufacturer': {
      const mfr = (device.manufacturer ?? '').toLowerCase();
      const target = String(value).toLowerCase();
      if (operator === 'equals') return mfr === target;
      if (operator === 'contains') return mfr.includes(target);
      if (operator === 'not_equals') return mfr !== target;
      return false;
    }

    case 'device.group': {
      if (!device.group_id) return operator === 'not_in';
      // Use closure table to check if device is in group (or any descendant)
      const groupMatch = await queryOne(
        `SELECT 1 FROM group_closures
         WHERE ancestor_id = $1 AND descendant_id = $2`,
        [value, device.group_id]
      );
      if (operator === 'in') return !!groupMatch;
      if (operator === 'not_in') return !groupMatch;
      return false;
    }

    case 'device.compliant': {
      const targetCompliant = value === true || value === 'true';
      if (operator === 'equals') return device.policy_compliant === targetCompliant;
      if (operator === 'not_equals') return device.policy_compliant !== targetCompliant;
      return false;
    }

    case 'custom.field': {
      if (!device.snapshot) return false;
      const config = value as { path: string; expected: unknown; operator?: string } | undefined;
      if (!config?.path) return false;
      const actual = getNestedValue(device.snapshot, config.path);
      const customOp = config.operator ?? 'equals';
      if (customOp === 'equals') return actual === config.expected;
      if (customOp === 'not_equals') return actual !== config.expected;
      if (customOp === 'contains' && typeof actual === 'string') return actual.includes(String(config.expected));
      if (customOp === 'exists') return actual !== undefined && actual !== null;
      return false;
    }

    default:
      return false;
  }
}

async function evaluateAllConditions(conditions: ConditionRow[], device: Device): Promise<boolean> {
  if (!conditions || conditions.length === 0) return true;
  for (const condition of conditions) {
    const result = await evaluateCondition(condition, device);
    if (!result) return false;
  }
  return true;
}

// ─── Action Execution ───────────────────────────────────────────────────────

export function buildWorkflowNotificationHtml(
  workflow: Pick<Workflow, 'name' | 'action_config'>,
  device: Pick<Device, 'serial_number' | 'amapi_name' | 'manufacturer' | 'model' | 'state'>
): string {
  const template = escapeHtml((workflow.action_config.template as string) ?? '');
  const workflowName = escapeHtml(workflow.name);
  const fallbackMessage = escapeHtml(
    `The workflow "${workflow.name}" was triggered for device ${device.serial_number ?? device.amapi_name}.`
  );
  const manufacturer = escapeHtml(device.manufacturer ?? '');
  const model = escapeHtml(device.model ?? '');
  const serialNumber = escapeHtml(device.serial_number ?? 'N/A');
  const state = escapeHtml(device.state ?? 'Unknown');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #111; margin-bottom: 16px;">Workflow Triggered: ${workflowName}</h2>
      <p style="color: #555; line-height: 1.6;">
        ${template || fallbackMessage}
      </p>
      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0; color: #333; font-size: 14px;"><strong>Device:</strong> ${manufacturer} ${model}</p>
        <p style="margin: 4px 0 0; color: #333; font-size: 14px;"><strong>Serial:</strong> ${serialNumber}</p>
        <p style="margin: 4px 0 0; color: #333; font-size: 14px;"><strong>State:</strong> ${state}</p>
      </div>
      <p style="color: #999; font-size: 13px; margin-top: 32px;">Sent by ${BRAND.name} workflow engine.</p>
    </div>
  `;
}

async function executeAction(
  workflow: Workflow,
  device: Device,
  envContext: EnvironmentContext
): Promise<Record<string, unknown>> {
  const { action_type, action_config } = workflow;

  switch (action_type) {
    case 'device.command': {
      const commandType = action_config.command_type as string;
      if (!commandType) return { error: 'No command_type specified in action_config' };

      const commandBody = buildAmapiCommandPayload(
        commandType,
        (action_config.command_data as Record<string, unknown> | undefined) ?? {},
        { allowUnknown: true }
      );

      const result = await amapiCall(
        `${device.amapi_name}:issueCommand`,
        envContext.workspace_id,
        {
          method: 'POST',
          body: commandBody,
          projectId: envContext.gcp_project_id,
          enterpriseName: envContext.enterprise_name,
          resourceType: 'devices',
          resourceId: device.amapi_name,
        }
      );

      return { command_type: commandType, amapi_result: result };
    }

    case 'device.move_group': {
      const targetGroupId = action_config.group_id as string;
      if (!targetGroupId) return { error: 'No group_id specified in action_config' };

      await execute(
        'UPDATE devices SET group_id = $1, updated_at = now() WHERE id = $2',
        [targetGroupId, device.id]
      );

      return { moved_to_group: targetGroupId };
    }

    case 'device.assign_policy': {
      const policyId = action_config.policy_id as string;
      if (!policyId) return { error: 'No policy_id specified in action_config' };

      await execute(
        'UPDATE devices SET policy_id = $1, updated_at = now() WHERE id = $2',
        [policyId, device.id]
      );

      try {
        const assigned = await assignPolicyToDeviceWithDerivative({
          policyId,
          environmentId: device.environment_id,
          deviceId: device.id,
          deviceAmapiName: device.amapi_name,
          amapiContext: {
            workspace_id: envContext.workspace_id,
            gcp_project_id: envContext.gcp_project_id,
            enterprise_name: envContext.enterprise_name,
          },
        });
        return {
          assigned_policy: policyId,
          amapi_policy_name: assigned.policy_name,
          derivative_scope: 'device',
        };
      } catch (err) {
        return {
          assigned_policy: policyId,
          amapi_sync_failed: true,
          amapi_error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'notification.email': {
      const to = action_config.to as string;
      const subject = (action_config.subject as string) ?? `${BRAND.name} Workflow Alert: ${workflow.name}`;
      const html = buildWorkflowNotificationHtml(workflow, device);

      if (to) {
        await sendEmail({ to, subject, html });
        return { email_sent_to: to };
      }

      return { error: 'No recipient email specified' };
    }

    case 'notification.webhook': {
      const webhookUrl = action_config.url as string;
      if (!webhookUrl) return { error: 'No webhook URL specified' };

      const validatedWebhookUrl = await validateResolvedWebhookUrlForOutbound(webhookUrl);
      if (!validatedWebhookUrl.ok) {
        return { error: validatedWebhookUrl.error };
      }

      const webhookBody = {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        device_id: device.id,
        device_serial: device.serial_number,
        device_manufacturer: device.manufacturer,
        device_model: device.model,
        device_state: device.state,
        triggered_at: new Date().toISOString(),
        ...(action_config.extra_data as Record<string, unknown> ?? {}),
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (action_config.secret) {
        headers['X-Webhook-Secret'] = action_config.secret as string;
      }

      const webhookResponse = await fetch(validatedWebhookUrl.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(webhookBody),
        redirect: 'error',
      });

      return {
        webhook_url: webhookUrl,
        status: webhookResponse.status,
        success: webhookResponse.ok,
      };
    }

    case 'audit.log': {
      const auditAction = (action_config.action as string) ?? 'workflow.custom_audit';
      const auditDetails = (action_config.details as Record<string, unknown>) ?? {};

      await logAudit({
        environment_id: workflow.environment_id,
        device_id: device.id,
        actor_type: 'system',
        visibility_scope: 'privileged',
        action: auditAction,
        resource_type: 'workflow',
        resource_id: workflow.id,
        details: {
          workflow_name: workflow.name,
          device_serial: device.serial_number,
          ...auditDetails,
        },
      });

      return { audit_logged: true, action: auditAction };
    }

    default:
      return { error: `Unknown action type: ${action_type}` };
  }
}

async function logWorkflowExecutionAudit({
  action,
  workflow,
  device,
  triggerData,
  executionId,
  workspaceId,
  details = {},
}: WorkflowAuditOptions): Promise<void> {
  await logAudit({
    workspace_id: workspaceId,
    environment_id: workflow.environment_id,
    device_id: device.id,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action,
    resource_type: 'workflow',
    resource_id: workflow.id,
    details: {
      workflow_name: workflow.name,
      workflow_action_type: workflow.action_type,
      execution_id: executionId,
      trigger_data: triggerData,
      ...details,
    },
  });
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export default async (request: Request, context: Context) => {
  console.log('Workflow evaluation background function started');

  try {
    requireInternalCaller(request);

    const payload = await request.json() as EvaluatePayload;
    const { workflow_id, device_id, trigger_data } = payload;

    if (!workflow_id || !device_id) {
      console.error('Missing workflow_id or device_id in payload');
      return;
    }

    // Fetch the workflow
    const workflow = await queryOne<Workflow>(
      'SELECT * FROM workflows WHERE id = $1 AND enabled = true',
      [workflow_id]
    );

    if (!workflow) {
      console.log(`Workflow ${workflow_id} not found or disabled, skipping`);
      return;
    }

    // Fetch the device
    const device = await queryOne<Device>(
      'SELECT * FROM devices WHERE id = $1',
      [device_id]
    );

    if (!device) {
      console.log(`Device ${device_id} not found, skipping`);
      return;
    }

    // Verify device and workflow belong to the same environment
    if (device.environment_id !== workflow.environment_id) {
      console.error(`Environment mismatch: device ${device_id} env=${device.environment_id}, workflow ${workflow_id} env=${workflow.environment_id}`);
      return;
    }

    // Create execution record
    const executionId = crypto.randomUUID();
    await execute(
      `INSERT INTO workflow_executions (id, workflow_id, device_id, trigger_data, status)
       VALUES ($1, $2, $3, $4, 'running')`,
      [executionId, workflow_id, device_id, JSON.stringify(trigger_data ?? {})]
    );

    // Evaluate conditions
    const conditionsPass = await evaluateAllConditions(
      workflow.conditions ?? [],
      device
    );

    if (!conditionsPass) {
      await logWorkflowExecutionAudit({
        action: 'workflow.execution.skipped',
        workflow,
        device,
        triggerData: trigger_data ?? {},
        executionId,
        details: { reason: 'Conditions not met' },
      });
      await execute(
        `UPDATE workflow_executions SET status = 'skipped', result = $2 WHERE id = $1`,
        [executionId, JSON.stringify({ reason: 'Conditions not met' })]
      );
      console.log(`Workflow ${workflow_id}: conditions not met for device ${device_id}`);
      return;
    }

    // Get environment context for AMAPI calls
    const envContext = await queryOne<EnvironmentContext>(
      `SELECT e.workspace_id, e.enterprise_name, w.gcp_project_id
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
       WHERE e.id = $1`,
      [workflow.environment_id]
    );

    if (!envContext) {
      await logWorkflowExecutionAudit({
        action: 'workflow.execution.failed',
        workflow,
        device,
        triggerData: trigger_data ?? {},
        executionId,
        details: { error: 'Environment context not found' },
      });
      await execute(
        `UPDATE workflow_executions SET status = 'failed', result = $2 WHERE id = $1`,
        [executionId, JSON.stringify({ error: 'Environment context not found' })]
      );
      return;
    }

    // Execute the action
    try {
      const result = await executeAction(workflow, device, envContext);

      const hasError = 'error' in result;
      await execute(
        `UPDATE workflow_executions SET status = $2, result = $3 WHERE id = $1`,
        [executionId, hasError ? 'failed' : 'success', JSON.stringify(result)]
      );

      await logWorkflowExecutionAudit({
        action: hasError ? 'workflow.execution.failed' : 'workflow.execution.executed',
        workflow,
        device,
        triggerData: trigger_data ?? {},
        executionId,
        workspaceId: envContext.workspace_id,
        details: { result },
      });

      // Update last_triggered_at
      await execute(
        'UPDATE workflows SET last_triggered_at = now() WHERE id = $1',
        [workflow_id]
      );

      console.log(`Workflow ${workflow_id} executed for device ${device_id}: ${hasError ? 'failed' : 'success'}`);
    } catch (err) {
      console.error(`Workflow ${workflow_id} action failed:`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      await logWorkflowExecutionAudit({
        action: 'workflow.execution.failed',
        workflow,
        device,
        triggerData: trigger_data ?? {},
        executionId,
        workspaceId: envContext.workspace_id,
        details: { error: errorMessage },
      });
      await execute(
        `UPDATE workflow_executions SET status = 'failed', result = $2 WHERE id = $1`,
        [executionId, JSON.stringify({ error: errorMessage })]
      );
    }
  } catch (err) {
    console.error('Workflow evaluation error:', err);
  }
};
