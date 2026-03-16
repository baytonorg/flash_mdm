import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentPermission: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  syncPolicyDerivativesForPolicy: vi.fn(),
  getPolicyAmapiContext: vi.fn(),
  listAffectedDevicesForPolicyContext: vi.fn(),
  assignPolicyToDeviceWithDerivative: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  jsonResponse: vi.fn((data: unknown, status = 200) => Response.json(data, { status })),
  errorResponse: vi.fn((message: string, status = 400) => Response.json({ error: message }, { status })),
  parseJsonBody: vi.fn(),
  getSearchParams: vi.fn((req: Request) => new URL(req.url).searchParams),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { queryOne, execute } from '../_lib/db.js';
import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import { parseJsonBody } from '../_lib/helpers.js';
import {
  getPolicyAmapiContext,
  listAffectedDevicesForPolicyContext,
  syncPolicyDerivativesForPolicy,
  assignPolicyToDeviceWithDerivative,
} from '../_lib/policy-derivatives.js';
import handler, { processDeploymentJob } from '../deployment-jobs.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockLogAudit = vi.mocked(logAudit);
const mockParseJsonBody = vi.mocked(parseJsonBody);
const mockGetPolicyAmapiContext = vi.mocked(getPolicyAmapiContext);
const mockListAffectedDevicesForPolicyContext = vi.mocked(listAffectedDevicesForPolicyContext);
const mockSyncPolicyDerivativesForPolicy = vi.mocked(syncPolicyDerivativesForPolicy);
const mockAssignPolicyToDeviceWithDerivative = vi.mocked(assignPolicyToDeviceWithDerivative);

function makeCreateRequest(): Request {
  return new Request('http://localhost/.netlify/functions/deployment-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      environment_id: 'env_1',
      policy_id: 'policy_1',
    }),
  });
}

describe('processDeploymentJob cancellation handling', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvironmentPermission.mockReset();
    mockLogAudit.mockReset();
    mockParseJsonBody.mockReset();
    mockGetPolicyAmapiContext.mockReset();
    mockListAffectedDevicesForPolicyContext.mockReset();
    mockSyncPolicyDerivativesForPolicy.mockReset();
    mockAssignPolicyToDeviceWithDerivative.mockReset();
    vi.restoreAllMocks();

    mockQuery.mockResolvedValue([] as never);
    mockSyncPolicyDerivativesForPolicy.mockResolvedValue(undefined as never);
    mockAssignPolicyToDeviceWithDerivative.mockResolvedValue(undefined as never);
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
    mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } } as never);
    mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
    mockLogAudit.mockResolvedValue(undefined as never);
    mockParseJsonBody.mockResolvedValue({ environment_id: 'env_1', policy_id: 'policy_1' } as never);
    mockGetPolicyAmapiContext.mockResolvedValue({
      workspace_id: 'ws_1',
      gcp_project_id: 'proj_1',
      enterprise_name: 'enterprises/e1',
    } as never);
    mockListAffectedDevicesForPolicyContext.mockResolvedValue([{ id: 'device_1' }, { id: 'device_2' }] as never);
  });

  it('does not overwrite cancelled jobs with completed/failed during finalization', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ config: {} } as never) // policy lookup
      .mockResolvedValueOnce({ status: 'cancelled' } as never) // loop cancellation check
      .mockResolvedValueOnce({ status: 'cancelled' } as never); // terminal re-check

    await processDeploymentJob(
      'job_1',
      'policy_1',
      'env_1',
      ['device_1', 'device_2'],
      {
        workspace_id: 'ws_1',
        gcp_project_id: 'proj_1',
        enterprise_name: 'enterprises/e1',
      },
      'user_1'
    );

    expect(mockAssignPolicyToDeviceWithDerivative).not.toHaveBeenCalled();

    const sqlCalls = mockExecute.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.some((sql) => sql.includes("SET status = $2") && sql.includes('completed_at = now()'))).toBe(false);
    expect(sqlCalls.some((sql) => sql.includes('SET completed_devices = $2') && !sql.includes('SET status = $2'))).toBe(true);
  });
});

describe('deployment-jobs handler POST dispatching', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvironmentPermission.mockReset();
    mockLogAudit.mockReset();
    mockParseJsonBody.mockReset();
    mockGetPolicyAmapiContext.mockReset();
    mockListAffectedDevicesForPolicyContext.mockReset();
    mockSyncPolicyDerivativesForPolicy.mockReset();
    mockAssignPolicyToDeviceWithDerivative.mockReset();
    vi.restoreAllMocks();

    mockQuery.mockResolvedValue([] as never);
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
    mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } } as never);
    mockRequireEnvironmentPermission.mockResolvedValue(undefined as never);
    mockLogAudit.mockResolvedValue(undefined as never);
    mockParseJsonBody.mockResolvedValue({ environment_id: 'env_1', policy_id: 'policy_1' } as never);
    mockGetPolicyAmapiContext.mockResolvedValue({
      workspace_id: 'ws_1',
      gcp_project_id: 'proj_1',
      enterprise_name: 'enterprises/e1',
    } as never);
    mockListAffectedDevicesForPolicyContext.mockResolvedValue([{ id: 'device_1' }, { id: 'device_2' }] as never);
    mockSyncPolicyDerivativesForPolicy.mockResolvedValue(undefined as never);
    mockAssignPolicyToDeviceWithDerivative.mockResolvedValue(undefined as never);
  });

  it('awaits background trigger dispatch and does not start processing inline before returning', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'policy_1', config: {} } as never) // policy lookup
      .mockResolvedValueOnce({ id: 'job_1' } as never); // job insert

    mockQuery
      .mockResolvedValueOnce([{ scope_type: 'group', scope_id: 'group_1' }] as never) // assignments
      .mockResolvedValueOnce([] as never); // existing derivatives

    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const responsePromise = handler(makeCreateRequest(), {} as never);

    let settled = false;
    void responsePromise.then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost/.netlify/functions/deployment-jobs-background',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
    expect(settled).toBe(false);
    expect(mockSyncPolicyDerivativesForPolicy).not.toHaveBeenCalled();
    expect(mockAssignPolicyToDeviceWithDerivative).not.toHaveBeenCalled();

    resolveFetch?.(new Response(null, { status: 202 }));

    const res = await responsePromise;
    expect(res.status).toBe(201);

    const executeSql = mockExecute.mock.calls.map(([sql]) => String(sql));
    expect(executeSql.some((sql) => sql.includes("SET status = 'running'"))).toBe(false);
  });
});
