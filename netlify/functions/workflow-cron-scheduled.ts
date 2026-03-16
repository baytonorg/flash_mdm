import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';

export const config = {
  schedule: '*/5 * * * *',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScheduledWorkflow {
  id: string;
  environment_id: string;
  name: string;
  trigger_config: {
    interval_minutes?: number;
    [key: string]: unknown;
  };
  conditions: unknown[];
  action_type: string;
  action_config: Record<string, unknown>;
  scope_type: string;
  scope_id: string | null;
  last_triggered_at: string | null;
}

interface ScopeDevice {
  id: string;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

async function getDevicesInScope(workflow: ScheduledWorkflow): Promise<ScopeDevice[]> {
  if (workflow.scope_type === 'group' && workflow.scope_id) {
    // Get all devices in group and its descendants via closure table
    return query<ScopeDevice>(
      `SELECT d.id FROM devices d
       JOIN group_closures gc ON gc.descendant_id = d.group_id
       WHERE gc.ancestor_id = $1
         AND d.environment_id = $2
         AND d.deleted_at IS NULL`,
      [workflow.scope_id, workflow.environment_id]
    );
  }

  // Default: all devices in environment
  return query<ScopeDevice>(
    'SELECT id FROM devices WHERE environment_id = $1 AND deleted_at IS NULL',
    [workflow.environment_id]
  );
}

function shouldTrigger(workflow: ScheduledWorkflow): boolean {
  const intervalMinutes = workflow.trigger_config.interval_minutes ?? 60;
  if (!workflow.last_triggered_at) return true;

  const lastTriggered = new Date(workflow.last_triggered_at).getTime();
  const now = Date.now();
  const elapsedMinutes = (now - lastTriggered) / (1000 * 60);

  return elapsedMinutes >= intervalMinutes;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export default async (request: Request, context: Context) => {
  console.log('Workflow cron scheduled function started');
  // Note: Netlify scheduled functions cannot be invoked externally — no auth needed

  try {
    // Fetch all enabled scheduled workflows
    const workflows = await query<ScheduledWorkflow>(
      `SELECT id, environment_id, name, trigger_config, conditions, action_type, action_config,
              scope_type, scope_id, last_triggered_at
       FROM workflows
       WHERE trigger_type = 'scheduled'
         AND enabled = true`
    );

    console.log(`Found ${workflows.length} scheduled workflows`);

    let enqueued = 0;

    for (const workflow of workflows) {
      try {
        if (!shouldTrigger(workflow)) {
          continue;
        }

        // Get all devices in scope
        const devices = await getDevicesInScope(workflow);

        if (devices.length === 0) {
          console.log(`Workflow ${workflow.id} (${workflow.name}): no devices in scope`);
          continue;
        }

        console.log(`Workflow ${workflow.id} (${workflow.name}): evaluating against ${devices.length} devices`);

        // Enqueue a background evaluation job for each device
        for (const device of devices) {
          await execute(
            `INSERT INTO job_queue (id, job_type, environment_id, payload, status, scheduled_for)
             VALUES ($1, 'workflow_evaluate', $2, $3, 'pending', now())`,
            [
              crypto.randomUUID(),
              workflow.environment_id,
              JSON.stringify({
                workflow_id: workflow.id,
                device_id: device.id,
                trigger_data: {
                  trigger_type: 'scheduled',
                  scheduled_at: new Date().toISOString(),
                  interval_minutes: workflow.trigger_config.interval_minutes,
                },
              }),
            ]
          );
          enqueued++;
        }

        // Update last_triggered_at to prevent re-triggering on the next cron run
        await execute(
          'UPDATE workflows SET last_triggered_at = now() WHERE id = $1',
          [workflow.id]
        );
      } catch (err) {
        console.error(`Error processing workflow ${workflow.id}:`, err);
      }
    }

    console.log(`Workflow cron completed. Enqueued ${enqueued} evaluation jobs.`);

    // Trigger the queue worker so enqueued workflow_evaluate jobs are processed
    // immediately rather than waiting for the next PubSub event.
    if (enqueued > 0) {
      try {
        const origin = new URL(request.url).origin;
        await fetch(`${origin}/.netlify/functions/sync-process-background`, {
          method: 'POST',
          headers: {
            'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET ?? '',
          },
        });
      } catch (err) {
        console.warn('Failed to trigger queue worker after cron enqueue:', err);
      }
    }
  } catch (err) {
    console.error('Workflow cron error:', err);
  }
};
