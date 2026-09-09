import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/internal-auth.js', () => ({
  requireInternalCaller: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
  isAmapiDeliveryUncertainError: vi.fn((err: unknown) =>
    err instanceof Error
      && (err as Error & { code?: string }).code === 'AMAPI_DELIVERY_UNCERTAIN'
  ),
}));

vi.mock('../_lib/amapi-command.js', () => ({
  buildAmapiCommandPayload: vi.fn(),
}));

vi.mock('../_lib/blobs.js', () => ({
  storeBlob: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  assignPolicyToDeviceWithDerivative: vi.fn(),
  ensurePreferredDerivativeForDevicePolicy: vi.fn(),
}));

vi.mock('../_lib/outbound-webhook.js', () => ({
  executeValidatedOutboundWebhook: vi.fn(),
}));

import { query, queryOne, execute, transaction } from '../_lib/db.js';
import { requireInternalCaller } from '../_lib/internal-auth.js';
import { amapiCall } from '../_lib/amapi.js';
import { storeBlob } from '../_lib/blobs.js';
import { logAudit } from '../_lib/audit.js';
import { executeValidatedOutboundWebhook } from '../_lib/outbound-webhook.js';
import {
  assignPolicyToDeviceWithDerivative,
  ensurePreferredDerivativeForDevicePolicy,
} from '../_lib/policy-derivatives.js';
import handler from '../sync-process-background.ts';
import { markDatabaseError } from '../_lib/db-errors.js';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireInternalCaller = vi.mocked(requireInternalCaller);
const mockAmapiCall = vi.mocked(amapiCall);
const mockStoreBlob = vi.mocked(storeBlob);
const mockLogAudit = vi.mocked(logAudit);
const mockExecuteValidatedOutboundWebhook = vi.mocked(executeValidatedOutboundWebhook);
const mockAssignPolicyToDeviceWithDerivative = vi.mocked(assignPolicyToDeviceWithDerivative);
const mockEnsurePreferredDerivativeForDevicePolicy = vi.mocked(ensurePreferredDerivativeForDevicePolicy);

function makeRequest(): Request {
  return new Request('http://localhost/.netlify/functions/sync-process-background', {
    method: 'POST',
    headers: { 'x-internal-secret': 'test-secret' },
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockReset();
  mockRequireInternalCaller.mockReset();
  mockAmapiCall.mockReset();
  mockStoreBlob.mockReset();
  mockLogAudit.mockReset();
  mockExecuteValidatedOutboundWebhook.mockReset();
  mockAssignPolicyToDeviceWithDerivative.mockReset();
  mockEnsurePreferredDerivativeForDevicePolicy.mockReset();

  // By default, internal caller check passes
  mockRequireInternalCaller.mockReturnValue(undefined as never);

  // Default: execute resolves successfully
  mockExecute.mockResolvedValue(undefined as never);
  mockExecuteValidatedOutboundWebhook.mockResolvedValue(new Response('{}', { status: 200 }) as never);
});

describe('sync-process-background job queue processing', () => {
  it('returns a degraded 503 when PostgreSQL is unavailable before a claim', async () => {
    mockTransaction.mockRejectedValue(markDatabaseError(Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED',
    })));

    const response = await handler(makeRequest(), {} as never);

    expect(response?.status).toBe(503);
    expect(response?.headers.get('Retry-After')).toBe('5');
    expect(response?.headers.get('X-Flash-Degraded')).toBe('database');
    await expect(response?.json()).resolves.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('leaves a claimed job leased when completion persistence loses PostgreSQL', async () => {
    const webhookJob = {
      id: 'job_db_outage_1',
      job_type: 'webhook',
      payload: JSON.stringify({ url: 'https://hooks.example.test/webhook' }),
      environment_id: 'env1',
      attempts: 2,
      max_attempts: 3,
    };
    mockTransaction.mockImplementationOnce(async () => [webhookJob] as never);
    mockExecute.mockRejectedValueOnce(Object.assign(new Error('database restarting'), {
      code: '57P03',
    }));

    const response = await handler(makeRequest(), {} as never);

    expect(response?.status).toBe(503);
    expect(mockExecuteValidatedOutboundWebhook).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const attemptedSql = mockExecute.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(attemptedSql).not.toContain("status = 'dead'");
    expect(attemptedSql).not.toContain("status = 'pending'");
  });

  it('does not mark work dead when failure-state persistence loses PostgreSQL', async () => {
    const webhookJob = {
      id: 'job_failure_persist_outage_1',
      job_type: 'webhook',
      payload: JSON.stringify({ url: 'https://hooks.example.test/webhook' }),
      environment_id: 'env1',
      attempts: 0,
      max_attempts: 5,
    };
    mockTransaction.mockImplementationOnce(async () => [webhookJob] as never);
    mockExecuteValidatedOutboundWebhook.mockRejectedValueOnce(new Error('remote endpoint failed'));
    mockExecute.mockRejectedValueOnce(Object.assign(new Error('connection lost'), {
      code: '08006',
    }));

    const response = await handler(makeRequest(), {} as never);

    expect(response?.status).toBe(503);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(String(mockExecute.mock.calls[0]?.[0])).toContain("status = 'pending'");
    expect(String(mockExecute.mock.calls[0]?.[0])).not.toContain("status = 'dead'");
  });

  it('atomically claims due jobs, reclaims stale leases, and honours row attempt limits', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (fn) => fn({ query: clientQuery } as never));

    const response = await handler(makeRequest(), {} as never);

    expect(response?.status).toBe(200);
    const claimSql = String(clientQuery.mock.calls[0]?.[0]);
    expect(claimSql).toContain("status = 'pending' AND scheduled_for <= now()");
    expect(claimSql).toContain("status = 'locked' AND locked_at < now() - interval '10 minutes'");
    expect(claimSql).toContain('COALESCE(max_attempts');
    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain("THEN 'dead'");
    expect(claimSql).toContain("UPDATE pubsub_events pe");
  });

  it('suppresses no-op completion logs for the polling VPS worker', async () => {
    const originalRuntime = process.env.FLASH_RUNTIME;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (fn) => fn({ query: clientQuery } as never));

    try {
      process.env.FLASH_RUNTIME = 'vps';
      const response = await handler(makeRequest(), {} as never);

      expect(response?.status).toBe(200);
      expect(logSpy).not.toHaveBeenCalledWith(
        'Background sync processor completed: 0 jobs across 0 batch(es)'
      );
    } finally {
      logSpy.mockRestore();
      if (originalRuntime === undefined) delete process.env.FLASH_RUNTIME;
      else process.env.FLASH_RUNTIME = originalRuntime;
    }
  });

  it('retains useful VPS completion logs when queue work was processed', async () => {
    const originalRuntime = process.env.FLASH_RUNTIME;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const webhookJob = {
      id: 'job_vps_log_1',
      job_type: 'webhook',
      payload: JSON.stringify({ url: 'https://hooks.example.test/webhook' }),
      environment_id: 'env1',
      attempts: 0,
      max_attempts: 3,
    };
    mockTransaction
      .mockImplementationOnce(async () => [webhookJob] as never)
      .mockImplementationOnce(async () => [] as never);

    try {
      process.env.FLASH_RUNTIME = 'vps';
      const response = await handler(makeRequest(), {} as never);

      expect(response?.status).toBe(200);
      expect(logSpy).toHaveBeenCalledWith(
        'Background sync processor completed: 1 jobs across 1 batch(es)'
      );
    } finally {
      logSpy.mockRestore();
      if (originalRuntime === undefined) delete process.env.FLASH_RUNTIME;
      else process.env.FLASH_RUNTIME = originalRuntime;
    }
  });

  it('marks unknown job types as dead and does not mark them completed', async () => {
    const unknownJob = {
      id: 'job1',
      job_type: 'unknown_type',
      payload: '{}',
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction.mockImplementation(async (_fn) => {
      // The handler passes a callback that runs queries via client.
      // The transaction mock returns the jobs array directly.
      return [unknownJob];
    });

    await handler(makeRequest(), {} as never);

    // Should have been called with a dead status update for the unknown job
    const deadCall = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes("status = 'dead'") &&
        (call[1] as unknown[])?.includes('job1')
    );
    expect(deadCall).toBeDefined();

    // Should NOT have been called with a completed status for this job
    const completedCall = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes("status = 'completed'") &&
        (call[1] as unknown[])?.includes('job1')
    );
    expect(completedCall).toBeUndefined();
  });

  it('marks known job types as completed after processing', async () => {
    const eventJob = {
      id: 'job2',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg1',
        notification_type: 'COMMAND',
        device_amapi_name: null,
        payload: { resourceName: 'enterprises/e1/devices/d1/operations/op1', commandState: 'EXECUTED' },
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction.mockImplementation(async () => {
      return [eventJob];
    });

    // The processCommand path calls execute for the command status update
    mockExecute.mockResolvedValue(undefined as never);

    await handler(makeRequest(), {} as never);

    // Should have been marked as completed
    const completedCall = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes("status = 'completed'") &&
        (call[1] as unknown[])?.includes('job2')
    );
    expect(completedCall).toBeDefined();
  });

  it('processes webhook jobs through outbound webhook helper with egress re-validation', async () => {
    const webhookJob = {
      id: 'job_webhook_1',
      job_type: 'webhook',
      payload: JSON.stringify({
        url: 'https://hooks.example.test/webhook',
        method: 'POST',
        body: { event: 'geofence.enter', device_id: 'dev_1' },
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction.mockImplementation(async () => [webhookJob] as never);

    await handler(makeRequest(), {} as never);

    expect(mockExecuteValidatedOutboundWebhook).toHaveBeenCalledWith({
      url: 'https://hooks.example.test/webhook',
      method: 'POST',
      body: { event: 'geofence.enter', device_id: 'dev_1' },
    });

    const completedCall = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes("status = 'completed'") &&
        (call[1] as unknown[])?.includes('job_webhook_1')
    );
    expect(completedCall).toBeDefined();
  });

  it('processes AMAPI COMMAND notifications using operation name/done fields', async () => {
    const eventJob = {
      id: 'job_command_amapi',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg-command-1',
        notification_type: 'COMMAND',
        device_amapi_name: 'enterprises/e1/devices/d1',
        payload: {
          name: 'enterprises/e1/devices/d1/operations/1772138119597',
          done: true,
          response: { '@type': 'type.googleapis.com/google.android.devicemanagement.v1.IssueCommandResponse' },
          metadata: {
            '@type': 'type.googleapis.com/google.android.devicemanagement.v1.Command',
            type: 'REBOOT',
          },
        },
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction.mockImplementation(async () => [eventJob] as never);
    mockExecute.mockResolvedValue(undefined as never);

    await handler(makeRequest(), {} as never);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE device_commands SET'),
      ['SUCCEEDED', null, 'env1', 'enterprises/e1/devices/d1/operations/1772138119597']
    );

    const processedPubsubEvent = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes("UPDATE pubsub_events SET status = 'processed'") &&
        (call[1] as unknown[])?.includes('msg-command-1')
    );
    expect(processedPubsubEvent).toBeDefined();
  });

  it('updates snapshot appliedState when lost mode command completes', async () => {
    const eventJob = {
      id: 'job_command_lost_mode',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg-command-lost-mode',
        notification_type: 'COMMAND',
        device_amapi_name: 'enterprises/e1/devices/d1',
        payload: {
          name: 'enterprises/e1/devices/d1/operations/1772548091416',
          done: true,
          metadata: {
            '@type': 'type.googleapis.com/google.android.devicemanagement.v1.Command',
            type: 'START_LOST_MODE',
            startLostModeStatus: { status: 'SUCCESS' },
          },
        },
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [eventJob] as never)
      .mockImplementationOnce(async () => [] as never);
    mockExecute.mockResolvedValue(undefined as never);

    await handler(makeRequest(), {} as never);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('jsonb_set(COALESCE(snapshot, \'{}\'::jsonb), \'{appliedState}\''),
      ['env1', 'enterprises/e1/devices/d1', 'LOST']
    );
  });

  it('does not treat done=true as success when command-specific status reports failure', async () => {
    const eventJob = {
      id: 'job_command_lost_mode_failed',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg-command-lost-mode-failed',
        notification_type: 'COMMAND',
        device_amapi_name: 'enterprises/e1/devices/d1',
        payload: {
          name: 'enterprises/e1/devices/d1/operations/1772548091418',
          done: true,
          metadata: {
            '@type': 'type.googleapis.com/google.android.devicemanagement.v1.Command',
            type: 'START_LOST_MODE',
            startLostModeStatus: { status: 'RESET_PASSWORD_RECENTLY' },
          },
        },
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [eventJob] as never)
      .mockImplementationOnce(async () => [] as never);
    mockExecute.mockResolvedValue(undefined as never);

    await handler(makeRequest(), {} as never);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE device_commands SET'),
      [
        'FAILED',
        'startLostModeStatus: RESET_PASSWORD_RECENTLY',
        'env1',
        'enterprises/e1/devices/d1/operations/1772548091418',
      ]
    );

    const appliedStateUpdate = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('{appliedState}')
    );
    expect(appliedStateUpdate).toBeUndefined();
  });

  it('treats documented already-in-lost-mode status as successful and updates local state', async () => {
    const eventJob = {
      id: 'job_command_lost_mode_response_type',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg-command-lost-mode-response-type',
        notification_type: 'COMMAND',
        device_amapi_name: 'enterprises/e1/devices/d1',
        payload: {
          name: 'enterprises/e1/devices/d1/operations/1772548091417',
          done: true,
          metadata: {
            '@type': 'type.googleapis.com/google.android.devicemanagement.v1.Command',
            type: 'START_LOST_MODE',
            startLostModeStatus: { status: 'ALREADY_IN_LOST_MODE' },
          },
        },
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [eventJob] as never)
      .mockImplementationOnce(async () => [] as never);
    mockExecute.mockResolvedValue(undefined as never);

    await handler(makeRequest(), {} as never);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('jsonb_set(COALESCE(snapshot, \'{}\'::jsonb), \'{appliedState}\''),
      ['env1', 'enterprises/e1/devices/d1', 'LOST']
    );
  });

  it('processes ENTERPRISE_UPGRADE events by syncing enterprise upgrade status cache', async () => {
    const eventJob = {
      id: 'job_upgrade',
      job_type: 'process_enterprise_upgrade',
      payload: JSON.stringify({
        event_message_id: 'msg-upgrade',
        notification_type: 'ENTERPRISE_UPGRADE',
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [eventJob] as never)
      .mockImplementationOnce(async () => [] as never);
    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'ws_1',
      enterprise_name: 'enterprises/e1',
      gcp_project_id: 'proj_1',
    } as never);
    mockAmapiCall.mockResolvedValueOnce({
      enterpriseType: 'MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE',
      managedGooglePlayAccountsEnterpriseType: 'ENTERPRISE',
      managedGoogleDomainType: 'TYPE_UNSPECIFIED',
    } as never);

    await handler(makeRequest(), {} as never);

    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1',
      'ws_1',
      expect.objectContaining({
        method: 'GET',
        resourceType: 'enterprises',
      })
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE environments'),
      ['env1', expect.stringContaining('"enterprise_upgrade_status"')]
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        environment_id: 'env1',
        action: 'environment.enterprise_upgrade_status_synced',
      })
    );
  });

  it('maps Lost Mode usage log events into device location history', async () => {
    const eventJob = {
      id: 'job_usage_logs',
      job_type: 'process_usage_logs',
      payload: JSON.stringify({
        event_message_id: 'msg-usage-1',
        notification_type: 'USAGE_LOGS',
        device_amapi_name: null,
        payload: {
          device: 'enterprises/e1/devices/d1',
          retrievalTime: '2026-03-03T10:00:00Z',
          usageLogEvents: [
            {
              eventType: 'LOST_MODE_LOCATION',
              eventTime: '2026-03-03T09:58:00Z',
              lostModeLocationEvent: {
                location: {
                  latitude: 51.5074,
                  longitude: -0.1278,
                  accuracyMeters: 12.5,
                },
              },
            },
          ],
        },
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [eventJob] as never)
      .mockImplementationOnce(async () => [] as never);
    mockQueryOne.mockResolvedValueOnce({ id: 'dev_1' } as never);

    await handler(makeRequest(), {} as never);

    expect(mockStoreBlob).toHaveBeenCalledWith(
      'usage-logs',
      expect.stringContaining('env1/enterprises_e1_devices_d1/'),
      expect.any(String)
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO device_locations'),
      [
        'dev_1',
        JSON.stringify([
          {
            latitude: 51.5074,
            longitude: -0.1278,
            accuracy: 12.5,
            recorded_at: '2026-03-03T09:58:00.000Z',
            source: 'lost_mode_usage_log',
          },
        ]),
      ]
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE pubsub_events SET status = 'processed'"),
      ['env1', 'msg-usage-1']
    );
  });

  it('propagates error when requireInternalCaller rejects unauthorized requests', async () => {
    mockRequireInternalCaller.mockImplementation(() => {
      throw new Error('Unauthorized internal call');
    });

    // The handler catches errors at the top level with console.error,
    // so it should not throw but will not process any jobs.
    await handler(makeRequest(), {} as never);

    // Transaction should never have been called because the auth check failed first
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('processes device_command DISABLE jobs using PATCH state update and updates local device state', async () => {
    const job = {
      id: 'job_disable',
      job_type: 'device_command',
      payload: JSON.stringify({
        device_id: 'dev_1',
        command_type: 'DISABLE',
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);

    mockQueryOne
      .mockResolvedValueOnce({
        amapi_name: 'enterprises/e1/devices/d1',
        environment_id: 'env_1',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        gcp_project_id: 'proj_1',
        enterprise_name: 'enterprises/e1',
      } as never);

    await handler(makeRequest(), {} as never);

    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/devices/d1?updateMask=state',
      'ws_1',
      expect.objectContaining({
        method: 'PATCH',
        retryMode: 'safe',
        body: { state: 'DISABLED' },
        projectId: 'proj_1',
        enterpriseName: 'enterprises/e1',
      })
    );

    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE devices SET state = $1, updated_at = now() WHERE id = $2',
      ['DISABLED', 'dev_1']
    );

    const completedCall = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes("status = 'completed'") &&
        (call[1] as unknown[])?.includes('job_disable')
    );
    expect(completedCall).toBeDefined();
  });

  it('terminates uncertain device commands without queue replay', async () => {
    const job = {
      id: 'job_uncertain_command',
      job_type: 'device_command',
      payload: JSON.stringify({
        device_id: 'dev_1',
        command_type: 'REBOOT',
      }),
      environment_id: 'env1',
      attempts: 0,
      max_attempts: 3,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);
    mockQueryOne
      .mockResolvedValueOnce({
        amapi_name: 'enterprises/e1/devices/d1',
        environment_id: 'env_1',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        gcp_project_id: 'proj_1',
        enterprise_name: 'enterprises/e1',
      } as never);
    mockAmapiCall.mockRejectedValueOnce(Object.assign(
      new Error('AMAPI request delivery is uncertain after transient HTTP 504'),
      { code: 'AMAPI_DELIVERY_UNCERTAIN', status: 504 }
    ));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handler(makeRequest(), {} as never);

    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/devices/d1:issueCommand',
      'ws_1',
      expect.objectContaining({ retryMode: 'never' })
    );
    const uncertainCall = mockExecute.mock.calls.find(([sql, params]) =>
      String(sql).includes("status = 'delivery_uncertain'")
        && (params as unknown[])?.includes('job_uncertain_command')
    );
    expect(uncertainCall).toBeDefined();
    const replayCall = mockExecute.mock.calls.find(([sql, params]) =>
      (String(sql).includes("status = 'pending'") || String(sql).includes("status = 'dead'"))
        && (params as unknown[])?.includes('job_uncertain_command')
    );
    expect(replayCall).toBeUndefined();
  });

  it('processes device_delete jobs using AMAPI delete then soft-deletes local records', async () => {
    const job = {
      id: 'job_delete',
      job_type: 'device_delete',
      payload: JSON.stringify({
        device_id: 'dev_9',
        initiated_by: 'user_9',
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'dev_9',
        amapi_name: 'enterprises/e1/devices/d9',
        environment_id: 'env_1',
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({
        gcp_project_id: 'proj_1',
      } as never);

    await handler(makeRequest(), {} as never);

    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/devices/d9',
      'ws_1',
      expect.objectContaining({
        method: 'DELETE',
        projectId: 'proj_1',
        enterpriseName: 'enterprises/e1',
      })
    );
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE devices SET deleted_at = now(), updated_at = now() WHERE id = $1',
      ['dev_9']
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'device.deleted',
        user_id: 'user_9',
        device_id: 'dev_9',
      })
    );

    const completedCall = mockExecute.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes("status = 'completed'") &&
        (call[1] as unknown[])?.includes('job_delete')
    );
    expect(completedCall).toBeDefined();
  });

  it('syncs device_applications from STATUS_REPORT even when previous device snapshot is missing', async () => {
    const job = {
      id: 'job_status_apps',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg_status_apps',
        notification_type: 'STATUS_REPORT',
        device_amapi_name: 'enterprises/e1/devices/d1',
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);

    mockQueryOne
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj_1',
      } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'dev_status_1' } as never);

    mockAmapiCall.mockResolvedValueOnce({
      state: 'ACTIVE',
      policyCompliant: true,
      hardwareInfo: { model: 'Pixel 8', manufacturer: 'Google' },
      softwareInfo: { androidVersion: '14' },
      applicationReports: [
        {
          packageName: 'com.example.app',
          displayName: 'Example App',
          versionName: '1.2.3',
          versionCode: 123,
          state: 'INSTALLED',
          applicationSource: 'PLAY_STORE',
        },
      ],
    } as never);

    await handler(makeRequest(), {} as never);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO device_applications'),
      [
        'dev_status_1',
        'com.example.app',
        'Example App',
        '1.2.3',
        123,
        'INSTALLED',
        'PLAY_STORE',
      ]
    );
  });

  it('preserves KeyedAppState.data as an opaque string, including empty strings', async () => {
    const job = {
      id: 'job_status_feedback',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg_status_feedback',
        notification_type: 'STATUS_REPORT',
        device_amapi_name: 'enterprises/e1/devices/d1',
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);
    mockQueryOne
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj_1',
      } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'dev_status_1' } as never);
    mockAmapiCall.mockResolvedValueOnce({
      state: 'ACTIVE',
      policyCompliant: true,
      applicationReports: [{
        packageName: 'com.example.feedback',
        keyedAppStates: [
          { key: 'json-looking', severity: 'ERROR', data: '{"battery":9}' },
          { key: 'empty', severity: 'INFO', data: '' },
        ],
      }],
    } as never);

    await handler(makeRequest(), {} as never);

    const feedbackCall = mockExecute.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO app_feedback_items')
    );
    expect(feedbackCall).toBeDefined();
    const rows = JSON.parse(String((feedbackCall?.[1] as unknown[])?.[0])) as Array<{
      feedback_key: string;
      data_json: string | null;
    }>;
    expect(rows.map(({ feedback_key, data_json }) => [feedback_key, data_json])).toEqual([
      ['json-looking', '{"battery":9}'],
      ['empty', ''],
    ]);
  });

  it('syncs device_applications during ENROLLMENT processing when AMAPI returns application reports', async () => {
    const job = {
      id: 'job_enroll_apps',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg_enroll_apps',
        notification_type: 'ENROLLMENT',
        device_amapi_name: 'enterprises/e1/devices/d2',
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);

    mockQueryOne
      .mockResolvedValueOnce({
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
        gcp_project_id: 'proj_1',
      } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'dev_enroll_1' } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    mockAmapiCall.mockResolvedValueOnce({
      hardwareInfo: { model: 'Pixel 9', serialNumber: 'ABC123', manufacturer: 'Google' },
      softwareInfo: { androidVersion: '15' },
      state: 'ACTIVE',
      policyCompliant: true,
      applicationReports: [
        {
          packageName: 'com.example.enroll',
          displayName: 'Enroll App',
          versionName: '2.0.0',
          versionCode: 200,
          state: 'INSTALLED',
          applicationSource: 'UNKNOWN',
        },
      ],
    } as never);

    await handler(makeRequest(), {} as never);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO device_applications'),
      [
        'dev_enroll_1',
        'com.example.enroll',
        'Enroll App',
        '2.0.0',
        200,
        'INSTALLED',
        'UNKNOWN',
      ]
    );
  });

  it('preserves an existing current row during re-enrollment and retains predecessor history', async () => {
    const newAmapiName = 'enterprises/e1/devices/new123';
    const job = {
      id: 'job_enroll_dedupe',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg_enroll_dedupe',
        notification_type: 'ENROLLMENT',
        device_amapi_name: newAmapiName,
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    const lineageQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'dev_current', amapi_name: newAmapiName, enrollment_time: null },
          { id: 'dev_old_1', amapi_name: 'enterprises/e1/devices/oldA', enrollment_time: null },
          { id: 'dev_old_2', amapi_name: 'enterprises/e1/devices/oldB', enrollment_time: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async (fn) => fn({ query: lineageQuery } as never))
      .mockImplementationOnce(async () => [] as never);

    mockQueryOne.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT e.workspace_id, e.enterprise_name, w.gcp_project_id')) {
        return {
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        } as never;
      }
      if (text.trim().startsWith('SELECT id FROM devices WHERE environment_id = $1 AND amapi_name = $2')) {
        return { id: 'dev_current' } as never;
      }
      // Token/group lookup + final workflow dispatch lookup defaults
      return null as never;
    });

    mockAmapiCall.mockResolvedValueOnce({
      previousDeviceNames: [
        'enterprises/e1/devices/oldA',
        'enterprises/e1/devices/oldB',
      ],
      hardwareInfo: { model: 'Pixel 9', serialNumber: 'ABC123', manufacturer: 'Google' },
      softwareInfo: { androidVersion: '15' },
      state: 'ACTIVE',
      policyCompliant: true,
      applicationReports: [],
    } as never);

    await handler(makeRequest(), {} as never);

    expect(lineageQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM devices'))).toBe(false);
    expect(lineageQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE devices SET amapi_name = $1'))).toBe(false);
    expect(lineageQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO devices'))).toBe(true);
  });

  it('prefers the correct previousDeviceNames canonical row over a more recently updated stale duplicate', async () => {
    const newAmapiName = 'enterprises/e1/devices/new456';
    const job = {
      id: 'job_enroll_dedupe_ranked',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg_enroll_dedupe_ranked',
        notification_type: 'ENROLLMENT',
        device_amapi_name: newAmapiName,
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    const lineageQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'dev_stale',
            amapi_name: 'enterprises/e1/devices/oldStale',
            serial_number: 'OLDSER',
            imei: null,
            deleted_at: '2026-02-26T00:00:00Z',
            enrollment_time: '2026-02-20T00:00:00Z',
            last_status_report_at: '2026-02-26T13:00:00Z',
            created_at: '2026-02-20T00:00:00Z',
          },
          {
            id: 'dev_correct',
            amapi_name: 'enterprises/e1/devices/oldCorrect',
            serial_number: 'ABC123',
            imei: '352282267006177',
            deleted_at: null,
            enrollment_time: '2026-02-25T12:00:00Z',
            last_status_report_at: '2026-02-25T13:00:00Z',
            created_at: '2026-02-22T00:00:00Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async (fn) => fn({ query: lineageQuery } as never))
      .mockImplementationOnce(async () => [] as never);

    mockQueryOne.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT e.workspace_id, e.enterprise_name, w.gcp_project_id')) {
        return {
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        } as never;
      }
      if (text.trim().startsWith('SELECT id FROM devices WHERE environment_id = $1 AND amapi_name = $2')) {
        return { id: 'dev_correct' } as never;
      }
      return null as never;
    });

    mockAmapiCall.mockResolvedValueOnce({
      previousDeviceNames: [
        'enterprises/e1/devices/oldStale',
        'enterprises/e1/devices/oldCorrect',
      ],
      networkInfo: { imei: '352282267006177' },
      hardwareInfo: { model: 'Pixel 9a', serialNumber: 'ABC123', manufacturer: 'Google' },
      softwareInfo: { androidVersion: '16' },
      state: 'ACTIVE',
      policyCompliant: true,
      applicationReports: [],
    } as never);

    await handler(makeRequest(), {} as never);

    const renameCall = lineageQuery.mock.calls.find(
      (call) =>
        typeof call[0] === 'string'
        && String(call[0]).includes('UPDATE devices SET amapi_name = $1')
        && Array.isArray(call[1])
        && (call[1] as unknown[])[0] === newAmapiName
    );
    expect(renameCall).toBeDefined();
    expect(renameCall?.[1]).toEqual([newAmapiName, 'dev_correct']);
  });

  it('skips importing a historical predecessor device when an active row already references it in previous_device_names', async () => {
    const historicalAmapiName = 'enterprises/e1/devices/old-historical';
    const job = {
      id: 'job_enroll_skip_historical',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg_enroll_skip_historical',
        notification_type: 'ENROLLMENT',
        device_amapi_name: historicalAmapiName,
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);

    mockQuery.mockResolvedValue([] as never);

    mockQueryOne.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT e.workspace_id, e.enterprise_name, w.gcp_project_id')) {
        return {
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        } as never;
      }
      if (text.includes('previous_device_names @> ARRAY[$2]::text[]')) {
        return {
          id: 'dev_current',
          amapi_name: 'enterprises/e1/devices/current',
        } as never;
      }
      return null as never;
    });

    mockAmapiCall.mockResolvedValueOnce({
      name: historicalAmapiName,
      previousDeviceNames: [],
      hardwareInfo: { model: 'Pixel 9a', serialNumber: 'ABC123', manufacturer: 'Google' },
      softwareInfo: { androidVersion: '16' },
      state: 'ACTIVE',
      policyCompliant: true,
      applicationReports: [],
    } as never);

    await handler(makeRequest(), {} as never);

    const upsertCall = mockExecute.mock.calls.find(
      (call) => typeof call[0] === 'string' && String(call[0]).includes('INSERT INTO devices (')
    );
    expect(upsertCall).toBeUndefined();
  });

  it('does not no-op enrollment policy sync when expected derivative is marked redundant', async () => {
    const deviceAmapiName = 'enterprises/e1/devices/redundant1';
    const expectedPolicyAmapiName = 'enterprises/e1/policies/pd-device-redundant';
    const job = {
      id: 'job_enroll_redundant_derivative',
      job_type: 'process_event',
      payload: JSON.stringify({
        event_message_id: 'msg_enroll_redundant_derivative',
        notification_type: 'ENROLLMENT',
        device_amapi_name: deviceAmapiName,
        payload: {},
      }),
      environment_id: 'env1',
      attempts: 0,
      locked_at: new Date().toISOString(),
    };

    mockTransaction
      .mockImplementationOnce(async () => [job] as never)
      .mockImplementationOnce(async () => [] as never);

    mockQuery.mockResolvedValue([] as never);
    mockQueryOne.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT e.workspace_id, e.enterprise_name, w.gcp_project_id')) {
        return {
          workspace_id: 'ws_1',
          enterprise_name: 'enterprises/e1',
          gcp_project_id: 'proj_1',
        } as never;
      }
      if (text.includes('SELECT id, amapi_name') && text.includes('previous_device_names @> ARRAY')) {
        return null as never;
      }
      if (text.includes('SELECT enrollment_time FROM devices')) {
        return null as never;
      }
      if (text.includes('SELECT id FROM devices WHERE environment_id = $1 AND amapi_name = $2')) {
        return { id: 'dev_redundant_1' } as never;
      }
      if (text.includes('SELECT id, group_id') && text.includes('deleted_at IS NULL')) {
        return { id: 'dev_redundant_1', group_id: null } as never;
      }
      if (text.includes('WHERE scope_type = \'device\' AND scope_id = $1')) {
        return null as never;
      }
      if (text.includes('WHERE scope_type = \'environment\' AND scope_id = $1')) {
        return { policy_id: 'policy_env_1' } as never;
      }
      if (text.includes('SELECT last_policy_sync_name FROM devices WHERE id = $1')) {
        return { last_policy_sync_name: expectedPolicyAmapiName } as never;
      }
      if (text.includes('FROM policy_derivatives') && text.includes('WHERE policy_id = $1 AND scope_type = $2 AND scope_id = $3')) {
        return { metadata: { generation_hash: 'gen-1' } } as never;
      }
      if (text.includes('SELECT id, group_id FROM devices WHERE environment_id = $1 AND amapi_name = $2')) {
        return { id: 'dev_redundant_1', group_id: null } as never;
      }
      return null as never;
    });

    mockAmapiCall.mockResolvedValueOnce({
      name: deviceAmapiName,
      state: 'ACTIVE',
      policyCompliant: true,
      hardwareInfo: { model: 'Moto G', serialNumber: 'ZY22KKDTXP', manufacturer: 'motorola' },
      softwareInfo: { androidVersion: '14' },
      applicationReports: [],
    } as never);

    mockEnsurePreferredDerivativeForDevicePolicy.mockResolvedValueOnce({
      derivative: {
        scope_type: 'device',
        scope_id: 'dev_redundant_1',
        amapi_name: expectedPolicyAmapiName,
        payload_hash: 'hash-device',
        metadata: { generation_hash: 'gen-1' },
      },
      source_scope: { scope_type: 'group', scope_id: 'group_1' },
      used_device_derivative: false,
      reason_code: 'device_derivative_redundant_payload_match',
      reason_details: {},
      device_derivative_required: false,
      device_derivative_redundant: true,
    } as never);

    mockAssignPolicyToDeviceWithDerivative.mockResolvedValueOnce({
      derivative: {
        scope_type: 'group',
        scope_id: 'group_1',
        amapi_name: 'enterprises/e1/policies/pd-group',
        metadata: { generation_hash: 'gen-group' },
      },
      source_scope: { scope_type: 'group', scope_id: 'group_1' },
      used_device_derivative: false,
      source_derivative: {
        scope_type: 'group',
        scope_id: 'group_1',
        amapi_name: 'enterprises/e1/policies/pd-group',
        metadata: { generation_hash: 'gen-group' },
      },
    } as never);

    await handler(makeRequest(), {} as never);

    expect(mockAssignPolicyToDeviceWithDerivative).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'policy_env_1',
        environmentId: 'env1',
        deviceId: 'dev_redundant_1',
        deviceAmapiName,
      })
    );
  });
});
