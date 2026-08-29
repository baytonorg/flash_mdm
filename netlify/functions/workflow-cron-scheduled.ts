import type { Context } from '@netlify/functions';
import type pg from 'pg';
import { query, transaction } from './_lib/db.js';
import { internalFunctionUrl, shouldTriggerBackgroundFunction } from './_lib/runtime.js';

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

async function getDevicesInScope(client: pg.PoolClient, workflow: ScheduledWorkflow): Promise<ScopeDevice[]> {
  if (workflow.scope_type === 'device') {
    if (!workflow.scope_id) return [];
    const result = await client.query<ScopeDevice>(
      `SELECT id FROM devices
       WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL`,
      [workflow.scope_id, workflow.environment_id]
    );
    return result.rows;
  }

  if (workflow.scope_type === 'group' && workflow.scope_id) {
    // Get all devices in group and its descendants via closure table
    const result = await client.query<ScopeDevice>(
      `SELECT d.id FROM devices d
       JOIN group_closures gc ON gc.descendant_id = d.group_id
       WHERE gc.ancestor_id = $1
         AND d.environment_id = $2
         AND d.deleted_at IS NULL`,
      [workflow.scope_id, workflow.environment_id]
    );
    return result.rows;
  }

  if (workflow.scope_type !== 'environment') return [];

  const result = await client.query<ScopeDevice>(
    'SELECT id FROM devices WHERE environment_id = $1 AND deleted_at IS NULL',
    [workflow.environment_id]
  );
  return result.rows;
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

export default async (request: Request, _context: Context) => {
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
    let errors = 0;

    for (const workflow of workflows) {
      try {
        const workflowEnqueued = await transaction(async (client) => {
          // Serialize each workflow's eligibility check, inserts, and timestamp.
          // Concurrent Netlify invocations and a long-running VPS process therefore
          // observe one committed interval boundary.
          const locked = await client.query<ScheduledWorkflow>(
            `SELECT id, environment_id, name, trigger_config, conditions, action_type, action_config,
                    scope_type, scope_id, last_triggered_at
             FROM workflows
             WHERE id = $1 AND trigger_type = 'scheduled' AND enabled = true
             FOR UPDATE`,
            [workflow.id]
          );
          const current = locked.rows[0];
          if (!current || !shouldTrigger(current)) return 0;

          const devices = await getDevicesInScope(client, current);
          if (devices.length === 0) {
            console.log(`Workflow ${current.id} (${current.name}): no devices in scope`);
            return 0;
          }

          console.log(`Workflow ${current.id} (${current.name}): evaluating against ${devices.length} devices`);
          for (const device of devices) {
            await client.query(
              `INSERT INTO job_queue (id, job_type, environment_id, payload, status, scheduled_for)
               VALUES ($1, 'workflow_evaluate', $2, $3, 'pending', now())`,
              [
                crypto.randomUUID(),
                current.environment_id,
                JSON.stringify({
                  workflow_id: current.id,
                  device_id: device.id,
                  trigger_data: {
                    trigger_type: 'scheduled',
                    scheduled_at: new Date().toISOString(),
                    interval_minutes: current.trigger_config.interval_minutes,
                  },
                }),
              ]
            );
          }

          await client.query(
            'UPDATE workflows SET last_triggered_at = now() WHERE id = $1',
            [current.id]
          );
          return devices.length;
        });
        enqueued += workflowEnqueued;
      } catch (err) {
        errors++;
        console.error(`Error processing workflow ${workflow.id}:`, err);
      }
    }

    console.log(`Workflow cron completed. Enqueued ${enqueued} evaluation jobs.`);

    // Trigger the queue worker so enqueued workflow_evaluate jobs are processed
    // immediately rather than waiting for the next PubSub event.
    if (enqueued > 0) {
      try {
        if (shouldTriggerBackgroundFunction()) await fetch(internalFunctionUrl(request, 'sync-process-background'), {
          method: 'POST',
          headers: {
            'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET ?? '',
          },
        });
      } catch (err) {
        console.warn('Failed to trigger queue worker after cron enqueue:', err);
      }
    }
    return new Response(JSON.stringify({
      message: errors > 0 ? 'Workflow cron completed with errors' : 'Workflow cron completed',
      stats: { enqueued, errors },
    }), {
      status: errors > 0 ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Workflow cron error:', err);
    return new Response(JSON.stringify({ error: 'Workflow cron failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
