import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunLicensingReconcile, mockIsLicensingDryRun, mockRequireInternalCaller } = vi.hoisted(() => ({
  mockRunLicensingReconcile: vi.fn(),
  mockIsLicensingDryRun: vi.fn(),
  mockRequireInternalCaller: vi.fn(),
}));

vi.mock('../_lib/licensing-reconcile.js', () => ({
  runLicensingReconcile: mockRunLicensingReconcile,
}));

vi.mock('../_lib/licensing.js', () => ({
  isLicensingDryRun: mockIsLicensingDryRun,
}));

vi.mock('../_lib/internal-auth.js', () => ({
  requireInternalCaller: mockRequireInternalCaller,
}));

import internalHandler from '../licensing-reconcile.ts';
import scheduledHandler from '../licensing-reconcile-scheduled.ts';

beforeEach(() => {
  mockRunLicensingReconcile.mockReset();
  mockIsLicensingDryRun.mockReset();
  mockRequireInternalCaller.mockReset();
  mockIsLicensingDryRun.mockReturnValue(true);
  mockRunLicensingReconcile.mockResolvedValue({
    environments_checked: 0,
    overage_environments: 0,
    cases_created: 0,
    cases_resolved: 0,
    disable_actions_queued: 0,
    wipe_actions_queued: 0,
    enable_actions_queued: 0,
    errors: 0,
    dry_run: true,
    lock_acquired: true,
    skipped_due_to_lock: false,
  });
});

describe('licensing reconcile handlers', () => {
  it('rejects non-POST calls to internal reconcile endpoint', async () => {
    const response = await internalHandler(
      new Request('http://localhost/api/licensing/reconcile', { method: 'GET' }),
      {} as never
    );
    expect(response.status).toBe(405);
  });

  it('runs internal reconcile with dry-run setting and internal auth gate', async () => {
    const response = await internalHandler(
      new Request('http://localhost/api/licensing/reconcile', { method: 'POST' }),
      {} as never
    );

    expect(response.status).toBe(200);
    expect(mockRequireInternalCaller).toHaveBeenCalled();
    expect(mockRunLicensingReconcile).toHaveBeenCalledWith({ dryRun: true });
  });

  it('runs scheduled reconcile and returns stats payload', async () => {
    const response = await scheduledHandler(
      new Request('http://localhost/.netlify/functions/licensing-reconcile-scheduled', { method: 'GET' }),
      {} as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Licensing reconcile completed',
      stats: expect.objectContaining({ dry_run: true }),
    });
  });
});
