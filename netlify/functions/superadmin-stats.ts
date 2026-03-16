import type { Context } from '@netlify/functions';
import { requireSuperadmin } from './_lib/auth.js';
import { queryOne, query } from './_lib/db.js';
import { getBlobJson } from './_lib/blobs.js';
import { jsonResponse, errorResponse } from './_lib/helpers.js';

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function summarizeJobPayload(value: unknown): Record<string, unknown> | null {
  const payload = parseJsonObject(value);
  if (!payload) return null;

  const summary: Record<string, unknown> = {};
  const scalarFields = [
    'event_message_id',
    'notification_type',
    'device_amapi_name',
    'device_id',
    'command_type',
    'workflow_id',
    'url',
    'method',
  ];

  for (const field of scalarFields) {
    const fieldValue = payload[field];
    if (
      typeof fieldValue === 'string'
      || typeof fieldValue === 'number'
      || typeof fieldValue === 'boolean'
    ) {
      summary[field] = fieldValue;
    }
  }

  const triggerData = parseJsonObject(payload.trigger_data);
  if (triggerData) {
    summary.trigger_keys = Object.keys(triggerData).slice(0, 12);
  }

  if (Object.keys(summary).length === 0) {
    summary.payload_keys = Object.keys(payload).slice(0, 12);
  }

  return summary;
}

function summarizeWorkflowResult(value: unknown): Record<string, unknown> | null {
  const result = parseJsonObject(value);
  if (!result) return null;

  const summary: Record<string, unknown> = {};
  if (typeof result.action_type === 'string') summary.action_type = result.action_type;
  if (typeof result.command === 'string') summary.command = result.command;
  if (typeof result.message === 'string') summary.message = result.message;
  if (typeof result.error === 'string') summary.error = result.error;
  if (typeof result.workflow_execution_id === 'string') {
    summary.workflow_execution_id = result.workflow_execution_id;
  }
  if (typeof result.command_name === 'string') summary.command_name = result.command_name;

  if (Object.keys(summary).length === 0) {
    summary.result_keys = Object.keys(result).slice(0, 12);
  }

  return summary;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    await requireSuperadmin(request);

    // Get totals
    const totalWorkspaces = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workspaces`,
      []
    );
    const totalEnvironments = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM environments`,
      []
    );
    const totalDevices = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM devices`,
      []
    );
    const totalUsers = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM users`,
      []
    );

    // Devices by plan
    const devicesByPlan = await query<{ plan_name: string; device_count: string }>(
      `SELECT COALESCE(lp.name, 'No Licence') as plan_name, COUNT(d.id) as device_count
       FROM devices d
       JOIN environments e ON e.id = d.environment_id
       LEFT JOIN licenses l ON l.workspace_id = e.workspace_id AND l.status = 'active'
       LEFT JOIN license_plans lp ON lp.id = l.plan_id
       GROUP BY lp.name
       ORDER BY device_count DESC`,
      []
    );

    // Recent signups (last 30 days)
    const recentSignups = await query<{ date: string; count: string }>(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM workspaces
       WHERE created_at > now() - interval '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      []
    );

    const recentPubSubEvents = await query<{
      environment_id: string;
      message_id: string;
      notification_type: string;
      device_amapi_name: string | null;
      status: string | null;
      error: string | null;
      created_at: string;
      processed_at: string | null;
    }>(
      `SELECT environment_id, message_id, notification_type, device_amapi_name, status, error, created_at, processed_at
       FROM pubsub_events
       ORDER BY created_at DESC
       LIMIT 15`,
      []
    );

    const pubsubLogEvents = await Promise.all(
      recentPubSubEvents.map(async (event) => {
        let rawPreview: Record<string, unknown> | null = null;
        try {
          const blob = await getBlobJson<{
            received_at?: string;
            message?: { messageId?: string; attributes?: Record<string, string> };
            payload?: Record<string, unknown>;
          }>('pubsub-raw', `${event.environment_id}/${event.message_id}.json`);
          if (blob) {
            rawPreview = {
              received_at: blob.received_at ?? null,
              attributes: blob.message?.attributes ?? null,
              payload: blob.payload ?? null,
            };
          }
        } catch {
          // Keep stats endpoint resilient if blobs are unavailable/missing.
          rawPreview = null;
        }

        return {
          environment_id: event.environment_id,
          message_id: event.message_id,
          notification_type: event.notification_type,
          device_amapi_name: event.device_amapi_name,
          status: event.status ?? 'pending',
          error: event.error,
          created_at: event.created_at,
          processed_at: event.processed_at,
          raw_preview: rawPreview,
        };
      })
    );

    const recentDerivativeDecisions = await query<{
      id: string;
      workspace_id: string | null;
      environment_id: string | null;
      device_id: string | null;
      created_at: string;
      details: Record<string, unknown> | string | null;
      workspace_name: string | null;
      environment_name: string | null;
      device_amapi_name: string | null;
      serial_number: string | null;
    }>(
      `SELECT a.id,
              a.workspace_id,
              a.environment_id,
              a.device_id,
              a.created_at,
              a.details,
              w.name AS workspace_name,
              e.name AS environment_name,
              d.amapi_name AS device_amapi_name,
              d.serial_number
       FROM audit_log a
       LEFT JOIN workspaces w ON w.id = a.workspace_id
       LEFT JOIN environments e ON e.id = a.environment_id
       LEFT JOIN devices d ON d.id = a.device_id
       WHERE a.action = 'policy.derivative_decision'
       ORDER BY a.created_at DESC
       LIMIT 30`,
      []
    );

    const derivativeDecisionEvents = recentDerivativeDecisions.map((event) => {
      const details = parseJsonObject(event.details) ?? {};
      return {
        id: event.id,
        workspace_id: event.workspace_id,
        workspace_name: event.workspace_name,
        environment_id: event.environment_id,
        environment_name: event.environment_name,
        device_id: event.device_id,
        device_amapi_name: event.device_amapi_name,
        serial_number: event.serial_number,
        created_at: event.created_at,
        details: {
          policy_id: details.policy_id ?? null,
          expected_scope: details.expected_scope ?? null,
          expected_amapi_name: details.expected_amapi_name ?? null,
          reason_code: details.reason_code ?? null,
          can_noop: details.can_noop ?? null,
          used_device_derivative: details.used_device_derivative ?? null,
          device_derivative_required: details.device_derivative_required ?? null,
          device_derivative_redundant: details.device_derivative_redundant ?? null,
          expected_generation_hash: details.expected_generation_hash ?? null,
          stored_generation_hash: details.stored_generation_hash ?? null,
        },
      };
    });

    const recentJobQueueRows = await query<{
      id: string;
      job_type: string;
      environment_id: string | null;
      environment_name: string | null;
      status: string | null;
      attempts: number | null;
      max_attempts: number | null;
      scheduled_for: string | null;
      locked_at: string | null;
      completed_at: string | null;
      error: string | null;
      payload: Record<string, unknown> | string | null;
      created_at: string;
    }>(
      `SELECT jq.id,
              jq.job_type,
              jq.environment_id,
              e.name AS environment_name,
              jq.status,
              jq.attempts,
              jq.max_attempts,
              jq.scheduled_for,
              jq.locked_at,
              jq.completed_at,
              jq.error,
              jq.payload,
              jq.created_at
       FROM job_queue jq
       LEFT JOIN environments e ON e.id = jq.environment_id
       ORDER BY jq.created_at DESC
       LIMIT 30`,
      []
    );

    const jobQueueEvents = recentJobQueueRows.map((row) => ({
      id: row.id,
      job_type: row.job_type,
      environment_id: row.environment_id,
      environment_name: row.environment_name,
      status: row.status ?? 'pending',
      attempts: row.attempts ?? 0,
      max_attempts: row.max_attempts ?? 0,
      scheduled_for: row.scheduled_for,
      locked_at: row.locked_at,
      completed_at: row.completed_at,
      error: row.error,
      created_at: row.created_at,
      payload_summary: summarizeJobPayload(row.payload),
    }));

    const recentWorkflowExecutions = await query<{
      id: string;
      workflow_id: string;
      workflow_name: string | null;
      environment_id: string | null;
      environment_name: string | null;
      device_id: string | null;
      device_amapi_name: string | null;
      serial_number: string | null;
      status: string | null;
      result: Record<string, unknown> | string | null;
      created_at: string;
    }>(
      `SELECT we.id,
              we.workflow_id,
              w.name AS workflow_name,
              w.environment_id,
              e.name AS environment_name,
              we.device_id,
              d.amapi_name AS device_amapi_name,
              d.serial_number,
              we.status,
              we.result,
              we.created_at
       FROM workflow_executions we
       JOIN workflows w ON w.id = we.workflow_id
       LEFT JOIN environments e ON e.id = w.environment_id
       LEFT JOIN devices d ON d.id = we.device_id
       ORDER BY we.created_at DESC
       LIMIT 30`,
      []
    );

    const workflowExecutionEvents = recentWorkflowExecutions.map((row) => ({
      id: row.id,
      workflow_id: row.workflow_id,
      workflow_name: row.workflow_name,
      environment_id: row.environment_id,
      environment_name: row.environment_name,
      device_id: row.device_id,
      device_amapi_name: row.device_amapi_name,
      serial_number: row.serial_number,
      status: row.status ?? 'pending',
      created_at: row.created_at,
      result_preview: summarizeWorkflowResult(row.result),
    }));

    const recentGeofenceEvents = await query<{
      id: string;
      environment_id: string | null;
      environment_name: string | null;
      device_id: string | null;
      device_amapi_name: string | null;
      serial_number: string | null;
      action: string;
      details: Record<string, unknown> | string | null;
      created_at: string;
    }>(
      `SELECT a.id,
              a.environment_id,
              e.name AS environment_name,
              a.device_id,
              d.amapi_name AS device_amapi_name,
              d.serial_number,
              a.action,
              a.details,
              a.created_at
       FROM audit_log a
       LEFT JOIN environments e ON e.id = a.environment_id
       LEFT JOIN devices d ON d.id = a.device_id
       WHERE a.action IN ('geofence.device_enter', 'geofence.device_exit')
       ORDER BY a.created_at DESC
       LIMIT 30`,
      []
    );

    const geofenceWorkerEvents = recentGeofenceEvents.map((row) => ({
      id: row.id,
      environment_id: row.environment_id,
      environment_name: row.environment_name,
      device_id: row.device_id,
      device_amapi_name: row.device_amapi_name,
      serial_number: row.serial_number,
      action: row.action,
      created_at: row.created_at,
      details: parseJsonObject(row.details),
    }));

    const recentReconcileEvents = await query<{
      id: string;
      environment_id: string | null;
      environment_name: string | null;
      resource_type: string | null;
      resource_id: string | null;
      action: string;
      details: Record<string, unknown> | string | null;
      created_at: string;
    }>(
      `SELECT a.id,
              a.environment_id,
              e.name AS environment_name,
              a.resource_type,
              a.resource_id::text,
              a.action,
              a.details,
              a.created_at
       FROM audit_log a
       LEFT JOIN environments e ON e.id = a.environment_id
       WHERE a.action IN ('device.deleted_by_reconciliation', 'environment.enterprise_upgrade_status_synced')
       ORDER BY a.created_at DESC
       LIMIT 30`,
      []
    );

    const reconcileEvents = recentReconcileEvents.map((row) => ({
      id: row.id,
      environment_id: row.environment_id,
      environment_name: row.environment_name,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      action: row.action,
      details: parseJsonObject(row.details),
      created_at: row.created_at,
    }));

    return jsonResponse({
      total_workspaces: parseInt(totalWorkspaces?.count ?? '0', 10),
      total_environments: parseInt(totalEnvironments?.count ?? '0', 10),
      total_devices: parseInt(totalDevices?.count ?? '0', 10),
      total_users: parseInt(totalUsers?.count ?? '0', 10),
      devices_by_plan: devicesByPlan.map((r) => ({
        plan_name: r.plan_name,
        device_count: parseInt(r.device_count, 10),
      })),
      recent_signups: recentSignups.map((r) => ({
        date: r.date,
        count: parseInt(r.count, 10),
      })),
      function_logs: {
        pubsub_webhook: {
          events: pubsubLogEvents,
        },
        derivative_selection: {
          events: derivativeDecisionEvents,
        },
        job_queue: {
          events: jobQueueEvents,
        },
        workflow_execution: {
          events: workflowExecutionEvents,
        },
        geofence_worker: {
          events: geofenceWorkerEvents,
        },
        sync_reconcile: {
          events: reconcileEvents,
        },
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Superadmin stats error:', err);
    return errorResponse('Internal server error', 500);
  }
}
