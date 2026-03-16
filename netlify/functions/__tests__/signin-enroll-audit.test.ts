import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
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

import { queryOne, execute } from '../_lib/db.js';
import { amapiCall } from '../_lib/amapi.js';
import { consumeToken } from '../_lib/rate-limiter.js';
import { sendEmail } from '../_lib/resend.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../signin-enroll.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
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
  mockQueryOne
    .mockResolvedValueOnce({
      id: 'env_1',
      enterprise_name: 'enterprises/e1',
      workspace_id: 'ws_1',
    } as never)
    .mockResolvedValueOnce({
      gcp_project_id: 'proj-1',
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
        environment_id: 'env_1',
      }),
      {} as never
    );

    expect(res.status).toBe(200);
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
        environment_id: 'env_1',
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
  });
});
