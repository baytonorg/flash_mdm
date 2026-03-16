import type { Context } from '@netlify/functions';
import { query, queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import {
  syncPolicyDerivativesForPolicy,
  getPolicyAmapiContext,
  listAffectedDevicesForPolicyContext,
  assignPolicyToDeviceWithDerivative,
} from './_lib/policy-derivatives.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp } from './_lib/helpers.js';

type DeploymentJobRow = {
  id: string;
  environment_id: string;
  policy_id: string;
  status: string;
  total_devices: number;
  completed_devices: number;
  failed_devices: number;
  skipped_devices: number;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  error_log: Array<{ device_id: string; error: string; timestamp: string }> | string | null;
  rollback_snapshot: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
};

// AMAPI rate limit: ~60 req/min per enterprise. We batch conservatively.
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2000; // 2s between batches → ~30 req/min (safe margin)

type DeploymentJobAmapiContext = {
  workspace_id: string;
  gcp_project_id: string;
  enterprise_name: string;
};

export default async function handler(request: Request, _context: Context) {
  try {
    const auth = await requireAuth(request);
    const method = request.method;
    const params = getSearchParams(request);

  // ── POST /api/deployments — Queue a deployment job ──────────────────
  if (method === 'POST' && !params.get('action')) {
    const body = await parseJsonBody<{
      environment_id: string;
      policy_id: string;
    }>(request);

    if (!body.environment_id || !body.policy_id) {
      return errorResponse('environment_id and policy_id are required');
    }

    await requireEnvironmentPermission(auth, body.environment_id, 'write');

    // Verify policy exists in this environment
    const policy = await queryOne<{ id: string; config: Record<string, unknown> | string | null }>(
      'SELECT id, config FROM policies WHERE id = $1 AND environment_id = $2',
      [body.policy_id, body.environment_id]
    );
    if (!policy) return errorResponse('Policy not found in environment', 404);

    // Get AMAPI context
    const amapiContext = await getPolicyAmapiContext(body.environment_id);
    if (!amapiContext) {
      return errorResponse('Environment is not bound to an enterprise', 400);
    }

    // Count affected devices
    const allDeviceIds = await getDeploymentTargetDeviceIds(body.policy_id, body.environment_id);

    const totalDevices = allDeviceIds.length;
    if (totalDevices === 0) {
      return errorResponse('No devices affected by this policy', 400);
    }

    // Capture rollback snapshot — current derivative hashes per device
    const existingDerivatives = await query<{ scope_id: string; payload_hash: string; amapi_name: string | null }>(
      `SELECT scope_id, payload_hash, amapi_name FROM policy_derivatives
       WHERE policy_id = $1 AND scope_type = 'device'`,
      [body.policy_id]
    );
    const rollbackSnapshot: Record<string, { payload_hash: string; amapi_name: string | null }> = {};
    for (const d of existingDerivatives) {
      rollbackSnapshot[d.scope_id] = { payload_hash: d.payload_hash, amapi_name: d.amapi_name };
    }

    // Create the job
    const job = await queryOne<{ id: string }>(
      `INSERT INTO deployment_jobs (environment_id, policy_id, total_devices, created_by, rollback_snapshot)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [body.environment_id, body.policy_id, totalDevices, auth.user.id, JSON.stringify(rollbackSnapshot)]
    );

    if (!job) return errorResponse('Failed to create deployment job', 500);

    await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'deployment.create',
      resource_type: 'deployment_job',
      resource_id: job.id,
      details: { policy_id: body.policy_id, total_devices: totalDevices },
      ip_address: getClientIp(request),
    });

    await triggerDeploymentJobBackground(request, job.id);

    return jsonResponse({ job: { id: job.id, status: 'pending', total_devices: totalDevices } }, 201);
  }

  // ── GET /api/deployments — List or get a single job ────────────────
  if (method === 'GET') {
    const jobId = params.get('id');
    const environmentId = params.get('environment_id');

    if (jobId) {
      const job = await queryOne<DeploymentJobRow>(
        'SELECT * FROM deployment_jobs WHERE id = $1',
        [jobId]
      );
      if (!job) return errorResponse('Deployment job not found', 404);
      await requireEnvironmentPermission(auth, job.environment_id, 'read');

      return jsonResponse({
        job: normalizeJob(job),
      });
    }

    if (!environmentId) return errorResponse('environment_id is required');
    await requireEnvironmentPermission(auth, environmentId, 'read');

    const jobs = await query<DeploymentJobRow>(
      `SELECT * FROM deployment_jobs
       WHERE environment_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [environmentId]
    );

    return jsonResponse({ jobs: jobs.map(normalizeJob) });
  }

  // ── POST /api/deployments?action=cancel — Cancel a running job ─────
  if (method === 'POST' && params.get('action') === 'cancel') {
    const body = await parseJsonBody<{ job_id: string }>(request);
    if (!body.job_id) return errorResponse('job_id is required');

    const job = await queryOne<DeploymentJobRow>(
      'SELECT * FROM deployment_jobs WHERE id = $1',
      [body.job_id]
    );
    if (!job) return errorResponse('Deployment job not found', 404);
    await requireEnvironmentPermission(auth, job.environment_id, 'write');

    if (job.status !== 'pending' && job.status !== 'running') {
      return errorResponse(`Cannot cancel job with status: ${job.status}`, 400);
    }

    await execute(
      `UPDATE deployment_jobs SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`,
      [body.job_id]
    );

    await logAudit({
      environment_id: job.environment_id,
      user_id: auth.user.id,
      action: 'deployment.cancel',
      resource_type: 'deployment_job',
      resource_id: body.job_id,
      details: { policy_id: job.policy_id },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ status: 'cancelled' });
  }

  // ── POST /api/deployments?action=rollback — Rollback to pre-deploy ─
  if (method === 'POST' && params.get('action') === 'rollback') {
    const body = await parseJsonBody<{ job_id: string }>(request);
    if (!body.job_id) return errorResponse('job_id is required');

    const job = await queryOne<DeploymentJobRow>(
      'SELECT * FROM deployment_jobs WHERE id = $1',
      [body.job_id]
    );
    if (!job) return errorResponse('Deployment job not found', 404);
    await requireEnvironmentPermission(auth, job.environment_id, 'write');

    if (job.status !== 'completed' && job.status !== 'failed') {
      return errorResponse(`Cannot rollback job with status: ${job.status}. Must be completed or failed.`, 400);
    }

    const snapshot = typeof job.rollback_snapshot === 'string'
      ? JSON.parse(job.rollback_snapshot)
      : job.rollback_snapshot;

    if (!snapshot || Object.keys(snapshot).length === 0) {
      return errorResponse('No rollback snapshot available for this job', 400);
    }

    // Mark the job as rolling back
    await execute(
      `UPDATE deployment_jobs SET status = 'rolling_back', updated_at = now() WHERE id = $1`,
      [body.job_id]
    );

    // Re-sync derivatives from the base policy (effectively regenerates from current state)
    const amapiContext = await getPolicyAmapiContext(job.environment_id);
    if (!amapiContext) {
      return errorResponse('Environment is not bound to an enterprise', 400);
    }

    const policy = await queryOne<{ config: Record<string, unknown> | string | null }>(
      'SELECT config FROM policies WHERE id = $1',
      [job.policy_id]
    );

    try {
      await syncPolicyDerivativesForPolicy({
        policyId: job.policy_id,
        environmentId: job.environment_id,
        baseConfig: policy?.config ?? {},
        amapiContext,
      });

      await execute(
        `UPDATE deployment_jobs SET status = 'rolled_back', updated_at = now() WHERE id = $1`,
        [body.job_id]
      );

      await logAudit({
        environment_id: job.environment_id,
        user_id: auth.user.id,
        action: 'deployment.rollback',
        resource_type: 'deployment_job',
        resource_id: body.job_id,
        details: { policy_id: job.policy_id },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ status: 'rolled_back' });
    } catch (err) {
      await execute(
        `UPDATE deployment_jobs SET status = 'rollback_failed', updated_at = now() WHERE id = $1`,
        [body.job_id]
      );
      return errorResponse(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('deployment-jobs error:', err);
    return errorResponse('Internal server error', 500);
  }
}

/**
 * Process a deployment job: generate derivatives and push to each device.
 * Runs in batches to respect AMAPI rate limits.
 */
export async function processDeploymentJob(
  jobId: string,
  policyId: string,
  environmentId: string,
  deviceIds: string[],
  amapiContext: DeploymentJobAmapiContext,
  userId: string
): Promise<void> {
  // Mark as running
  await execute(
    `UPDATE deployment_jobs SET status = 'running', started_at = now(), updated_at = now() WHERE id = $1`,
    [jobId]
  );

  // First, sync all policy derivatives (env, group, device scopes)
  const policy = await queryOne<{ config: Record<string, unknown> | string | null }>(
    'SELECT config FROM policies WHERE id = $1',
    [policyId]
  );

  try {
    await syncPolicyDerivativesForPolicy({
      policyId,
      environmentId,
      baseConfig: policy?.config ?? {},
      amapiContext,
    });
  } catch (err) {
    console.error('deployment-jobs: derivative sync failed', { job_id: jobId, error: String(err) });
    await execute(
      `UPDATE deployment_jobs SET status = 'failed', error_log = $2::jsonb, completed_at = now(), updated_at = now() WHERE id = $1`,
      [jobId, JSON.stringify([{ device_id: 'all', error: `Derivative sync failed: ${String(err)}`, timestamp: new Date().toISOString() }])]
    );
    return;
  }

  // Now push policy assignments to each device in batches
  const errorLog: Array<{ device_id: string; error: string; timestamp: string }> = [];
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let wasCancelled = false;

  for (let i = 0; i < deviceIds.length; i += BATCH_SIZE) {
    // Check for cancellation before each batch
    const currentJob = await queryOne<{ status: string }>('SELECT status FROM deployment_jobs WHERE id = $1', [jobId]);
    if (currentJob?.status === 'cancelled') {
      skipped = deviceIds.length - i;
      wasCancelled = true;
      break;
    }

    const batch = deviceIds.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (deviceId) => {
        try {
          await assignPolicyToDeviceWithDerivative({
            policyId,
            environmentId,
            deviceId,
            amapiContext,
            baseConfig: policy?.config ?? {},
          });
          completed++;
        } catch (err) {
          failed++;
          errorLog.push({
            device_id: deviceId,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          });
        }
      })
    );

    // Update progress after each batch
    await execute(
      `UPDATE deployment_jobs
       SET completed_devices = $2, failed_devices = $3, skipped_devices = $4,
           error_log = $5::jsonb, updated_at = now()
       WHERE id = $1`,
      [jobId, completed, failed, skipped, JSON.stringify(errorLog.slice(-100))] // Keep last 100 errors
    );

    // Rate limit delay between batches (skip if last batch)
    if (i + BATCH_SIZE < deviceIds.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Preserve cancellation state if the job was cancelled during processing.
  // Re-check here to catch cancellations that happen after the last loop check.
  const terminalJob = await queryOne<{ status: string }>('SELECT status FROM deployment_jobs WHERE id = $1', [jobId]);
  if (wasCancelled || terminalJob?.status === 'cancelled') {
    await execute(
      `UPDATE deployment_jobs
       SET completed_devices = $2, failed_devices = $3, skipped_devices = $4,
           error_log = $5::jsonb, updated_at = now()
       WHERE id = $1`,
      [jobId, completed, failed, skipped, JSON.stringify(errorLog.slice(-100))]
    );
    return;
  }

  // Mark as completed or failed
  const finalStatus = failed === deviceIds.length ? 'failed' : 'completed';
  await execute(
    `UPDATE deployment_jobs
     SET status = $2, completed_devices = $3, failed_devices = $4, skipped_devices = $5,
         error_log = $6::jsonb, completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [jobId, finalStatus, completed, failed, skipped, JSON.stringify(errorLog.slice(-100))]
  );
}

export async function getDeploymentTargetDeviceIds(policyId: string, environmentId: string): Promise<string[]> {
  const assignments = await query<{ scope_type: string; scope_id: string }>(
    'SELECT scope_type, scope_id FROM policy_assignments WHERE policy_id = $1 ORDER BY created_at',
    [policyId]
  );

  if (assignments.length === 0) {
    return [];
  }

  const allDeviceIds = new Set<string>();
  for (const assignment of assignments) {
    const devices = await listAffectedDevicesForPolicyContext(
      policyId,
      environmentId,
      assignment.scope_type as 'environment' | 'group' | 'device',
      assignment.scope_id
    );
    for (const device of devices) allDeviceIds.add(device.id);
  }

  return [...allDeviceIds];
}

async function triggerDeploymentJobBackground(request: Request, jobId: string): Promise<void> {
  try {
    const origin = new URL(request.url).origin;
    const response = await fetch(`${origin}/.netlify/functions/deployment-jobs-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET ?? '',
      },
      body: JSON.stringify({ job_id: jobId }),
    });

    if (!response.ok) {
      console.warn('deployment-jobs: background trigger returned non-OK response', {
        job_id: jobId,
        status: response.status,
      });
    }
  } catch (err) {
    console.warn('deployment-jobs: failed to trigger background processor', {
      job_id: jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function normalizeJob(job: DeploymentJobRow) {
  return {
    ...job,
    error_log: typeof job.error_log === 'string' ? JSON.parse(job.error_log) : (job.error_log ?? []),
    rollback_snapshot: undefined, // Don't expose snapshot to frontend
  };
}
