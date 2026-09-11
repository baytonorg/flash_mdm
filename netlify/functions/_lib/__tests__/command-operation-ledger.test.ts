import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  execute: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../amapi.js', () => ({
  amapiCall: vi.fn(),
}));

vi.mock('../audit.js', () => ({
  logAudit: vi.fn(),
}));

import { execute, queryOne } from '../db.js';
import { amapiCall } from '../amapi.js';
import { logAudit } from '../audit.js';
import {
  findMatchingCommandOperation,
  getOperationTimestamp,
  reconcileCommandOperation,
  recordCommandReconciliationFailure,
  recordSubmittedCommandOperation,
  recordUncertainCommandOperation,
} from '../command-operation-ledger.js';

const mockExecute = vi.mocked(execute);
const mockQueryOne = vi.mocked(queryOne);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);

const row = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  workspace_id: '550e8400-e29b-41d4-a716-446655440002',
  environment_id: '550e8400-e29b-41d4-a716-446655440003',
  device_id: '550e8400-e29b-41d4-a716-446655440004',
  device_amapi_name: 'enterprises/e1/devices/d1',
  workflow_execution_id: null,
  source: 'workflow',
  command_type: 'REBOOT',
  status: 'delivery_uncertain',
  operation_name: null,
  operation_created_at: null,
  operation_done: null,
  operation_error_code: null,
  operation_error_message: null,
  upstream_status: 502,
  reconcile_page_token: null,
  reconcile_pages_scanned: 0,
  reconcile_failures: 0,
  requested_at: '2026-09-10T08:00:00.000Z',
  last_reconciled_at: null,
  resolved_at: null,
  enterprise_name: 'enterprises/e1',
  gcp_project_id: 'project-1',
};

beforeEach(() => {
  mockExecute.mockReset();
  mockQueryOne.mockReset();
  mockAmapiCall.mockReset();
  mockLogAudit.mockReset();
  mockExecute.mockResolvedValue({ rowCount: 1 });
  mockLogAudit.mockResolvedValue(undefined);
});

describe('command operation matching', () => {
  it('extracts an AMAPI operation timestamp from metadata or its numeric suffix', () => {
    expect(getOperationTimestamp({ metadata: { createTime: '2026-09-10T08:00:00Z' } }))
      .toBe(Date.parse('2026-09-10T08:00:00Z'));
    expect(getOperationTimestamp({ name: 'enterprises/e1/operations/1789027200000' }))
      .toBe(1789027200000);
  });

  it('matches only the same command type inside the bounded time window', () => {
    const requestedAt = new Date('2026-09-10T08:00:00Z');
    const reboot = {
      name: 'enterprises/e1/operations/reboot',
      metadata: { type: 'REBOOT', createTime: '2026-09-10T08:02:00Z' },
    };
    const lock = {
      name: 'enterprises/e1/operations/lock',
      metadata: { type: 'LOCK', createTime: '2026-09-10T08:00:30Z' },
    };
    expect(findMatchingCommandOperation([lock, reboot], 'REBOOT', requestedAt)).toBe(reboot);
    expect(findMatchingCommandOperation([lock], 'REBOOT', requestedAt)).toBeNull();
  });
});

describe('command operation persistence', () => {
  it('persists successful operation names with device, type, source, and request time', async () => {
    mockQueryOne.mockResolvedValue({ id: row.id } as never);
    const id = await recordSubmittedCommandOperation({
      workspaceId: row.workspace_id,
      environmentId: row.environment_id,
      deviceId: row.device_id,
      deviceAmapiName: row.device_amapi_name,
      source: 'direct',
      commandType: 'reboot',
      requestedAt: new Date(row.requested_at),
    }, {
      name: 'enterprises/e1/devices/d1/operations/1789027200000',
      done: false,
      metadata: { type: 'REBOOT', createTime: row.requested_at },
    });

    expect(id).toBe(row.id);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("CASE WHEN $8::varchar IN ('succeeded', 'failed', 'cancelled')"),
      expect.arrayContaining([row.device_id, 'direct', 'REBOOT', 'submitted'])
    );
  });

  it('persists uncertainty and queues a single read-only reconciliation job', async () => {
    mockQueryOne.mockResolvedValue({ id: row.id } as never);
    await recordUncertainCommandOperation({
      workspaceId: row.workspace_id,
      environmentId: row.environment_id,
      deviceId: row.device_id,
      deviceAmapiName: row.device_amapi_name,
      source: 'workflow',
      commandType: 'REBOOT',
      requestedAt: new Date(row.requested_at),
    }, 502);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ('command_reconcile'"),
      [row.environment_id, row.id]
    );
  });
});

describe('bounded read-only reconciliation', () => {
  it('records terminal read failures as unresolved and audits without replaying', async () => {
    mockQueryOne.mockResolvedValue({
      id: row.id,
      workspace_id: row.workspace_id,
      environment_id: row.environment_id,
      device_id: row.device_id,
      command_type: row.command_type,
    } as never);

    await recordCommandReconciliationFailure(row.id, true);

    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("status = CASE WHEN $2 THEN 'unresolved'"),
      [row.id, true]
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'device.command.reconciliation_unresolved',
      details: expect.objectContaining({
        automatic_retry: false,
        reason: 'read_only_reconciliation_failed_repeatedly',
      }),
    }));
    expect(mockAmapiCall).not.toHaveBeenCalled();
  });

  it('persists the continuation token and pauses between pages', async () => {
    mockQueryOne.mockResolvedValue(row as never);
    mockAmapiCall.mockResolvedValue({
      operations: [{
        name: 'enterprises/e1/operations/1772128508043',
        done: true,
        metadata: { type: 'REBOOT', createTime: '2026-02-26T17:55:08Z' },
      }],
      nextPageToken: 'page-2',
    } as never);

    await expect(reconcileCommandOperation(row.id)).resolves.toBe('continue');
    expect(mockAmapiCall).toHaveBeenCalledWith(
      'enterprises/e1/devices/d1/operations?pageSize=100',
      row.workspace_id,
      expect.anything()
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'reconciling'"),
      [row.id, 'page-2', 1]
    );
  });

  it('records a matched operation without replaying the command', async () => {
    mockQueryOne.mockResolvedValue({ ...row, reconcile_page_token: 'page-140', reconcile_pages_scanned: 139 } as never);
    mockAmapiCall.mockResolvedValue({
      operations: [{
        name: 'enterprises/e1/devices/d1/operations/1789027320000',
        done: true,
        response: { '@type': 'IssueCommandResponse' },
        metadata: { type: 'REBOOT', createTime: '2026-09-10T08:02:00Z' },
      }],
      nextPageToken: 'page-141',
    } as never);

    await expect(reconcileCommandOperation(row.id)).resolves.toBe('completed');
    expect(mockAmapiCall).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('operation_name = $3'),
      expect.arrayContaining([row.id, 'succeeded', 'enterprises/e1/devices/d1/operations/1789027320000', 140])
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'device.command.reconciled',
      details: expect.objectContaining({ automatic_retry: false, pages_scanned: 140 }),
    }));
  });

  it('continues through pages that contain only operations older than the target', async () => {
    mockQueryOne.mockResolvedValue(row as never);
    mockAmapiCall.mockResolvedValue({
      operations: [{
        name: 'enterprises/e1/operations/earlier',
        done: true,
        metadata: { type: 'LOCK', createTime: '2026-09-10T07:40:00Z' },
      }],
      nextPageToken: 'another-page',
    } as never);

    await expect(reconcileCommandOperation(row.id)).resolves.toBe('continue');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'reconciling'"),
      [row.id, 'another-page', 1]
    );
  });

  it('marks the command unresolved after the scan passes above its target window', async () => {
    mockQueryOne.mockResolvedValue(row as never);
    mockAmapiCall.mockResolvedValue({
      operations: [{
        name: 'enterprises/e1/operations/later',
        done: true,
        metadata: { type: 'LOCK', createTime: '2026-09-10T08:20:00Z' },
      }],
      nextPageToken: 'another-page',
    } as never);

    await expect(reconcileCommandOperation(row.id)).resolves.toBe('completed');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'unresolved'"),
      [row.id, 1]
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'device.command.reconciliation_unresolved',
      details: expect.objectContaining({ automatic_retry: false, passed_target_window: true }),
    }));
  });
});
