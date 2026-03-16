import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { query, execute } from '../_lib/db.js';
import { dispatchWorkflowEvent } from '../_lib/workflow-dispatch.js';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockExecute = execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('dispatchWorkflowEvent', () => {
  it('enqueues a workflow_evaluate job for matching workflow', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'wf-1', trigger_config: null, scope_type: 'environment', scope_id: null },
    ]);
    mockExecute.mockResolvedValue(undefined);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'device.enrolled',
      triggerData: { manufacturer: 'Google' },
    });

    expect(count).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockExecute.mock.calls[0][1][2]);
    expect(payload.workflow_id).toBe('wf-1');
    expect(payload.device_id).toBe('dev-1');
    expect(payload.trigger_data.trigger_type).toBe('device.enrolled');
  });

  it('returns 0 when no workflows match', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'device.enrolled',
      triggerData: {},
    });

    expect(count).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('filters by state_changed trigger_config (to_state)', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'wf-state',
        trigger_config: JSON.stringify({ to_state: 'DISABLED' }),
        scope_type: 'environment',
        scope_id: null,
      },
    ]);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'device.state_changed',
      triggerData: { previous_state: 'ACTIVE', new_state: 'DISABLED' },
    });

    expect(count).toBe(1);
  });

  it('skips workflow when state_changed filter does not match', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'wf-state',
        trigger_config: JSON.stringify({ to_state: 'DISABLED' }),
        scope_type: 'environment',
        scope_id: null,
      },
    ]);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'device.state_changed',
      triggerData: { previous_state: 'ACTIVE', new_state: 'ACTIVE' },
    });

    expect(count).toBe(0);
  });

  it('checks group scope via group_closures', async () => {
    // First call: query for workflows
    mockQuery.mockResolvedValueOnce([
      { id: 'wf-grp', trigger_config: null, scope_type: 'group', scope_id: 'grp-parent' },
    ]);
    // Second call: group_closures check
    mockQuery.mockResolvedValueOnce([{ '?column?': 1 }]);
    mockExecute.mockResolvedValue(undefined);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      deviceGroupId: 'grp-child',
      triggerType: 'device.enrolled',
      triggerData: {},
    });

    expect(count).toBe(1);
    // Verify group_closures was queried
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][1]).toEqual(['grp-parent', 'grp-child']);
  });

  it('skips group-scoped workflow when device not in group', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'wf-grp', trigger_config: null, scope_type: 'group', scope_id: 'grp-parent' },
    ]);
    // group_closures: no match
    mockQuery.mockResolvedValueOnce([]);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      deviceGroupId: 'grp-other',
      triggerType: 'device.enrolled',
      triggerData: {},
    });

    expect(count).toBe(0);
  });

  it('skips group-scoped workflow when device has no group', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'wf-grp', trigger_config: null, scope_type: 'group', scope_id: 'grp-parent' },
    ]);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      deviceGroupId: null,
      triggerType: 'device.enrolled',
      triggerData: {},
    });

    expect(count).toBe(0);
    // Should NOT query group_closures
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('filters app.installed by package_name', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'wf-app',
        trigger_config: { package_name: 'com.example.app' },
        scope_type: 'environment',
        scope_id: null,
      },
    ]);
    mockExecute.mockResolvedValue(undefined);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'app.installed',
      triggerData: { package_name: 'com.example.app' },
    });

    expect(count).toBe(1);
  });

  it('skips app.installed when package_name does not match', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'wf-app',
        trigger_config: { package_name: 'com.example.app' },
        scope_type: 'environment',
        scope_id: null,
      },
    ]);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'app.installed',
      triggerData: { package_name: 'com.other.app' },
    });

    expect(count).toBe(0);
  });

  it('enqueues multiple workflows for same trigger', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'wf-1', trigger_config: null, scope_type: 'environment', scope_id: null },
      { id: 'wf-2', trigger_config: null, scope_type: 'environment', scope_id: null },
    ]);
    mockExecute.mockResolvedValue(undefined);

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'compliance.changed',
      triggerData: { previous_compliant: true, new_compliant: false },
    });

    expect(count).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('returns 0 and does not throw on DB error (non-fatal)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const count = await dispatchWorkflowEvent({
      environmentId: 'env-1',
      deviceId: 'dev-1',
      triggerType: 'device.enrolled',
      triggerData: {},
    });

    expect(count).toBe(0);
  });
});
