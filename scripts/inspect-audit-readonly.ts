import { requireReadOnlyApiKey } from '../netlify/functions/_lib/auth.js';
import { closeDatabasePool, query, queryOne } from '../netlify/functions/_lib/db.js';
import { inspectEnvironmentAudit } from '../netlify/functions/audit-log.js';

const maxEnvironments = 50;
const pageSize = 25;
const token = process.env.FLASH_PLATFORM_HEALTH_API_KEY;
delete process.env.FLASH_PLATFORM_HEALTH_API_KEY;

// This process uses the application's database role with read-only transactions.
process.env.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000';

async function main() {
  if (!token) {
    console.log(JSON.stringify({ ok: false, reason: 'credential_missing' }));
    return false;
  }

  const database = await queryOne<{ transaction_read_only: string }>('SHOW transaction_read_only');
  if (database?.transaction_read_only !== 'on') {
    console.log(JSON.stringify({ ok: false, reason: 'database_not_read_only' }));
    return false;
  }

  const headers = { authorization: 'Bearer ' + token };
  const { apiKey } = await requireReadOnlyApiKey(new Request('http://localhost/api/audit-log', { headers }));
  const environments = apiKey.scope_type === 'environment'
    ? [{ id: apiKey.scope_id }]
    : await query<{ id: string }>(
      'SELECT id FROM environments WHERE workspace_id = $1 ORDER BY id LIMIT $2',
      [apiKey.workspace_id, maxEnvironments + 1],
    );

  const dateFrom = new Date(Date.now() - 86_400_000).toISOString();
  let total = 0;
  let inspected = 0;
  let truncated = 0;
  const statuses: Record<number, number> = {};

  for (const { id } of environments.slice(0, maxEnvironments)) {
    const url = new URL('http://localhost/api/audit-log');
    url.searchParams.set('environment_id', id);
    url.searchParams.set('date_from', dateFrom);
    url.searchParams.set('per_page', String(pageSize));
    url.searchParams.set('export', 'true');
    const response = await inspectEnvironmentAudit(new Request(url, { headers }));
    statuses[response.status] = (statuses[response.status] ?? 0) + 1;
    if (!response.ok) continue;
    const { total: count } = await response.json() as { total: number };
    total += count;
    inspected++;
    if (count > pageSize) truncated++;
  }

  const ok = inspected > 0 && inspected === environments.length;
  console.log(JSON.stringify({
    ok,
    scope: apiKey.scope_type,
    date_from: dateFrom,
    environments_inspected: inspected,
    environments_limited: environments.length > maxEnvironments,
    truncated_result_pages: truncated,
    visible_events: total,
    statuses,
  }));
  return ok;
}

try {
  if (!await main()) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify(error instanceof Response
    ? { ok: false, status: error.status }
    : { ok: false, reason: 'audit_inspection_failed' }));
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
