import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/haversine.js', () => ({
  isInsideCircle: vi.fn(),
  isInsidePolygon: vi.fn(),
}));

vi.mock('../_lib/webhook-ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/webhook-ssrf.js')>();
  return {
    ...actual,
    validateResolvedWebhookUrlForOutbound: vi.fn(actual.validateResolvedWebhookUrlForOutbound),
  };
});

import { query, queryOne, execute } from '../_lib/db.js';
import { isInsideCircle, isInsidePolygon } from '../_lib/haversine.js';
import { validateResolvedWebhookUrlForOutbound } from '../_lib/webhook-ssrf.js';
import handler from '../geofence-check-scheduled.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(execute);
const mockIsInsideCircle = vi.mocked(isInsideCircle);
const mockIsInsidePolygon = vi.mocked(isInsidePolygon);
const mockValidateResolvedWebhookUrlForOutbound = vi.mocked(validateResolvedWebhookUrlForOutbound);

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockIsInsideCircle.mockReset();
  mockIsInsidePolygon.mockReset();
  mockValidateResolvedWebhookUrlForOutbound.mockReset();

  mockIsInsideCircle.mockReturnValue(true);
  mockIsInsidePolygon.mockReturnValue(false);
  mockExecute.mockResolvedValue({ rowCount: 1 } as never);
  mockValidateResolvedWebhookUrlForOutbound.mockImplementation(async (urlValue) => {
    const actual = await vi.importActual<typeof import('../_lib/webhook-ssrf.js')>('../_lib/webhook-ssrf.js');
    return actual.validateResolvedWebhookUrlForOutbound(urlValue);
  });
});

function primeSingleTransition(actionOnEnter: Record<string, unknown>) {
  mockQuery
    .mockResolvedValueOnce([{ environment_id: 'env_1' }] as never)
    .mockResolvedValueOnce([{
      id: 'geo_1',
      environment_id: 'env_1',
      name: 'Fence A',
      latitude: 1,
      longitude: 2,
      radius_meters: 100,
      polygon: null,
      scope_type: 'environment',
      scope_id: null,
      action_on_enter: actionOnEnter,
      action_on_exit: {},
    }] as never)
    .mockResolvedValueOnce([{
      device_id: 'dev_1',
      latitude: 1,
      longitude: 2,
      group_id: 'grp_1',
    }] as never);

  // Previous state missing => transitions to enter
  mockQueryOne.mockResolvedValueOnce(null as never);
}

describe('geofence-check-scheduled hardening', () => {
  it('does not move devices to groups outside the geofence environment', async () => {
    primeSingleTransition({ type: 'move_group', target_group_id: 'grp_other_env' });
    mockQueryOne.mockResolvedValueOnce(null as never); // target group validation lookup fails

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handler(new Request('http://localhost/.netlify/functions/geofence-check-scheduled'), {} as never);

    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      ['grp_other_env', 'env_1']
    );
    expect(mockExecute).not.toHaveBeenCalledWith(
      'UPDATE devices SET group_id = $1, updated_at = now() WHERE id = $2',
      ['grp_other_env', 'dev_1']
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping geofence move_group'));

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does not enqueue webhook jobs for blocked private webhook URLs', async () => {
    primeSingleTransition({ type: 'webhook', url: 'https://192.168.1.10/hook' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handler(new Request('http://localhost/.netlify/functions/geofence-check-scheduled'), {} as never);

    const webhookInsertCall = mockExecute.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes("job_type, payload, status") && call[0].includes("'webhook'")
    );
    expect(webhookInsertCall).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('blocked address'));

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does not enqueue webhook jobs when DNS-aware resolution blocks a public-looking host', async () => {
    primeSingleTransition({ type: 'webhook', url: 'https://hooks.example.test/hook' });
    mockValidateResolvedWebhookUrlForOutbound.mockResolvedValueOnce({
      ok: false,
      error: 'Webhook URL resolves to a blocked address',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handler(new Request('http://localhost/.netlify/functions/geofence-check-scheduled'), {} as never);

    const webhookInsertCall = mockExecute.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes("'webhook'")
    );
    expect(webhookInsertCall).toBeUndefined();
    expect(mockValidateResolvedWebhookUrlForOutbound).toHaveBeenCalledWith('https://hooks.example.test/hook');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('blocked address'));

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
