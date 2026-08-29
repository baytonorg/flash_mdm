import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockQueryOne, mockExecute, mockTransaction } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: mockExecute,
  transaction: mockTransaction,
}));

vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/amapi.js', () => ({ amapiCall: vi.fn() }));
vi.mock('../_lib/haversine.js', () => ({
  isInsideCircle: vi.fn(),
  isInsidePolygon: vi.fn(),
}));
vi.mock('../_lib/webhook-ssrf.js', () => ({
  validateResolvedWebhookUrlForOutbound: vi.fn(),
}));

import cleanupHandler from '../cleanup-scheduled.ts';
import geofenceHandler from '../geofence-check-scheduled.ts';
import syncHandler from '../sync-reconcile-scheduled.ts';
import workflowHandler from '../workflow-cron-scheduled.ts';

describe('scheduled function failure observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([
    ['cleanup', cleanupHandler],
    ['geofence', geofenceHandler],
    ['sync reconciliation', syncHandler],
    ['workflow cron', workflowHandler],
  ])('returns HTTP 500 when %s cannot reach the database', async (_name, handler) => {
    mockQuery.mockRejectedValue(new Error('database unavailable'));
    mockExecute.mockRejectedValue(new Error('database unavailable'));

    const response = await handler(
      new Request('http://localhost/.netlify/functions/scheduled'),
      {} as never
    );

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringMatching(/failed/i),
    });
  });
});
