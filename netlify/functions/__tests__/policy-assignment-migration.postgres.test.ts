// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { MIGRATIONS } from '../migrate.js';
import { resolvePolicyAssignmentMinimum } from '../_lib/rbac-matrix.js';

const fixtureUrl = process.env.POLICY_ASSIGNMENT_TEST_DATABASE_URL;
const suite = fixtureUrl ? describe : describe.skip;
suite('policy assignment migration with PostgreSQL', () => {
  let client: pg.Client;
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/flash_policy_assignment_fixture') {
      throw new Error('Refusing non-disposable assignment migration fixture');
    }
    client = new pg.Client({ connectionString: fixtureUrl });
    await client.connect();
    await client.query('CREATE TEMP TABLE workspaces(id text PRIMARY KEY, settings jsonb); CREATE TEMP TABLE environments(id text PRIMARY KEY, workspace_id text, enterprise_features jsonb)');
  });
  afterAll(async () => { await client?.end(); });

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
      await client.query('INSERT INTO workspaces VALUES($1,$2)', [input.id, { keep: 'workspace', rbac: { permission_matrix: input.workspace } }]);
      await client.query('INSERT INTO environments VALUES($1,$1,$2)', [input.id, input.environment === undefined ? { keep: 'environment' } : { keep: 'environment', rbac: { permission_matrix: input.environment } }]);
    }
    await client.query('INSERT INTO workspaces VALUES(\'no-override\',\'{"keep":true}\')');
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
});
