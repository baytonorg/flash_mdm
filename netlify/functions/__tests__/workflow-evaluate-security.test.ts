import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../_lib/internal-auth.js', () => ({
  requireInternalCaller: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn((err: unknown) =>
    err instanceof Error
      ? (err as Error & { status?: number }).status ?? null
      : null
  ),
  isAmapiDeliveryUncertainError: vi.fn((err: unknown) =>
    err instanceof Error
      && (err as Error & { code?: string }).code === 'AMAPI_DELIVERY_UNCERTAIN'
  ),
}));

vi.mock('../_lib/amapi-command.js', () => ({
  buildAmapiCommandPayload: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/resend.js', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('../_lib/brand.js', () => ({
  BRAND: { name: 'TestBrand' },
}));

vi.mock('../_lib/policy-derivatives.js', () => ({
  assignPolicyToDeviceWithDerivative: vi.fn(),
}));

vi.mock('../_lib/webhook-ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/webhook-ssrf.js')>();
  return {
    ...actual,
    validateResolvedWebhookUrlForOutbound: vi.fn(actual.validateResolvedWebhookUrlForOutbound),
  };
});

// ─── Imports ────────────────────────────────────────────────────────────────

import { requireInternalCaller } from '../_lib/internal-auth.js';
import { queryOne, execute } from '../_lib/db.js';
import { amapiCall } from '../_lib/amapi.js';
import { buildAmapiCommandPayload } from '../_lib/amapi-command.js';
import { logAudit } from '../_lib/audit.js';
import { sendEmail } from '../_lib/resend.js';
import { assignPolicyToDeviceWithDerivative } from '../_lib/policy-derivatives.js';
import { validateResolvedWebhookUrlForOutbound } from '../_lib/webhook-ssrf.js';
import handler from '../workflow-evaluate-background.ts';

const mockRequireInternalCaller = vi.mocked(requireInternalCaller);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockAmapiCall = vi.mocked(amapiCall);
const mockBuildAmapiCommandPayload = vi.mocked(buildAmapiCommandPayload);
const mockLogAudit = vi.mocked(logAudit);
const mockSendEmail = vi.mocked(sendEmail);
const mockAssignPolicyToDeviceWithDerivative = vi.mocked(assignPolicyToDeviceWithDerivative);
const mockValidateResolvedWebhookUrlForOutbound = vi.mocked(validateResolvedWebhookUrlForOutbound);

beforeEach(() => {
  mockRequireInternalCaller.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockAmapiCall.mockReset();
  mockBuildAmapiCommandPayload.mockReset();
  mockLogAudit.mockReset();
  mockSendEmail.mockReset();
  mockAssignPolicyToDeviceWithDerivative.mockReset();
  mockValidateResolvedWebhookUrlForOutbound.mockReset();

  mockExecute.mockResolvedValue({ rowCount: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request(
    'http://localhost/.netlify/functions/workflow-evaluate-background',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': 'test-secret',
      },
      body: JSON.stringify(body),
    }
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('workflow-evaluate-background — security', () => {
  it('rejects requests without valid internal secret', async () => {
    mockRequireInternalCaller.mockImplementation(() => {
      throw new Error('Unauthorized: not an internal caller');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = makeRequest({
      workflow_id: 'wf1',
      device_id: 'dev1',
      trigger_data: {},
    });
    await handler(req, {} as never);

    expect(mockRequireInternalCaller).toHaveBeenCalledWith(req);

    // The handler catches the error and logs it — no workflow queries should happen
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects device/workflow environment mismatch', async () => {
    // requireInternalCaller passes
    mockRequireInternalCaller.mockImplementation(() => {});

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // First queryOne: fetch workflow — environment_id = 'env1'
    mockQueryOne.mockResolvedValueOnce({
      id: 'wf1',
      environment_id: 'env1',
      name: 'Test Workflow',
      enabled: true,
      trigger_type: 'device.state_change',
      trigger_config: {},
      conditions: [],
      action_type: 'audit.log',
      action_config: {},
      scope_type: 'all',
      scope_id: null,
    } as never);

    // Second queryOne: fetch device — environment_id = 'env2' (mismatch!)
    mockQueryOne.mockResolvedValueOnce({
      id: 'dev1',
      environment_id: 'env2',
      amapi_name: 'enterprises/test/devices/dev1',
      serial_number: 'SN123',
      manufacturer: 'Google',
      model: 'Pixel',
      os_version: '14',
      state: 'ACTIVE',
      ownership: 'COMPANY_OWNED',
      policy_compliant: true,
      group_id: null,
      snapshot: null,
    } as never);

    const req = makeRequest({
      workflow_id: 'wf1',
      device_id: 'dev1',
      trigger_data: {},
    });
    await handler(req, {} as never);

    // The handler should log the mismatch and return early
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Environment mismatch')
    );

    // No execution record should be created (execute not called for workflow_executions INSERT)
    // The handler returns before creating an execution record
    expect(mockExecute).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('allows valid requests with matching environment IDs', async () => {
    mockRequireInternalCaller.mockImplementation(() => {});

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Workflow query
    mockQueryOne.mockResolvedValueOnce({
      id: 'wf1',
      environment_id: 'env1',
      name: 'Test Workflow',
      enabled: true,
      trigger_type: 'device.state_change',
      trigger_config: {},
      conditions: [],
      action_type: 'audit.log',
      action_config: { action: 'test.action', details: {} },
      scope_type: 'all',
      scope_id: null,
    } as never);

    // Device query
    mockQueryOne.mockResolvedValueOnce({
      id: 'dev1',
      environment_id: 'env1',
      amapi_name: 'enterprises/test/devices/dev1',
      serial_number: 'SN123',
      manufacturer: 'Google',
      model: 'Pixel',
      os_version: '14',
      state: 'ACTIVE',
      ownership: 'COMPANY_OWNED',
      policy_compliant: true,
      group_id: null,
      snapshot: null,
    } as never);

    // Environment context query
    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'ws1',
      enterprise_name: 'enterprises/test',
      gcp_project_id: 'proj-1',
    } as never);

    const req = makeRequest({
      workflow_id: 'wf1',
      device_id: 'dev1',
      trigger_data: {},
    });
    await handler(req, {} as never);

    // Verify internal auth was checked
    expect(mockRequireInternalCaller).toHaveBeenCalledWith(req);

    // Verify execution record was created (first execute call)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_executions'),
      expect.arrayContaining(['wf1', 'dev1'])
    );

    // Verify the workflow proceeded to completion (execute called for status update and last_triggered_at)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_executions SET status'),
      expect.arrayContaining(['success'])
    );
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE workflows SET last_triggered_at = now() WHERE id = $1',
      ['wf1']
    );

    consoleLogSpy.mockRestore();
  });

  it('escapes user-controlled values in notification email html including action templates', async () => {
    mockRequireInternalCaller.mockImplementation(() => {});

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQueryOne.mockResolvedValueOnce({
      id: 'wf1',
      environment_id: 'env1',
      name: 'Ops </h2><script>alert(1)</script>',
      enabled: true,
      trigger_type: 'device.state_change',
      trigger_config: {},
      conditions: [],
      action_type: 'notification.email',
      action_config: {
        to: 'alerts@example.com',
        subject: 'Alert',
        template: 'Review <a href="https://status.example.com">status</a> now.',
      },
      scope_type: 'all',
      scope_id: null,
    } as never);

    mockQueryOne.mockResolvedValueOnce({
      id: 'dev1',
      environment_id: 'env1',
      amapi_name: 'enterprises/test/devices/dev1',
      serial_number: 'SN</p><script>alert(1)</script>',
      manufacturer: 'ACME <img src=x onerror=alert(1)>',
      model: 'M1',
      os_version: '14',
      state: 'ACTIVE<script>',
      ownership: 'COMPANY_OWNED',
      policy_compliant: true,
      group_id: null,
      snapshot: null,
    } as never);

    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'ws1',
      enterprise_name: 'enterprises/test',
      gcp_project_id: 'proj-1',
    } as never);

    const req = makeRequest({
      workflow_id: 'wf1',
      device_id: 'dev1',
      trigger_data: {},
    });
    await handler(req, {} as never);

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.execution.executed',
        resource_type: 'workflow',
        resource_id: 'wf1',
        device_id: 'dev1',
      })
    );
    const emailOptions = mockSendEmail.mock.calls[0]?.[0];
    expect(emailOptions?.to).toBe('alerts@example.com');
    expect(emailOptions?.html).toContain('Review &lt;a href=&quot;https://status.example.com&quot;&gt;status&lt;/a&gt; now.');
    expect(emailOptions?.html).toContain('Ops &lt;/h2&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(emailOptions?.html).toContain('SN&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(emailOptions?.html).toContain('ACME &lt;img src=x onerror=alert(1)&gt;');
    expect(emailOptions?.html).toContain('ACTIVE&lt;script&gt;');
    expect(emailOptions?.html).not.toContain('<script>alert(1)</script>');

    consoleLogSpy.mockRestore();
  });

  it('rejects webhook actions when DNS resolves to a blocked address and does not call fetch', async () => {
    mockRequireInternalCaller.mockImplementation(() => {});
    mockValidateResolvedWebhookUrlForOutbound.mockResolvedValue({
      ok: false,
      error: 'Webhook URL resolves to a blocked address',
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQueryOne.mockResolvedValueOnce({
      id: 'wf1',
      environment_id: 'env1',
      name: 'Webhook Workflow',
      enabled: true,
      trigger_type: 'device.state_change',
      trigger_config: {},
      conditions: [],
      action_type: 'notification.webhook',
      action_config: {
        url: 'https://hooks.example.com/inbound',
      },
      scope_type: 'all',
      scope_id: null,
    } as never);

    mockQueryOne.mockResolvedValueOnce({
      id: 'dev1',
      environment_id: 'env1',
      amapi_name: 'enterprises/test/devices/dev1',
      serial_number: 'SN123',
      manufacturer: 'Google',
      model: 'Pixel',
      os_version: '14',
      state: 'ACTIVE',
      ownership: 'COMPANY_OWNED',
      policy_compliant: true,
      group_id: null,
      snapshot: null,
    } as never);

    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'ws1',
      enterprise_name: 'enterprises/test',
      gcp_project_id: 'proj-1',
    } as never);

    await handler(
      makeRequest({
        workflow_id: 'wf1',
        device_id: 'dev1',
        trigger_data: {},
      }),
      {} as never
    );

    expect(mockValidateResolvedWebhookUrlForOutbound).toHaveBeenCalledWith('https://hooks.example.com/inbound');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_executions SET status = $2, result = $3'),
      expect.arrayContaining(['failed'])
    );

    consoleLogSpy.mockRestore();
  });

  it('records non-2xx webhook responses as failed executions', async () => {
    mockRequireInternalCaller.mockImplementation(() => {});
    mockValidateResolvedWebhookUrlForOutbound.mockResolvedValue({
      ok: true,
      url: 'https://hooks.example.com/inbound',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('failed', { status: 503 })));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'wf1', environment_id: 'env1', name: 'Webhook Workflow', enabled: true,
        trigger_type: 'device.state_changed', trigger_config: {}, conditions: [],
        action_type: 'notification.webhook',
        action_config: { url: 'https://hooks.example.com/inbound' },
        scope_type: 'environment', scope_id: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'dev1', environment_id: 'env1', amapi_name: 'enterprises/test/devices/dev1',
        serial_number: 'SN123', manufacturer: 'Google', model: 'Pixel', os_version: '14',
        state: 'ACTIVE', ownership: 'COMPANY_OWNED', policy_compliant: true,
        group_id: null, snapshot: null,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws1', enterprise_name: 'enterprises/test', gcp_project_id: 'proj-1',
      } as never);

    await handler(makeRequest({ workflow_id: 'wf1', device_id: 'dev1' }), {} as never);

    const statusUpdate = mockExecute.mock.calls.find(([sql, params]) =>
      String(sql).includes('UPDATE workflow_executions SET status = $2') && params?.[1] === 'failed'
    );
    expect(statusUpdate).toBeDefined();
    expect(JSON.parse(String(statusUpdate?.[1]?.[2]))).toMatchObject({
      success: false,
      status: 503,
      error: 'Webhook returned HTTP 503',
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workflow.execution.failed',
    }));
  });

  it('does not commit local policy state when AMAPI assignment fails', async () => {
    mockRequireInternalCaller.mockImplementation(() => {});
    mockAssignPolicyToDeviceWithDerivative.mockRejectedValue(new Error('AMAPI unavailable'));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'wf1', environment_id: 'env1', name: 'Assign Policy', enabled: true,
        trigger_type: 'device.state_changed', trigger_config: {}, conditions: [],
        action_type: 'device.assign_policy', action_config: { policy_id: 'policy-new' },
        scope_type: 'environment', scope_id: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'dev1', environment_id: 'env1', amapi_name: 'enterprises/test/devices/dev1',
        serial_number: 'SN123', manufacturer: 'Google', model: 'Pixel', os_version: '14',
        state: 'ACTIVE', ownership: 'COMPANY_OWNED', policy_compliant: true,
        group_id: null, snapshot: null,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws1', enterprise_name: 'enterprises/test', gcp_project_id: 'proj-1',
      } as never);

    await handler(makeRequest({ workflow_id: 'wf1', device_id: 'dev1' }), {} as never);

    expect(mockExecute.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE devices SET policy_id = $1')
    )).toBe(false);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_executions SET status = $2'),
      expect.arrayContaining(['failed'])
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workflow.execution.failed',
    }));
  });

  it('rejects stale unknown workflow commands and records a failed execution without calling AMAPI', async () => {
    mockRequireInternalCaller.mockImplementation(() => {});
    mockBuildAmapiCommandPayload.mockImplementation(() => {
      throw new Error('Unsupported command type: FUTURE_COMMAND');
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'wf1', environment_id: 'env1', name: 'Stale command', enabled: true,
        trigger_type: 'device.state_changed', trigger_config: {}, conditions: [],
        action_type: 'device.command',
        action_config: { command_type: 'FUTURE_COMMAND', command_data: {} },
        scope_type: 'environment', scope_id: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'dev1', environment_id: 'env1', amapi_name: 'enterprises/test/devices/dev1',
        serial_number: 'SN123', manufacturer: 'Google', model: 'Pixel', os_version: '14',
        state: 'ACTIVE', ownership: 'COMPANY_OWNED', policy_compliant: true,
        group_id: null, snapshot: null,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws1', enterprise_name: 'enterprises/test', gcp_project_id: 'proj-1',
      } as never);

    await handler(makeRequest({ workflow_id: 'wf1', device_id: 'dev1' }), {} as never);

    expect(mockBuildAmapiCommandPayload).toHaveBeenCalledWith('FUTURE_COMMAND', {});
    expect(mockAmapiCall).not.toHaveBeenCalled();
    const failedUpdate = mockExecute.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE workflow_executions SET status = 'failed'")
    );
    expect(failedUpdate).toBeDefined();
    expect(JSON.parse(String(failedUpdate?.[1]?.[1]))).toEqual({
      error: 'Unsupported command type: FUTURE_COMMAND',
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workflow.execution.failed',
    }));
  });

  it('records transient issueCommand responses as delivery uncertain without replaying them', async () => {
    mockRequireInternalCaller.mockImplementation(() => {});
    mockBuildAmapiCommandPayload.mockReturnValue({ type: 'REBOOT' });
    mockAmapiCall.mockRejectedValue(Object.assign(
      new Error('AMAPI request delivery is uncertain after transient HTTP 502'),
      { code: 'AMAPI_DELIVERY_UNCERTAIN', status: 502 }
    ));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQueryOne
      .mockResolvedValueOnce({
        id: 'wf1', environment_id: 'env1', name: 'Reboot', enabled: true,
        trigger_type: 'scheduled', trigger_config: {}, conditions: [],
        action_type: 'device.command', action_config: { command_type: 'REBOOT' },
        scope_type: 'environment', scope_id: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'dev1', environment_id: 'env1', amapi_name: 'enterprises/test/devices/dev1',
        serial_number: 'SN123', manufacturer: 'Google', model: 'Pixel', os_version: '14',
        state: 'ACTIVE', ownership: 'COMPANY_OWNED', policy_compliant: true,
        group_id: null, snapshot: null,
      } as never)
      .mockResolvedValueOnce({
        workspace_id: 'ws1', enterprise_name: 'enterprises/test', gcp_project_id: 'proj-1',
      } as never);

    const response = await handler(
      makeRequest({ workflow_id: 'wf1', device_id: 'dev1', trigger_data: {} }),
      {} as never
    );

    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/test/devices/dev1:issueCommand',
      'ws1',
      expect.objectContaining({ retryMode: 'never' })
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_executions SET status = $2'),
      expect.arrayContaining(['delivery_uncertain'])
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workflow.execution.delivery_uncertain',
    }));
    await expect(response?.json()).resolves.toMatchObject({
      status: 'delivery_uncertain',
    });
  });
});
