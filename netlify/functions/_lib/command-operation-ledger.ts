import { execute, query, queryOne } from './db.js';
import { amapiCall } from './amapi.js';
import { classifyAmapiCommandOperation, extractAmapiCommandType } from './amapi-command-result.js';
import { logAudit } from './audit.js';

export type CommandOperationSource = 'direct' | 'workflow' | 'bulk' | 'geofence';
export type CommandOperationStatus =
  | 'submitted'
  | 'delivery_uncertain'
  | 'reconciling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unresolved';

export interface CommandOperationLedgerRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  device_id: string | null;
  device_amapi_name: string;
  workflow_execution_id: string | null;
  source: CommandOperationSource;
  command_type: string;
  status: CommandOperationStatus;
  operation_name: string | null;
  operation_created_at: string | null;
  operation_done: boolean | null;
  operation_error_code: number | null;
  operation_error_message: string | null;
  upstream_status: number | null;
  reconcile_page_token: string | null;
  reconcile_pages_scanned: number;
  reconcile_failures: number;
  requested_at: string;
  last_reconciled_at: string | null;
  resolved_at: string | null;
}

interface RecordCommandOperationInput {
  workspaceId: string;
  environmentId: string;
  deviceId: string | null;
  deviceAmapiName: string;
  workflowExecutionId?: string | null;
  source: CommandOperationSource;
  commandType: string;
  requestedAt: Date;
}

interface OperationListResult {
  operations?: Array<Record<string, unknown>>;
  nextPageToken?: string;
}

export interface LedgerOperationView {
  name: string;
  done: boolean;
  metadata: { type: string; createTime: string };
  error?: { code: number; message: string };
  source: 'ledger';
  ledgerStatus: CommandOperationStatus;
  ledgerId: string;
  reconciliation?: {
    pagesScanned: number;
    lastCheckedAt?: string;
  };
}

export type ReconciliationResult = 'completed' | 'continue';

const RECONCILIATION_PAGE_SIZE = 100;
export const MAX_RECONCILIATION_PAGES = 250;
export const COMMAND_MATCH_WINDOW_MS = 10 * 60 * 1000;

export async function enqueueOutstandingCommandReconciliations(): Promise<number> {
  try {
    // A job can be dead-lettered during stale-lease recovery before its handler
    // runs. Surface that terminal state instead of silently re-enqueueing it.
    await execute(
      `UPDATE command_operations co
       SET status = 'unresolved', resolved_at = now(), updated_at = now()
       FROM job_queue jq
       WHERE co.status IN ('delivery_uncertain', 'reconciling')
         AND jq.job_type = 'command_reconcile'
         AND jq.status = 'dead'
         AND jq.payload->>'command_operation_id' = co.id::text`
    );
    const result = await execute(
      `INSERT INTO job_queue (job_type, environment_id, payload, max_attempts)
       SELECT 'command_reconcile', co.environment_id,
              jsonb_build_object('command_operation_id', co.id::text), 5
       FROM command_operations co
       WHERE co.status IN ('delivery_uncertain', 'reconciling')
         AND NOT EXISTS (
           SELECT 1 FROM job_queue jq
           WHERE jq.job_type = 'command_reconcile'
             AND jq.payload->>'command_operation_id' = co.id::text
             AND jq.status IN ('pending', 'locked', 'processing')
         )
       ON CONFLICT DO NOTHING`
    );
    return result.rowCount;
  } catch (err) {
    const pgError = err as { code?: string } | null;
    if (pgError?.code === '42P01') return 0;
    throw err;
  }
}

function asOperation(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getOperationTimestamp(operation: Record<string, unknown>): number | null {
  const metadata = asOperation(operation.metadata);
  if (typeof metadata.createTime === 'string') {
    const parsed = Date.parse(metadata.createTime);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const name = typeof operation.name === 'string' ? operation.name : '';
  const suffix = name.split('/').pop() ?? '';
  const numeric = Number(suffix);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function getOperationError(operation: Record<string, unknown>): { code: number | null; message: string | null } {
  const error = asOperation(operation.error);
  const classified = classifyAmapiCommandOperation(operation);
  return {
    code: typeof error.code === 'number' ? error.code : null,
    message: typeof error.message === 'string'
      ? error.message.slice(0, 2000)
      : classified.error?.slice(0, 2000) ?? null,
  };
}

function ledgerStatusForOperation(operation: Record<string, unknown>): CommandOperationStatus {
  const result = classifyAmapiCommandOperation(operation);
  const error = getOperationErrorWithoutClassification(operation);
  if (error.code === 1 || error.message?.toLowerCase().includes('cancel')) return 'cancelled';
  if (result.status === 'SUCCEEDED') return 'succeeded';
  if (result.status === 'FAILED') return 'failed';
  return 'submitted';
}

function getOperationErrorWithoutClassification(
  operation: Record<string, unknown>,
): { code: number | null; message: string | null } {
  const error = asOperation(operation.error);
  return {
    code: typeof error.code === 'number' ? error.code : null,
    message: typeof error.message === 'string' ? error.message.slice(0, 2000) : null,
  };
}

export function findMatchingCommandOperation(
  operations: Array<Record<string, unknown>>,
  commandType: string,
  requestedAt: Date,
): Record<string, unknown> | null {
  const requestedMs = requestedAt.getTime();
  const normalizedType = commandType.trim().toUpperCase();
  const candidates = operations
    .map((operation) => ({
      operation,
      timestamp: getOperationTimestamp(operation),
      commandType: extractAmapiCommandType(operation),
    }))
    .filter((candidate) =>
      candidate.timestamp !== null
      && candidate.commandType === normalizedType
      && Math.abs(candidate.timestamp - requestedMs) <= COMMAND_MATCH_WINDOW_MS
    )
    .sort((left, right) =>
      Math.abs((left.timestamp ?? 0) - requestedMs) - Math.abs((right.timestamp ?? 0) - requestedMs)
    );
  return candidates[0]?.operation ?? null;
}

export async function recordSubmittedCommandOperation(
  input: RecordCommandOperationInput,
  rawOperation: unknown,
): Promise<string> {
  const operation = asOperation(rawOperation);
  const operationName = typeof operation.name === 'string' ? operation.name : null;
  const operationTimestamp = getOperationTimestamp(operation);
  const error = getOperationError(operation);
  const status = ledgerStatusForOperation(operation);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO command_operations (
       workspace_id, environment_id, device_id, device_amapi_name,
       workflow_execution_id, source, command_type, status, operation_name,
       operation_created_at, operation_done, operation_error_code,
       operation_error_message, requested_at, resolved_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       CASE WHEN $8::varchar IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE NULL END
     )
     ON CONFLICT (environment_id, operation_name) WHERE operation_name IS NOT NULL
     DO UPDATE SET
       status = EXCLUDED.status,
       operation_done = EXCLUDED.operation_done,
       operation_error_code = EXCLUDED.operation_error_code,
       operation_error_message = EXCLUDED.operation_error_message,
       updated_at = now(),
       resolved_at = EXCLUDED.resolved_at
     RETURNING id`,
    [
      input.workspaceId,
      input.environmentId,
      input.deviceId,
      input.deviceAmapiName,
      input.workflowExecutionId ?? null,
      input.source,
      input.commandType.trim().toUpperCase(),
      status,
      operationName,
      operationTimestamp === null ? null : new Date(operationTimestamp).toISOString(),
      typeof operation.done === 'boolean' ? operation.done : null,
      error.code,
      error.message,
      input.requestedAt.toISOString(),
    ]
  );
  if (!row) throw new Error('Failed to persist command operation');
  return row.id;
}

export async function recordUncertainCommandOperation(
  input: RecordCommandOperationInput,
  upstreamStatus: number | null,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO command_operations (
       workspace_id, environment_id, device_id, device_amapi_name,
       workflow_execution_id, source, command_type, status, upstream_status,
       requested_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'delivery_uncertain', $8, $9)
     RETURNING id`,
    [
      input.workspaceId,
      input.environmentId,
      input.deviceId,
      input.deviceAmapiName,
      input.workflowExecutionId ?? null,
      input.source,
      input.commandType.trim().toUpperCase(),
      upstreamStatus,
      input.requestedAt.toISOString(),
    ]
  );
  if (!row) throw new Error('Failed to persist uncertain command operation');

  await execute(
    `INSERT INTO job_queue (job_type, environment_id, payload, max_attempts)
     VALUES ('command_reconcile', $1, jsonb_build_object('command_operation_id', $2::text), 5)
     ON CONFLICT ((payload->>'command_operation_id'))
       WHERE job_type = 'command_reconcile' AND status IN ('pending', 'locked', 'processing')
     DO NOTHING`,
    [input.environmentId, row.id]
  );
  return row.id;
}

export async function updateCommandOperationFromEvent(
  environmentId: string,
  operation: Record<string, unknown>,
): Promise<void> {
  const operationName = typeof operation.name === 'string' ? operation.name : null;
  if (!operationName) return;
  const status = ledgerStatusForOperation(operation);
  const error = getOperationError(operation);
  await execute(
    `UPDATE command_operations
     SET status = $1,
         operation_done = $2,
         operation_error_code = $3,
         operation_error_message = $4,
         resolved_at = CASE WHEN $1 IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE resolved_at END,
         updated_at = now()
     WHERE environment_id = $5 AND operation_name = $6`,
    [status, typeof operation.done === 'boolean' ? operation.done : null, error.code, error.message, environmentId, operationName]
  );
}

export async function recordCommandReconciliationFailure(
  commandOperationId: string,
  terminal: boolean,
): Promise<void> {
  const row = await queryOne<Pick<CommandOperationLedgerRow, 'id' | 'workspace_id' | 'environment_id' | 'device_id' | 'command_type'>>(
    `UPDATE command_operations
     SET reconcile_failures = reconcile_failures + 1,
         last_reconciled_at = now(),
         status = CASE WHEN $2 THEN 'unresolved' ELSE status END,
         resolved_at = CASE WHEN $2 THEN now() ELSE resolved_at END,
         updated_at = now()
     WHERE id = $1
     RETURNING id, workspace_id, environment_id, device_id, command_type`,
    [commandOperationId, terminal]
  );
  if (!terminal || !row) return;
  await logAudit({
    workspace_id: row.workspace_id,
    environment_id: row.environment_id,
    device_id: row.device_id ?? undefined,
    actor_type: 'system',
    visibility_scope: 'privileged',
    action: 'device.command.reconciliation_unresolved',
    resource_type: 'command_operation',
    resource_id: row.id,
    details: {
      command_type: row.command_type,
      reason: 'read_only_reconciliation_failed_repeatedly',
      automatic_retry: false,
    },
  });
}

export async function reconcileCommandOperation(commandOperationId: string): Promise<ReconciliationResult> {
  const row = await queryOne<CommandOperationLedgerRow & { enterprise_name: string; gcp_project_id: string }>(
    `SELECT co.*, e.enterprise_name, w.gcp_project_id
     FROM command_operations co
     JOIN environments e ON e.id = co.environment_id
     JOIN workspaces w ON w.id = co.workspace_id
     WHERE co.id = $1`,
    [commandOperationId]
  );
  if (!row || !['delivery_uncertain', 'reconciling'].includes(row.status)) return 'completed';

  const path = row.reconcile_page_token
    ? `${row.device_amapi_name}/operations?pageSize=${RECONCILIATION_PAGE_SIZE}&pageToken=${encodeURIComponent(row.reconcile_page_token)}`
    : `${row.device_amapi_name}/operations?pageSize=${RECONCILIATION_PAGE_SIZE}`;
  const result = await amapiCall<OperationListResult>(path, row.workspace_id, {
    projectId: row.gcp_project_id,
    enterpriseName: row.enterprise_name,
    resourceType: 'devices',
    resourceId: row.device_amapi_name.split('/').pop(),
  });
  const operations = result.operations ?? [];
  const requestedAt = new Date(row.requested_at);
  const match = findMatchingCommandOperation(operations, row.command_type, requestedAt);
  const pagesScanned = row.reconcile_pages_scanned + 1;

  if (match) {
    const operationName = typeof match.name === 'string' ? match.name : null;
    const operationTimestamp = getOperationTimestamp(match);
    const operationError = getOperationError(match);
    const status = ledgerStatusForOperation(match);
    await execute(
      `UPDATE command_operations
       SET status = $2, operation_name = $3, operation_created_at = $4,
           operation_done = $5, operation_error_code = $6,
           operation_error_message = $7, reconcile_page_token = NULL,
           reconcile_pages_scanned = $8, last_reconciled_at = now(),
           resolved_at = CASE WHEN $2 IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $1`,
      [
        row.id,
        status,
        operationName,
        operationTimestamp === null ? null : new Date(operationTimestamp).toISOString(),
        typeof match.done === 'boolean' ? match.done : null,
        operationError.code,
        operationError.message,
        pagesScanned,
      ]
    );
    await logAudit({
      workspace_id: row.workspace_id,
      environment_id: row.environment_id,
      device_id: row.device_id ?? undefined,
      actor_type: 'system',
      visibility_scope: 'privileged',
      action: 'device.command.reconciled',
      resource_type: 'command_operation',
      resource_id: row.id,
      details: {
        command_type: row.command_type,
        operation_name: operationName,
        status,
        pages_scanned: pagesScanned,
        automatic_retry: false,
      },
    });
    return 'completed';
  }

  const timestamps = operations
    .map(getOperationTimestamp)
    .filter((value): value is number => value !== null);
  // AMAPI returned this production device's operation history oldest-first.
  // Continue while a page is older than the target and stop only once every
  // timestamp on the page has crossed the upper edge of the match window.
  const passedTargetWindow = timestamps.length > 0
    && Math.min(...timestamps) > requestedAt.getTime() + COMMAND_MATCH_WINDOW_MS;
  const exhausted = !result.nextPageToken || pagesScanned >= MAX_RECONCILIATION_PAGES || passedTargetWindow;
  if (exhausted) {
    await execute(
      `UPDATE command_operations
       SET status = 'unresolved', reconcile_page_token = NULL,
           reconcile_pages_scanned = $2, last_reconciled_at = now(),
           resolved_at = now(), updated_at = now()
       WHERE id = $1`,
      [row.id, pagesScanned]
    );
    await logAudit({
      workspace_id: row.workspace_id,
      environment_id: row.environment_id,
      device_id: row.device_id ?? undefined,
      actor_type: 'system',
      visibility_scope: 'privileged',
      action: 'device.command.reconciliation_unresolved',
      resource_type: 'command_operation',
      resource_id: row.id,
      details: {
        command_type: row.command_type,
        pages_scanned: pagesScanned,
        exhausted_history: !result.nextPageToken,
        page_limit_reached: pagesScanned >= MAX_RECONCILIATION_PAGES,
        passed_target_window: passedTargetWindow,
        automatic_retry: false,
      },
    });
    return 'completed';
  }

  await execute(
    `UPDATE command_operations
     SET status = 'reconciling', reconcile_page_token = $2,
         reconcile_pages_scanned = $3, last_reconciled_at = now(), updated_at = now()
     WHERE id = $1`,
    [row.id, result.nextPageToken, pagesScanned]
  );
  return 'continue';
}

export async function listDeviceCommandOperations(deviceId: string): Promise<LedgerOperationView[]> {
  const rows = await query<CommandOperationLedgerRow>(
    `SELECT * FROM command_operations
     WHERE device_id = $1
     ORDER BY requested_at DESC
     LIMIT 500`,
    [deviceId]
  );
  return rows.map((row) => {
    const errorMessage = row.operation_error_message
      ?? (row.status === 'delivery_uncertain' || row.status === 'reconciling'
        ? 'Command delivery is uncertain; read-only reconciliation is in progress.'
        : row.status === 'unresolved'
          ? 'Command delivery remains unresolved after bounded read-only reconciliation.'
          : null);
    return {
      name: row.operation_name ?? `ledger/${row.id}`,
      done: ['succeeded', 'failed', 'cancelled', 'unresolved'].includes(row.status),
      metadata: {
        type: row.command_type,
        createTime: row.operation_created_at ?? row.requested_at,
      },
      ...(errorMessage ? { error: { code: row.operation_error_code ?? 0, message: errorMessage } } : {}),
      source: 'ledger',
      ledgerStatus: row.status,
      ledgerId: row.id,
      reconciliation: {
        pagesScanned: row.reconcile_pages_scanned,
        ...(row.last_reconciled_at ? { lastCheckedAt: row.last_reconciled_at } : {}),
      },
    };
  });
}
