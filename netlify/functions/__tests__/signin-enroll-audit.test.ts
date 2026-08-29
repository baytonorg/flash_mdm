import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn((err: unknown) => {
    if (!(err instanceof Error)) return null;
    const status = /^AMAPI error \((\d{3})\):/.exec(err.message)?.[1];
    return status ? Number(status) : null;
  }),
}));

vi.mock('../_lib/crypto.js', () => ({
  hashToken: vi.fn((value: string) => `hash:${value}`),
}));

vi.mock('../_lib/rate-limiter.js', () => ({
  consumeToken: vi.fn(),
}));

vi.mock('../_lib/resend.js', () => ({
  sendEmail: vi.fn(),
  signinVerificationEmail: vi.fn(() => ({ subject: 'Code', html: '<p>Code</p>' })),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/helpers.js', () => ({
  jsonResponse: vi.fn((data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  errorResponse: vi.fn((msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })),
  parseJsonBody: vi.fn(async (req: Request) => req.json()),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { queryOne, execute, query } from '../_lib/db.js';
import { amapiCall } from '../_lib/amapi.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import { sendEmail } from '../_lib/resend.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../signin-enroll.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockQuery = vi.mocked(query);
const mockAmapiCall = vi.mocked(amapiCall);
const mockConsumeToken = vi.mocked(consumeToken);
const mockSendEmail = vi.mocked(sendEmail);
const mockLogAudit = vi.mocked(logAudit);

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/.netlify/functions/signin-enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedEnvironmentAndConfig() {
  mockQuery.mockResolvedValueOnce([{
    workspace_id: 'ws_1',
    gcp_project_id: 'proj-1',
  }] as never);
  mockAmapiCall.mockResolvedValueOnce({
    name: 'provisioningInfo/prov_1',
    enterprise: 'enterprises/e1',
  } as never);
  mockQueryOne
    .mockResolvedValueOnce({
      id: 'env_1',
      enterprise_name: 'enterprises/e1',
      workspace_id: 'ws_1',
    } as never)
    .mockResolvedValueOnce({
      id: 'sc_1',
      environment_id: 'env_1',
      enabled: true,
      allowed_domains: ['example.com'],
      default_group_id: 'grp_1',
      allow_personal_usage: 'PERSONAL_USAGE_ALLOWED',
    } as never);
}

describe('signin-enroll audit coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockExecute.mockResolvedValue({ rowCount: 1 } as never);
    mockConsumeToken.mockResolvedValue({ allowed: true } as never);
    mockAmapiCall.mockReset();
  });

  it('audits code_sent on send-code action', async () => {
    seedEnvironmentAndConfig();

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'provisioningInfo/prov_1',
      'ws_1',
      expect.objectContaining({ projectId: 'proj-1', resourceType: 'general' })
    );
    expect(mockSendEmail).toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      environment_id: 'env_1',
      action: 'signin_enrollment.code_sent',
      resource_type: 'signin_verification',
      details: expect.objectContaining({ email: 'person@example.com' }),
    }));
  });

  it('audits verify_failed when verification code is incorrect', async () => {
    seedEnvironmentAndConfig();
    mockQueryOne.mockResolvedValueOnce({
      id: 'ver_1',
      code_hash: 'hash:999999',
      attempts: 0,
      provisioning_info: null,
    } as never);

    const res = await handler(
      makeRequest({
        action: 'verify',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
        code: '123456',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Incorrect verification code. Please try again.',
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      environment_id: 'env_1',
      action: 'signin_enrollment.verify_failed',
      resource_type: 'signin_verification',
      resource_id: 'ver_1',
      details: expect.objectContaining({
        email: 'person@example.com',
        reason: 'incorrect_code',
      }),
    }));
    expect(mockQueryOne).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('provisioning_info = $3'),
      ['env_1', 'person@example.com', 'provisioningInfo/prov_1']
    );
  });

  it('accepts the full documented provisioningInfo resource name without duplicating it', async () => {
    seedEnvironmentAndConfig();

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'provisioningInfo/prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'provisioningInfo/prov_1',
      'ws_1',
      expect.any(Object)
    );
  });

  it('requires device provisioning information instead of accepting a direct environment id', async () => {
    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        environment_id: 'env_1',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing device provisioning information. Restart enrolment from your device.',
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails closed when AMAPI cannot verify provisioning info', async () => {
    const encodedFallback = Buffer.from(JSON.stringify({
      enterprise: { id: 'e1' },
    })).toString('base64');
    mockQuery.mockResolvedValueOnce([{
      workspace_id: 'ws_1',
      gcp_project_id: 'proj-1',
    }] as never);
    mockAmapiCall.mockRejectedValueOnce(new Error('AMAPI error (404): Not found'));

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: encodedFallback,
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('tries another candidate workspace after an expected lookup miss', async () => {
    mockQuery.mockResolvedValueOnce([
      { workspace_id: 'ws_1', gcp_project_id: 'proj-1' },
      { workspace_id: 'ws_2', gcp_project_id: 'proj-2' },
    ] as never);
    mockAmapiCall
      .mockRejectedValueOnce(new Error('AMAPI error (404): Not found'))
      .mockResolvedValueOnce({
        name: 'provisioningInfo/prov_1',
        enterprise: 'enterprises/e1',
      } as never);
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws_2',
      } as never)
      .mockResolvedValueOnce({
        id: 'sc_1',
        environment_id: 'env_1',
        enabled: true,
        allowed_domains: ['example.com'],
        default_group_id: null,
        allow_personal_usage: 'PERSONAL_USAGE_ALLOWED',
      } as never);

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockAmapiCall).toHaveBeenNthCalledWith(
      2,
      'provisioningInfo/prov_1',
      'ws_2',
      expect.objectContaining({ projectId: 'proj-2' })
    );
    expect(mockQueryOne).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('workspace_id = $2'),
      ['enterprises/e1', 'ws_2']
    );
  });

  it('uses a later authoritative match even after an earlier transient failure', async () => {
    mockQuery.mockResolvedValueOnce([
      { workspace_id: 'ws_1', gcp_project_id: 'proj-1' },
      { workspace_id: 'ws_2', gcp_project_id: 'proj-2' },
    ] as never);
    mockAmapiCall
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        name: 'provisioningInfo/prov_1',
        enterprise: 'enterprises/e1',
      } as never);
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        enterprise_name: 'enterprises/e1',
        workspace_id: 'ws_2',
      } as never)
      .mockResolvedValueOnce({
        id: 'sc_1',
        environment_id: 'env_1',
        enabled: true,
        allowed_domains: ['example.com'],
        default_group_id: null,
        allow_personal_usage: 'PERSONAL_USAGE_ALLOWED',
      } as never);

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(mockAmapiCall).toHaveBeenCalledTimes(2);
  });

  it('returns a retryable upstream error for non-AMAPI lookup failures', async () => {
    mockQuery.mockResolvedValueOnce([{
      workspace_id: 'ws_1',
      gcp_project_id: 'proj-1',
    }] as never);
    mockAmapiCall.mockRejectedValueOnce(new Error('network unavailable'));

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'Unable to verify device provisioning information. Please try again.',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails closed when AMAPI returns a non-string enterprise shape', async () => {
    mockQuery.mockResolvedValueOnce([{
      workspace_id: 'ws_1',
      gcp_project_id: 'proj-1',
    }] as never);
    mockAmapiCall.mockResolvedValueOnce({
      enterprise: { name: 'enterprises/e1' },
    } as never);

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(502);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects an entered email that differs from the Google-authenticated identity', async () => {
    seedEnvironmentAndConfig();
    mockAmapiCall.mockReset();
    mockAmapiCall.mockResolvedValueOnce({
      name: 'provisioningInfo/prov_1',
      enterprise: 'enterprises/e1',
      authenticatedUserEmail: 'google-user@example.com',
    } as never);

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('binds verification to the same provisioning resource that requested the code', async () => {
    seedEnvironmentAndConfig();

    const res = await handler(
      makeRequest({
        action: 'verify',
        email: 'person@example.com',
        provisioning_info: 'prov_2',
        code: '123456',
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'No pending verification found. Please request a new code.',
    });
    expect(mockQueryOne).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('provisioning_info = $3'),
      ['env_1', 'person@example.com', 'provisioningInfo/prov_2']
    );
  });

  it('rate limits before making any authenticated AMAPI lookup', async () => {
    mockConsumeToken.mockResolvedValueOnce({ allowed: false } as never);

    const res = await handler(
      makeRequest({
        action: 'send-code',
        email: 'person@example.com',
        provisioning_info: 'prov_1',
      }),
      {} as never
    );

    expect(res.status).toBe(429);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockAmapiCall).not.toHaveBeenCalled();
  });
});
