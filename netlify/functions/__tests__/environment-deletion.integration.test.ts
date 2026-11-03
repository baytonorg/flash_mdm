// @vitest-environment node
// Opt in only against a disposable database populated with the deployed schema.
// FLASH_DELETION_TEST_URL=postgres://postgres@127.0.0.1:55439/flash_deletion_fixture npx vitest run netlify/functions/__tests__/environment-deletion.integration.test.ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

const database = vi.hoisted(() => ({ pool: null as pg.Pool | null }));
vi.mock('../_lib/db.js', () => ({
  query: async (sql: string, values: unknown[]) => (await database.pool!.query(sql, values)).rows,
  queryOne: async (sql: string, values: unknown[]) => (await database.pool!.query(sql, values)).rows[0] ?? null,
  execute: async (sql: string, values: unknown[]) => database.pool!.query(sql, values),
  transaction: async (fn: (client: pg.PoolClient) => Promise<unknown>) => {
    const client = await database.pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  },
}));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentResourcePermission: vi.fn(), requireEnvironmentPermission: vi.fn(),
  requireWorkspaceResourcePermission: vi.fn(), getWorkspaceAccessScopeForAuth: vi.fn(),
}));
vi.mock('../_lib/amapi.js', () => ({ amapiCall: vi.fn(), getAmapiErrorHttpStatus: vi.fn(() => 502) }));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../_lib/policy-derivatives.js', () => ({ syncPolicyDerivativesForPolicy: vi.fn() }));
vi.mock('../signin-config.js', () => ({ syncSigninDetailsToAmapi: vi.fn() }));
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission, requireEnvironmentResourcePermission } from '../_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from '../_lib/amapi.js';
import bind from '../environment-bind.ts';
import crud from '../environment-crud.ts';

const connectionString = process.env.FLASH_DELETION_TEST_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/flash_deletion_fixture') {
    throw new Error('Deletion integration tests require the named disposable localhost database');
  }
  database.pool = new pg.Pool({ connectionString });
}
afterAll(async () => { await database.pool?.end(); });

const post = (id: string, action: string) => bind(new Request('http://localhost/api/environments/bind', {
  method: 'POST', body: JSON.stringify({ environment_id: id, action }),
}), {} as never);
const remove = (id: string) => crud(new Request(`http://localhost/api/environments/${id}`, { method: 'DELETE' }), {} as never);

async function fixture() {
  const q = (sql: string, values: unknown[] = []) => database.pool!.query(sql, values);
  const ws = (await q("INSERT INTO workspaces (name, gcp_project_id) VALUES ('Deletion fixture', 'fixture-project') RETURNING id")).rows[0].id;
  const env = (await q("INSERT INTO environments (workspace_id, name, enterprise_name) VALUES ($1, 'Fixture', 'enterprises/fixture') RETURNING id", [ws])).rows[0].id;
  const policy = (await q("INSERT INTO policies (environment_id, name, amapi_name, status) VALUES ($1, 'Fixture', 'enterprises/fixture/policies/p', 'production') RETURNING id", [env])).rows[0].id;
  const device = (await q("INSERT INTO devices (environment_id, amapi_name, policy_id, last_policy_sync_name) VALUES ($1, $2, $3, 'old-sync') RETURNING id", [env, `enterprises/fixture/devices/${env}`, policy])).rows[0].id;
  await q("INSERT INTO policy_assignments (policy_id, scope_type, scope_id) VALUES ($1, 'environment', $2)", [policy, env]);
  await q("INSERT INTO policy_derivatives (policy_id, environment_id, scope_type, scope_id, payload_hash) VALUES ($1, $2, 'environment', $2, 'fixture')", [policy, env]);
  await q("INSERT INTO enrollment_tokens (environment_id, name, amapi_name, amapi_value) VALUES ($1, 'Synthetic token', 'remote-token', 'synthetic-no-access')", [env]);
  await q("INSERT INTO audit_log (workspace_id, environment_id, action) VALUES ($1, $2, 'fixture')", [ws, env]);
  return { q, ws, env, policy, device };
}

describe.skipIf(!connectionString)('deletion against disposable PostgreSQL with deployed schema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: crypto.randomUUID(), is_superadmin: false } } as never);
    vi.mocked(requireEnvironmentPermission).mockResolvedValue(undefined as never);
    vi.mocked(requireEnvironmentResourcePermission).mockResolvedValue(undefined as never);
    vi.mocked(amapiCall).mockResolvedValue({});
    vi.mocked(getAmapiErrorHttpStatus).mockReturnValue(502);
  });

  it.each(['unbind', 'delete_enterprise'])('%s preserves local intent and devices, resets remote state', async (action) => {
    const f = await fixture();
    expect((await post(f.env, action)).status).toBe(200);
    expect((await f.q('SELECT enterprise_name FROM environments WHERE id=$1', [f.env])).rows[0].enterprise_name).toBeNull();
    expect((await f.q('SELECT status, amapi_name FROM policies WHERE id=$1', [f.policy])).rows[0]).toEqual({ status: 'draft', amapi_name: null });
    expect((await f.q('SELECT policy_id, last_policy_sync_name FROM devices WHERE id=$1', [f.device])).rows[0]).toEqual({ policy_id: f.policy, last_policy_sync_name: null });
    expect((await f.q('SELECT * FROM policy_assignments WHERE policy_id=$1', [f.policy])).rowCount).toBe(1);
    expect((await f.q('SELECT * FROM policy_derivatives WHERE environment_id=$1', [f.env])).rowCount).toBe(0);
    expect((await f.q('SELECT amapi_value FROM enrollment_tokens WHERE environment_id=$1', [f.env])).rows[0].amapi_value).toBeNull();
    if (action === 'unbind') expect(amapiCall).not.toHaveBeenCalled();
    else expect(amapiCall).toHaveBeenCalledWith('enterprises/fixture', f.ws, expect.objectContaining({ method: 'DELETE' }));
  });

  it('leaves local binding intact when Google deletion fails', async () => {
    const f = await fixture();
    vi.mocked(amapiCall).mockRejectedValueOnce(new Error('Synthetic Google failure'));
    expect((await post(f.env, 'delete_enterprise')).status).toBe(502);
    expect((await f.q('SELECT enterprise_name FROM environments WHERE id=$1', [f.env])).rows[0].enterprise_name).toBe('enterprises/fixture');
  });

  it.each(['unbind', 'delete_enterprise'])('denies %s before local or remote mutations', async (action) => {
    const f = await fixture();
    vi.mocked(requireEnvironmentResourcePermission).mockRejectedValueOnce(new Response(null, { status: 403 }));
    expect((await post(f.env, action)).status).toBe(403);
    expect(amapiCall).not.toHaveBeenCalled();
    expect((await f.q('SELECT enterprise_name FROM environments WHERE id=$1', [f.env])).rows[0].enterprise_name).toBe('enterprises/fixture');
  });

  it.each(['key', 'environment_link', 'environment_assignment', 'group_link', 'group_assignment'])('blocks %s dependencies without mutating their records', async (dependency) => {
    const f = await fixture();
    const user = (await f.q("INSERT INTO users (email) VALUES ($1) RETURNING id", [`${f.env}@example.invalid`])).rows[0].id;
    if (dependency === 'key') {
      await f.q("INSERT INTO api_keys (name, scope_type, workspace_id, environment_id, token_hash, token_enc, token_prefix, created_by_user_id) VALUES ('Synthetic', 'environment', $1, $2, $4, 'synthetic-no-access', 'fixture', $3)", [f.ws, f.env, user, f.env]);
    } else {
      const group = (await f.q("INSERT INTO groups (environment_id, name) VALUES ($1, 'Fixture') RETURNING id", [f.env])).rows[0].id;
      const scopeType = dependency === 'environment_link' ? 'environment' : dependency === 'group_link' ? 'group' : 'workspace';
      const scopeId = scopeType === 'environment' ? f.env : scopeType === 'group' ? group : f.ws;
      await f.q('INSERT INTO signup_links (scope_type, scope_id, token_hash, auto_assign_environment_ids, auto_assign_group_ids) VALUES ($1, $2, $3, $4, $5)', [scopeType, scopeId, f.env, JSON.stringify(dependency === 'environment_assignment' ? [f.env] : []), JSON.stringify(dependency === 'group_assignment' ? [group] : [])]);
    }
    expect((await remove(f.env)).status).toBe(409);
    expect((await f.q('SELECT * FROM api_keys WHERE environment_id=$1', [f.env])).rowCount).toBe(dependency === 'key' ? 1 : 0);
    expect((await f.q('SELECT * FROM signup_links WHERE token_hash=$1', [f.env])).rowCount).toBe(dependency === 'key' ? 0 : 1);
    expect((await f.q('SELECT * FROM environments WHERE id=$1', [f.env])).rowCount).toBe(1);
    expect(amapiCall).not.toHaveBeenCalled();
  });

  it('deletes environment data while retaining audit history and workspace, never calls Google', async () => {
    const f = await fixture();
    expect((await remove(f.env)).status).toBe(200);
    for (const table of ['environments', 'devices', 'policies', 'enrollment_tokens']) {
      const column = table === 'environments' ? 'id' : 'environment_id';
      expect((await f.q(`SELECT * FROM ${table} WHERE ${column}=$1`, [f.env])).rowCount).toBe(0);
    }
    expect((await f.q('SELECT environment_id FROM audit_log WHERE workspace_id=$1', [f.ws])).rows).toEqual([{ environment_id: null }]);
    expect((await f.q('SELECT * FROM workspaces WHERE id=$1', [f.ws])).rowCount).toBe(1);
    expect(amapiCall).not.toHaveBeenCalled();
  });

  it('retains device-linked audit history while detaching deleted entity references', async () => {
    const f = await fixture();
    await f.q('UPDATE audit_log SET device_id=$1 WHERE environment_id=$2', [f.device, f.env]);
    expect((await remove(f.env)).status).toBe(200);
    expect((await f.q('SELECT environment_id, device_id FROM audit_log WHERE workspace_id=$1', [f.ws])).rows).toEqual([{ environment_id: null, device_id: null }]);
    expect((await f.q('SELECT * FROM environments WHERE id=$1', [f.env])).rowCount).toBe(0);
  });

  it('denies environment deletion before any cleanup', async () => {
    const f = await fixture();
    vi.mocked(requireEnvironmentPermission).mockRejectedValueOnce(new Response(null, { status: 403 }));
    expect((await remove(f.env)).status).toBe(403);
    expect((await f.q('SELECT * FROM environments WHERE id=$1', [f.env])).rowCount).toBe(1);
    expect(amapiCall).not.toHaveBeenCalled();
  });

  it('reports remote success with failed local cleanup, then recovers on Google 404', async () => {
    const f = await fixture();
    await f.q(`CREATE FUNCTION fixture_reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cleanup failure'; END $$`);
    await f.q('CREATE TRIGGER fixture_reject_cleanup BEFORE UPDATE ON environments FOR EACH ROW EXECUTE FUNCTION fixture_reject_cleanup()');
    try {
      const failed = await post(f.env, 'delete_enterprise');
      expect(failed.status).toBe(502);
      expect((await failed.json()).error).toContain('Retry Unbind');
      expect(amapiCall).toHaveBeenCalledOnce();
      expect((await f.q('SELECT enterprise_name FROM environments WHERE id=$1', [f.env])).rows[0].enterprise_name).toBe('enterprises/fixture');
    } finally {
      await f.q('DROP TRIGGER fixture_reject_cleanup ON environments');
      await f.q('DROP FUNCTION fixture_reject_cleanup()');
    }
    vi.mocked(amapiCall).mockRejectedValueOnce(new Error('AMAPI error (404): already deleted'));
    vi.mocked(getAmapiErrorHttpStatus).mockReturnValueOnce(404);
    expect((await post(f.env, 'delete_enterprise')).status).toBe(200);
    expect((await f.q('SELECT enterprise_name FROM environments WHERE id=$1', [f.env])).rows[0].enterprise_name).toBeNull();
    vi.mocked(amapiCall).mockClear();
    expect((await post(f.env, 'delete_enterprise')).status).toBe(200);
    expect(amapiCall).not.toHaveBeenCalled();
  });

  it('recovers from missing legacy relation through savepoints', async () => {
    const f = await fixture();
    await f.q('ALTER TABLE pubsub_events RENAME TO fixture_hidden_pubsub_events');
    try {
      expect((await remove(f.env)).status).toBe(200);
      expect((await f.q('SELECT environment_id FROM audit_log WHERE workspace_id=$1', [f.ws])).rows[0].environment_id).toBeNull();
      expect((await f.q('SELECT * FROM environments WHERE id=$1', [f.env])).rowCount).toBe(0);
    } finally {
      await f.q('ALTER TABLE fixture_hidden_pubsub_events RENAME TO pubsub_events');
    }
  });

  it('rolls back all local cleanup on a later environment-delete failure', async () => {
    const f = await fixture();
    await f.q(`CREATE FUNCTION fixture_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic delete failure'; END $$`);
    await f.q('CREATE TRIGGER fixture_reject_delete BEFORE DELETE ON environments FOR EACH ROW EXECUTE FUNCTION fixture_reject_delete()');
    try {
      expect((await remove(f.env)).status).toBe(500);
      expect((await f.q('SELECT environment_id FROM audit_log WHERE workspace_id=$1', [f.ws])).rows[0].environment_id).toBe(f.env);
      expect((await f.q('SELECT * FROM devices WHERE id=$1', [f.device])).rowCount).toBe(1);
    } finally {
      await f.q('DROP TRIGGER fixture_reject_delete ON environments');
      await f.q('DROP FUNCTION fixture_reject_delete()');
    }
  });
});
