/**
 * Workflow Event Dispatcher
 *
 * Dispatches workflow evaluation jobs when device events occur.
 * Called by the sync processor after processing device events (enrollment,
 * state changes, compliance changes, etc.).
 *
 * For each matching enabled workflow, enqueues a `workflow_evaluate` job
 * in the job_queue table. The background evaluator then processes each job,
 * evaluating conditions and executing actions.
 */

import { query, execute } from './db.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MatchingWorkflow {
  id: string;
  trigger_config: Record<string, unknown> | string | null;
  scope_type: string;
  scope_id: string | null;
}

export interface WorkflowEventInput {
  environmentId: string;
  deviceId: string;
  deviceGroupId?: string | null;
  triggerType: string;
  triggerData: Record<string, unknown>;
}

// ─── Main Dispatch Function ─────────────────────────────────────────────────

/**
 * Find all enabled workflows matching the trigger type and scope, then enqueue
 * evaluation jobs for each. Returns the number of jobs enqueued.
 */
export async function dispatchWorkflowEvent(input: WorkflowEventInput): Promise<number> {
  try {
    const workflows = await query<MatchingWorkflow>(
      `SELECT id, trigger_config, scope_type, scope_id
       FROM workflows
       WHERE environment_id = $1
         AND trigger_type = $2
         AND enabled = true`,
      [input.environmentId, input.triggerType]
    );

    if (workflows.length === 0) return 0;

    let enqueued = 0;

    for (const workflow of workflows) {
      // Check if the workflow scope includes this device
      if (!await isDeviceInWorkflowScope(workflow, input)) continue;

      // Check if trigger_config filters match
      const triggerConfig = parseTriggerConfig(workflow.trigger_config);
      if (!matchesTriggerConfig(triggerConfig, input.triggerType, input.triggerData)) continue;

      // Enqueue evaluation job
      await execute(
        `INSERT INTO job_queue (id, job_type, environment_id, payload, status, scheduled_for)
         VALUES ($1, 'workflow_evaluate', $2, $3, 'pending', now())`,
        [
          crypto.randomUUID(),
          input.environmentId,
          JSON.stringify({
            workflow_id: workflow.id,
            device_id: input.deviceId,
            trigger_data: {
              ...input.triggerData,
              trigger_type: input.triggerType,
              dispatched_at: new Date().toISOString(),
            },
          }),
        ]
      );
      enqueued++;
    }

    if (enqueued > 0) {
      console.log(`workflow-dispatch: enqueued ${enqueued} workflow_evaluate jobs for ${input.triggerType} on device ${input.deviceId}`);
    }

    return enqueued;
  } catch (err) {
    // Workflow dispatch failures must not break the main event processing pipeline
    console.warn('workflow-dispatch: failed to dispatch workflow events (non-fatal)', {
      trigger_type: input.triggerType,
      device_id: input.deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// ─── Scope Matching ─────────────────────────────────────────────────────────

async function isDeviceInWorkflowScope(
  workflow: MatchingWorkflow,
  input: WorkflowEventInput
): Promise<boolean> {
  // Environment-scoped workflows apply to all devices in the environment
  if (workflow.scope_type === 'environment' || !workflow.scope_id) return true;

  // Group-scoped workflows: check if device is in the group (or descendant)
  if (workflow.scope_type === 'group') {
    const groupId = input.deviceGroupId;
    if (!groupId) return false;

    const match = await query(
      `SELECT 1 FROM group_closures
       WHERE ancestor_id = $1 AND descendant_id = $2
       LIMIT 1`,
      [workflow.scope_id, groupId]
    );
    return match.length > 0;
  }

  return true;
}

// ─── Trigger Config Matching ────────────────────────────────────────────────

function parseTriggerConfig(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

/**
 * Check if the trigger_config filters match the event data.
 * Each trigger type has its own optional filters.
 */
function matchesTriggerConfig(
  config: Record<string, unknown>,
  triggerType: string,
  triggerData: Record<string, unknown>
): boolean {
  switch (triggerType) {
    case 'device.state_changed': {
      // Optional from_state / to_state filters
      const fromState = typeof config.from_state === 'string' ? config.from_state : null;
      const toState = typeof config.to_state === 'string' ? config.to_state : null;
      if (fromState && triggerData.previous_state !== fromState) return false;
      if (toState && triggerData.new_state !== toState) return false;
      return true;
    }

    case 'app.installed':
    case 'app.removed': {
      // Optional package_name filter
      const packageName = typeof config.package_name === 'string' ? config.package_name : null;
      if (packageName && triggerData.package_name !== packageName) return false;
      return true;
    }

    case 'location.fence_entered':
    case 'location.fence_exited': {
      // Optional geofence_id filter
      const geofenceId = typeof config.geofence_id === 'string' ? config.geofence_id : null;
      if (geofenceId && triggerData.geofence_id !== geofenceId) return false;
      return true;
    }

    // device.enrolled, compliance.changed — no config filters
    default:
      return true;
  }
}
