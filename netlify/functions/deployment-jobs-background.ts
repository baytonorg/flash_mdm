import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { requireInternalCaller } from './_lib/internal-auth.js';
import { getPolicyAmapiContext } from './_lib/policy-derivatives.js';
import { getDeploymentTargetDeviceIds, processDeploymentJob } from './deployment-jobs.ts';

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

    const body = await request.json() as BackgroundRequestBody;
    if (!body.job_id) {
      return Response.json({ error: 'job_id is required' }, { status: 400 });
    }

    const job = await queryOne<DeploymentJobForBackground>(
      `SELECT id, environment_id, policy_id, status, created_by
       FROM deployment_jobs
       WHERE id = $1`,
      [body.job_id]
    );

    if (!job) {
      return Response.json({ error: 'Deployment job not found' }, { status: 404 });
    }

    if (job.status !== 'pending') {
      return Response.json({ status: 'ignored', reason: `job status is ${job.status}` });
    }

    const amapiContext = await getPolicyAmapiContext(job.environment_id);
    if (!amapiContext) {
      return Response.json({ error: 'Environment is not bound to an enterprise' }, { status: 400 });
    }

    const deviceIds = await getDeploymentTargetDeviceIds(job.policy_id, job.environment_id);
    if (deviceIds.length === 0) {
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
    console.error('deployment-jobs-background error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
