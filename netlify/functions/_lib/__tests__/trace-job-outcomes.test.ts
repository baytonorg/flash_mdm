// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
  dispatch: vi.fn(), sync: vi.fn(), event: vi.fn(),
}));
vi.mock('../db.js', () => mocks);
vi.mock('../internal-auth.js', () => ({requireInternalCaller: vi.fn()}));
vi.mock('../operational-trace.js', async importOriginal => ({
  ...await importOriginal<typeof import('../operational-trace.js')>(), traceEvent: mocks.event,
}));
vi.mock('../policy-derivatives.js', async importOriginal => ({
  ...await importOriginal<typeof import('../policy-derivatives.js')>(),
  syncPolicyDerivativesForPolicy: mocks.sync, assignPolicyToDeviceWithDerivative: mocks.dispatch,
}));
import processQueue from '../../sync-process-background.js';
import { processDeploymentJob } from '../../deployment-jobs.js';
beforeEach(() => vi.resetAllMocks());

describe('terminal worker evidence', () => {
  it('emits committed lease exhaustion without re-dispatching a dead job', async () => {
    const id = randomUUID();
    mocks.transaction.mockImplementation(fn => fn({query: (sql: string) => {
      // The final SELECT must return expired dead leases, including their status.
      expect(sql).toMatch(/SELECT id, job_type, environment_id, payload, attempts, max_attempts, status\s+FROM claimed\s*$/);
      return {rows: [{id, status:'dead', attempts:5, job_type:'device_command'}]};
    }}));
    const response = await processQueue(new Request('http://localhost/.netlify/functions/sync-process-background', {method:'POST'}), {} as never);
    expect((await response.json()).jobs).toBe(0);
    expect(mocks.event).toHaveBeenCalledWith('job.transition',{job_id:id,status:'dead',outcome:'dead',attempts:5,reason:'expired_lease'});
    expect(mocks.event).not.toHaveBeenCalledWith('job.start',expect.anything());
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(['cancelled','failure','partial_failure','success'])('records the %s outcome after deployment writes finish', async outcome => {
    const id = randomUUID();
    const status = outcome === 'cancelled' ? 'cancelled' : 'running';
    mocks.queryOne.mockResolvedValueOnce({config:{}}).mockResolvedValue({status});
    if (outcome === 'failure') mocks.dispatch.mockRejectedValue(Error('fixture failure'));
    if (outcome === 'partial_failure') mocks.dispatch.mockRejectedValueOnce(Error('fixture failure'));
    await processDeploymentJob(id,'policy','environment',['device-one','device-two'],{
      workspace_id:'workspace',gcp_project_id:'fixture',enterprise_name:'enterprises/fixture',
    },'system');
    expect(mocks.event).toHaveBeenCalledWith('job.transition',expect.objectContaining(
      outcome === 'cancelled' ? {status:'cancelled',skipped:2} : {outcome},
    ));
    expect(mocks.execute.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.event.mock.invocationCallOrder.at(-1)!);
  });
});
