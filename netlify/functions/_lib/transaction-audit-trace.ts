import type { PoolClient } from 'pg';
import { captureAuditCommitReceipt, traceEvent, type TraceActor } from './operational-trace.js';
import { UUID_PATTERN } from '../../../shared/trace-contract.js';
import { runDatabaseDiagnostic } from './database-diagnostic-context.js';

const MAX_CANDIDATES = 512;
type Receipt = ReturnType<typeof captureAuditCommitReceipt>;
type Candidates = { receipts: Map<string, Receipt>; overflow: number };
const transactions = new WeakMap<PoolClient, Candidates>();

export function beginTransactionAuditTrace(client: PoolClient): void {
  if (process.env.FLASH_TRACE_DIR) transactions.set(client, { receipts: new Map(), overflow: 0 });
}

export function hasTransactionAuditTrace(client: PoolClient): boolean { return transactions.has(client); }

export async function prepareTransactionAuditTrace(client: PoolClient): Promise<boolean> {
 return runDatabaseDiagnostic(async () => {
  const state = transactions.get(client);
  if (!state) return false;
  if (state.receipts.size >= MAX_CANDIDATES) { state.overflow++; return false; }
  // RETURNING adds a SELECT privilege requirement. Never change whether the
  // caller's original INSERT is permitted or invoke row security for telemetry.
  await client.query('SAVEPOINT flash_trace_audit_capability');
  try {
    const result = await client.query<{ allowed: boolean }>("SELECT has_column_privilege('audit_log', 'id', 'SELECT') AND NOT row_security_active('audit_log') AS allowed");
    await client.query('RELEASE SAVEPOINT flash_trace_audit_capability');
    return result.rows[0]?.allowed === true;
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT flash_trace_audit_capability');
    await client.query('RELEASE SAVEPOINT flash_trace_audit_capability');
    return false;
  }
 });
}

export function queueTransactionAuditTrace(
  client: PoolClient, rowId: unknown, metadata: Record<string, unknown>, actor?: TraceActor, captured?: Receipt,
): string | undefined {
  const state = transactions.get(client);
  if (!state || typeof rowId !== 'string' || !UUID_PATTERN.test(rowId)) return;
  if (state.receipts.size >= MAX_CANDIDATES) return;
  const receipt = captured ?? captureAuditCommitReceipt(metadata, actor);
  state.receipts.set(rowId, receipt);
  return receipt.id;
}

export function discardTransactionAuditTrace(client: PoolClient): void {
  transactions.delete(client);
}

// Only this diagnostic transaction follows the product COMMIT. Failure cannot
// roll back an already committed product result. Return false if the caller
// must destroy this connection rather than lend uncertain state to another user.
export async function confirmTransactionAuditTrace(client: PoolClient, commitObservedAt: string): Promise<boolean> {
 return runDatabaseDiagnostic(async () => {
  const state = transactions.get(client);
  transactions.delete(client);
  if (!state || !process.env.FLASH_TRACE_DIR || (!state.receipts.size && !state.overflow)) return true;
  if (state.overflow) traceEvent('audit.transaction_unconfirmed', { count: state.overflow, reason: 'candidate_limit' });
  if (!state.receipts.size) return true;
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<boolean>(resolve => {
    timer = setTimeout(() => {
      expired = true;
      traceEvent('audit.transaction_unconfirmed', { count: state.receipts.size, reason: 'verification_deadline' });
      resolve(false);
    }, 750);
  });
  const check = () => { if (expired) throw Error('Diagnostic deadline reached'); };
  const command = async <T = Record<string, unknown>>(sql: string, values?: unknown[]) => {
    check(); const result = await client.query<T>(sql, values); check(); return result;
  };
  const work = (async () => {
   let idle = false;
   try {
    await command('BEGIN READ ONLY');
    await command("SET LOCAL statement_timeout = '250ms'");
    await command("SET LOCAL lock_timeout = '100ms'");
    const result = await command<{ id: string }>('SELECT id FROM audit_log WHERE id = ANY($1::uuid[])', [[...state.receipts.keys()]]);
    // Observe durability when positive evidence arrives, not by backdating a
    // receipt into a rotation whose checkpoint may already have been published.
    const survivors = new Set(result.rows.map(row => row.id));
    const completion = await command('COMMIT');
    idle = completion.command === 'COMMIT';
    if (!idle) throw Error('Diagnostic transaction did not commit');
    const observedAt = new Date();
    for (const [id, receipt] of state.receipts) if (survivors.has(id)) receipt.emit(observedAt, commitObservedAt);
    const missing = state.receipts.size - survivors.size;
    if (missing) traceEvent('audit.transaction_unconfirmed', { count: missing, reason: 'row_not_observed' });
   } catch {
    if (!expired) traceEvent('audit.transaction_unconfirmed', { count: state.receipts.size, reason: 'verification_failed' });
   } finally {
    if (!idle && !expired) {
      try { idle = (await command('ROLLBACK')).command === 'ROLLBACK'; } catch { /* caller discards connection */ }
    }
   }
   return idle;
  })();
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer!); }
 });
}
