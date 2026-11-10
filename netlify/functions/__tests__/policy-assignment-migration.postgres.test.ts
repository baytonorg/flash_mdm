// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { MIGRATIONS } from '../migrate.js';
import { resolvePolicyAssignmentMinimum } from '../_lib/rbac-matrix.js';
import { environmentFeaturesPreservingRbac, ENVIRONMENT_RBAC_SAVE_SQL } from '../_lib/environment-features.js';

const fixtureUrl = process.env.POLICY_ASSIGNMENT_TEST_DATABASE_URL;
const suite = fixtureUrl ? describe : describe.skip;
suite('policy assignment migration with PostgreSQL', () => {
  let client: pg.Client;
  const schema = `assignment_matrix_${crypto.randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/flash_policy_assignment_fixture') {
      throw new Error('Refusing non-disposable assignment migration fixture');
    }
    client = new pg.Client({ connectionString: fixtureUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await client.query('CREATE TABLE workspaces(id text PRIMARY KEY, settings jsonb, updated_at timestamptz); CREATE TABLE environments(id text PRIMARY KEY, workspace_id text, enterprise_features jsonb, updated_at timestamptz)');
  });
  afterAll(async () => { if (client) { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } });

  it('matches the versioned SQL and backfills conservatively without altering explicit settings', async () => {
    const sql = MIGRATIONS.find(migration => migration.name === '060_policy_assignment_permission')!.sql;
    expect(sql.trim()).toBe(readFileSync('netlify/migrations/060_policy_assignment_permission.sql', 'utf8').trim());
    const inputs = [
      { id: 'plain', workspace: {}, environment: undefined },
      { id: 'legacy', workspace: { group: { write: 'owner' } }, environment: { policy: { write: 'member' } } },
      { id: 'explicit-workspace', workspace: { policy: { assign: 'admin' }, group: { write: 'owner' } }, environment: { policy: { write: 'member' } } },
      { id: 'explicit-environment', workspace: { policy: { assign: 'owner' } }, environment: { policy: { assign: 'admin' } } },
      { id: 'legacy-env-owner', workspace: { policy: { write: 'member' } }, environment: { policy: { write: 'owner' } } },
    ];
    for (const input of inputs) {
      await client.query('INSERT INTO workspaces(id,settings) VALUES($1,$2)', [input.id, { keep: 'workspace', rbac: { permission_matrix: input.workspace } }]);
      await client.query('INSERT INTO environments(id,workspace_id,enterprise_features) VALUES($1,$1,$2)', [input.id, input.environment === undefined ? { keep: 'environment' } : { keep: 'environment', rbac: { permission_matrix: input.environment } }]);
    }
    await client.query('INSERT INTO workspaces(id,settings) VALUES(\'no-override\',\'{"keep":true}\')');
    await client.query(sql);
    for (const input of inputs) {
      const workspace = (await client.query('SELECT settings FROM workspaces WHERE id=$1', [input.id])).rows[0].settings;
      const features = (await client.query('SELECT enterprise_features FROM environments WHERE id=$1', [input.id])).rows[0].enterprise_features;
      expect(workspace.keep).toBe('workspace');
      expect(features.keep).toBe('environment');
      expect(workspace.rbac.permission_matrix.policy.assign).toBe(resolvePolicyAssignmentMinimum(input.workspace));
      if (input.environment === undefined) expect(features.rbac).toBeUndefined();
      else expect(features.rbac.permission_matrix.policy.assign).toBe(resolvePolicyAssignmentMinimum(input.workspace, input.environment));
    }
    expect((await client.query('SELECT settings FROM workspaces WHERE id=\'no-override\'')).rows[0].settings).toEqual({ keep: true });
    const before = (await client.query('SELECT * FROM workspaces ORDER BY id')).rows;
    await client.query(sql);
    expect((await client.query('SELECT * FROM workspaces ORDER BY id')).rows).toEqual(before);
  });

  it('preserves the latest Owner RBAC through an old or forged generic feature save after waiting for its row lock', async () => {
    await client.query(`INSERT INTO environments(id,workspace_id,enterprise_features) VALUES('race','plain','{"rbac":{"permission_matrix":{"policy":{"assign":"admin"}}}}')`);
    const other = new pg.Client({ connectionString: fixtureUrl });
    await other.connect();
    try {
      await other.query(`SET search_path TO ${schema}`);
      await client.query('BEGIN');
      await client.query(ENVIRONMENT_RBAC_SAVE_SQL, [{ permission_matrix: { policy: { assign: 'owner' } } }, 'race']);
      const waiting = other.query(`UPDATE environments SET enterprise_features = ${environmentFeaturesPreservingRbac(1)} WHERE id=$2`, [{ feature: true, rbac: { permission_matrix: { policy: { assign: 'admin' } } } }, 'race']);
      // A backend pid lock wait proves the update is actually overlapping.
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline) {
        const activity = await client.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [(other as unknown as { processID: number }).processID]);
        if (activity.rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query('COMMIT');
      await waiting;
      const result = (await client.query("SELECT enterprise_features FROM environments WHERE id='race'")).rows[0].enterprise_features;
      expect(result).toEqual({ feature: true, rbac: { permission_matrix: { policy: { assign: 'owner' } } } });
      await other.query(`UPDATE environments SET enterprise_features = ${environmentFeaturesPreservingRbac(1)} WHERE id=$2`, [{ feature: true }, 'race']);
      expect((await client.query("SELECT enterprise_features FROM environments WHERE id='race'")).rows[0].enterprise_features.rbac.permission_matrix.policy.assign).toBe('owner');
      await other.query(ENVIRONMENT_RBAC_SAVE_SQL, [{ permission_matrix: { policy: { assign: 'admin' } } }, 'race']);
      expect((await client.query("SELECT enterprise_features FROM environments WHERE id='race'")).rows[0].enterprise_features.feature).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      await other.end();
    }
  });
});
