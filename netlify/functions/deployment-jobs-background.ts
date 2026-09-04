import type { Context } from '@netlify/functions';
import { execute, transaction } from './_lib/db.js';
import { requireInternalCaller } from './_lib/internal-auth.js';
import { getPolicyAmapiContext } from './_lib/policy-derivatives.js';
import { getDeploymentTargetDeviceIds, processDeploymentJob } from './deployment-jobs.ts';
import {
  databaseUnavailableResponse,
  isDatabaseInfrastructureError,
} from './_lib/db-errors.js';

export const config = {
  type: 'background',
};

type BackgroundRequestBody = {
  job_id?: string;
};

type DeploymentJobForBackground = {
  id: string;
  environment_id: string;
  policy_id: string;
  status: string;
  created_by: string | null;
};

export default async function handler(request: Request, _context: Context): Promise<Response> {
  try {
    requireInternalCaller(request);

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await request.json().catch(() => ({})) as BackgroundRequestBody;
    const job = await claimDeploymentJob(body.job_id);

    if (!job) return Response.json({ status: 'idle' }, { status: 202 });

    const amapiContext = await getPolicyAmapiContext(job.environment_id);
    if (!amapiContext) {
      await failDeploymentJob(job.id, 'Environment is not bound to an enterprise');
      return Response.json({ error: 'Environment is not bound to an enterprise' }, { status: 400 });
    }

    const deviceIds = await getDeploymentTargetDeviceIds(job.policy_id, job.environment_id);
    if (deviceIds.length === 0) {
      await failDeploymentJob(job.id, 'No devices affected by this policy');
      return Response.json({ error: 'No devices affected by this policy' }, { status: 400 });
    }

    await processDeploymentJob(
      job.id,
      job.policy_id,
      job.environment_id,
      deviceIds,
      amapiContext,
      job.created_by ?? 'system'
    );

    return Response.json({ status: 'processed', job_id: job.id });
  } catch (err) {
    if (isDatabaseInfrastructureError(err)) {
      return databaseUnavailableResponse();
    }
    console.error('deployment-jobs-background error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function failDeploymentJob(jobId: string, message: string): Promise<void> {
  await execute(
    `UPDATE deployment_jobs
     SET status = 'failed',
         error_log = $2::jsonb,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [jobId, JSON.stringify([{ device_id: 'all', error: message, timestamp: new Date().toISOString() }])]
  );
}

export async function claimDeploymentJob(jobId?: string): Promise<DeploymentJobForBackground | null> {
  return transaction(async (client) => {
    const result = await client.query<DeploymentJobForBackground>(
      `WITH candidate AS (
         SELECT id
         FROM deployment_jobs
         WHERE ($1::text IS NULL OR id::text = $1)
           AND (
             status = 'pending'
             OR (status = 'running' AND updated_at < now() - interval '15 minutes')
           )
         ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE deployment_jobs dj
       SET status = 'running',
           started_at = COALESCE(dj.started_at, now()),
           updated_at = now()
       FROM candidate
       WHERE dj.id = candidate.id
       RETURNING dj.id, dj.environment_id, dj.policy_id, dj.status, dj.created_by`,
      [jobId ?? null]
    );
    return result.rows[0] ?? null;
  });
}
