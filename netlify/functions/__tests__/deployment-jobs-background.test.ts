import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecute,
  mockTransaction,
  mockGetPolicyAmapiContext,
  mockGetDeploymentTargetDeviceIds,
  mockProcessDeploymentJob,
} = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetPolicyAmapiContext: vi.fn(),
  mockGetDeploymentTargetDeviceIds: vi.fn(),
  mockProcessDeploymentJob: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  execute: mockExecute,
  transaction: mockTransaction,
}));

vi.mock('../_lib/internal-auth.js', () => ({
  requireInternalCaller: vi.fn(),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  getPolicyAmapiContext: mockGetPolicyAmapiContext,
}));

vi.mock('../deployment-jobs.ts', () => ({
  getDeploymentTargetDeviceIds: mockGetDeploymentTargetDeviceIds,
  processDeploymentJob: mockProcessDeploymentJob,
}));

import handler from '../deployment-jobs-background.ts';
import { markDatabaseError } from '../_lib/db-errors.js';

const claimedJob = {
  id: 'job_1',
  environment_id: 'env_1',
  policy_id: 'policy_1',
  status: 'running',
  created_by: 'user_1',
};

function request(body: Record<string, unknown> = {}): Request {
  return new Request('http://127.0.0.1:3000/.netlify/functions/deployment-jobs-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'test' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockGetPolicyAmapiContext.mockReset();
  mockGetDeploymentTargetDeviceIds.mockReset();
  mockProcessDeploymentJob.mockReset();
  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockGetPolicyAmapiContext.mockResolvedValue({
    workspace_id: 'ws_1',
    gcp_project_id: 'project_1',
    enterprise_name: 'enterprises/e1',
  });
  mockGetDeploymentTargetDeviceIds.mockResolvedValue(['device_1']);
  mockProcessDeploymentJob.mockResolvedValue(undefined);
});

describe('deployment background worker lifecycle', () => {
  it('returns a degraded 503 when PostgreSQL is unavailable before a claim', async () => {
    mockTransaction.mockRejectedValue(markDatabaseError(Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED',
    })));

    const response = await handler(request(), {} as never);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(response.headers.get('X-Flash-Degraded')).toBe('database');
    expect(mockProcessDeploymentJob).not.toHaveBeenCalled();
  });

  it('keeps a claimed deployment reclaimable when PostgreSQL disappears', async () => {
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [claimedJob] }),
    }));
    mockProcessDeploymentJob.mockRejectedValue(Object.assign(new Error('database restarting'), {
      code: '57P03',
    }));

    const response = await handler(request({ job_id: 'job_1' }), {} as never);

    expect(response.status).toBe(503);
    expect(mockExecute).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'failed'"),
      expect.anything()
    );
  });

  it('returns degraded when persisting a permanent prerequisite failure loses PostgreSQL', async () => {
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [claimedJob] }),
    }));
    mockGetPolicyAmapiContext.mockResolvedValue(null);
    mockExecute.mockRejectedValue(Object.assign(new Error('connection lost'), {
      code: '08006',
    }));

    const response = await handler(request({ job_id: 'job_1' }), {} as never);

    expect(response.status).toBe(503);
    expect(response.headers.get('X-Flash-Degraded')).toBe('database');
  });

  it('atomically claims the oldest pending or stale deployment without a wake-up id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [claimedJob] });
    mockTransaction.mockImplementation(async (fn) => fn({ query }));

    const response = await handler(request(), {} as never);

    expect(response.status).toBe(200);
    expect(String(query.mock.calls[0]?.[0])).toContain("status = 'pending'");
    expect(String(query.mock.calls[0]?.[0])).toContain("status = 'running' AND updated_at < now() - interval '15 minutes'");
    expect(String(query.mock.calls[0]?.[0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(mockProcessDeploymentJob).toHaveBeenCalledWith(
      'job_1', 'policy_1', 'env_1', ['device_1'], expect.any(Object), 'user_1'
    );
  });

  it('returns an idle acknowledgement when another worker won the claim', async () => {
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }));

    const response = await handler(request({ job_id: 'job_1' }), {} as never);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'idle' });
    expect(mockProcessDeploymentJob).not.toHaveBeenCalled();
  });

  it('marks a claimed deployment failed when its permanent prerequisites are gone', async () => {
    mockTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [claimedJob] }),
    }));
    mockGetPolicyAmapiContext.mockResolvedValue(null);

    const response = await handler(request({ job_id: 'job_1' }), {} as never);

    expect(response.status).toBe(400);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'failed'"),
      expect.arrayContaining(['job_1'])
    );
  });
});
