// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate.js';
import { closeDatabasePool } from '../_lib/db.js';
import handler from '../workflow-cron-scheduled.js';
import workflowHandler from '../workflow-crud.js';
import { hashToken } from '../_lib/crypto.js';

const url = process.env.WORKFLOW_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('scheduled workflow eligibility with PostgreSQL', () => {
  let pool: pg.Pool;
  const workspace = '11111111-1111-4111-8111-111111111111';
  const environment = '22222222-2222-4222-8222-222222222222';
  const device = '33333333-3333-4333-8333-333333333333';
  const workflow = '44444444-4444-4444-8444-444444444444';
  const owner = '55555555-5555-4555-8555-555555555555';
  const token = 'synthetic-workflow-fixture-session';
  const invoke = () => handler(new Request('http://localhost/.netlify/functions/workflow-cron-scheduled'), {} as never);
  const change = (path: string, body: object) => workflowHandler(new Request('http://localhost/api/workflows/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Cookie: `flash_session=${token}` },
    body: JSON.stringify(body),
  }), {} as never);
  const jobs = async () => (await pool.query('SELECT payload FROM job_queue ORDER BY created_at')).rows;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/flash_workflow_fixture') {
      throw new Error('Refusing a non-disposable workflow database');
    }
    process.env.DATABASE_URL = url;
    process.env.NODE_ENV = 'development';
    process.env.FLASH_RUNTIME = 'vps';
    process.env.URL = 'http://localhost';
    pool = new pg.Pool({ connectionString: url });
    for (const migration of MIGRATIONS) await pool.query(migration.sql);
  }, 30000);

  afterAll(async () => { await closeDatabasePool(); await pool?.end(); });

  beforeEach(async () => {
    await pool.query('TRUNCATE workspaces, users CASCADE');
    await pool.query("INSERT INTO workspaces(id,name) VALUES($1,'Workflow fixture')", [workspace]);
    await pool.query("INSERT INTO users(id,email) VALUES($1,'owner@workflow-fixture.invalid')", [owner]);
    await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'owner','workspace')", [workspace, owner]);
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '14 days')", [owner, hashToken(token)]);
    await pool.query("INSERT INTO environments(id,workspace_id,name) VALUES($1,$2,'Fixture')", [environment, workspace]);
    await pool.query("INSERT INTO devices(id,environment_id,amapi_name) VALUES($1,$2,'fixture/devices/device')", [device, environment]);
    await pool.query(`INSERT INTO workflows(id,environment_id,name,trigger_type,trigger_config,action_type,scope_type)
      VALUES($1,$2,'Fixture','scheduled','{"interval_minutes":60}','audit.log','environment')`, [workflow, environment]);
  });

  it.each([null, [], false, '15', { interval_minutes: null }, { interval_minutes: '15' }, { interval_minutes: 0 }, { interval_minutes: -1 }, { interval_minutes: 15.5 }, { interval_minutes: 1441 }])(
    'rejects an invalid persisted configuration %j without changing the schedule', async config => {
      await pool.query('UPDATE workflows SET trigger_config=$1::jsonb WHERE id=$2', [JSON.stringify(config), workflow]);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await invoke();
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ stats: { enqueued: 0, errors: 1 } });
        expect(await jobs()).toHaveLength(0);
        const row = (await pool.query('SELECT trigger_config,enabled,last_triggered_at FROM workflows WHERE id=$1', [workflow])).rows[0];
        expect(row).toEqual({ trigger_config: config, enabled: true, last_triggered_at: null });
      }
    },
  );

  it.each([15, 30, 60, 360, 720, 1440])('honours the %i minute preset and suppresses an immediate retry', async interval => {
    await pool.query("UPDATE workflows SET trigger_config=$1::jsonb,last_triggered_at=now()-($2::int+1)*interval '1 minute' WHERE id=$3", [JSON.stringify({ interval_minutes: interval }), interval, workflow]);
    expect((await invoke()).status).toBe(200);
    expect((await invoke()).status).toBe(200);
    expect(await jobs()).toEqual([{ payload: expect.objectContaining({ workflow_id: workflow, device_id: device, trigger_data: expect.objectContaining({ interval_minutes: interval }) }) }]);
  });

  it('keeps the documented default and serialises simultaneous invocations', async () => {
    await pool.query("UPDATE workflows SET trigger_config='{}' WHERE id=$1", [workflow]);
    const responses = await Promise.all([invoke(), invoke()]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(await jobs()).toHaveLength(1);
    expect((await jobs())[0].payload.trigger_data.interval_minutes).toBe(60);
  });

  it('rejects a persisted fraction that node-postgres rounds to a valid preset', async () => {
    await pool.query(`UPDATE workflows SET trigger_config='{"interval_minutes":15.0000000000000001}'::jsonb WHERE id=$1`, [workflow]);
    const row = (await pool.query("SELECT trigger_config,trigger_config->'interval_minutes'='15'::jsonb AS exact FROM workflows WHERE id=$1", [workflow])).rows[0];
    expect(row.trigger_config.interval_minutes).toBe(15);
    expect(row.exact).toBe(false);
    const response = await invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ stats: { enqueued: 0, errors: 1 } });
    expect(await jobs()).toHaveLength(0);
    expect((await pool.query('SELECT last_triggered_at FROM workflows WHERE id=$1', [workflow])).rows[0].last_triggered_at).toBeNull();
  });

  it('rejects a persisted fraction through actual single and bulk enable controls', async () => {
    await pool.query(`UPDATE workflows SET enabled=false,trigger_config='{"interval_minutes":15.0000000000000001}'::jsonb WHERE id=$1`, [workflow]);
    expect((await change(workflow + '/toggle', {})).status).toBe(400);
    const valid = crypto.randomUUID();
    await pool.query(`INSERT INTO workflows(id,environment_id,name,enabled,trigger_type,trigger_config,action_type,scope_type)
      VALUES($1,$2,'Valid decimal fixture',false,'scheduled','{"interval_minutes":15.0000000000000000}','audit.log','environment')`, [valid, environment]);
    const response = await change('bulk', { environment_id: environment, operation: 'enable', selection: { ids: [workflow, valid] } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ succeeded: 1, failed: 1, results: [{ id: workflow, ok: false }, { id: valid, ok: true }] });
    const rows = (await pool.query('SELECT id,enabled FROM workflows ORDER BY id')).rows;
    expect(rows.find(row => row.id === workflow).enabled).toBe(false);
    expect(rows.find(row => row.id === valid).enabled).toBe(true);
    expect(await jobs()).toHaveLength(0);
  });

  it('continues valid workflows after rejecting another configuration', async () => {
    await pool.query("UPDATE workflows SET trigger_config='null'::jsonb WHERE id=$1", [workflow]);
    const valid = crypto.randomUUID();
    await pool.query(`INSERT INTO workflows(id,environment_id,name,trigger_type,trigger_config,action_type,scope_type)
      VALUES($1,$2,'Valid fixture','scheduled','{"interval_minutes":15}','audit.log','environment')`, [valid, environment]);
    const response = await invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ stats: { enqueued: 1, errors: 1 } });
    expect(await jobs()).toEqual([{ payload: expect.objectContaining({ workflow_id: valid }) }]);
    expect((await pool.query('SELECT last_triggered_at FROM workflows WHERE id=$1', [workflow])).rows[0].last_triggered_at).toBeNull();
  });

  it('rolls enqueue and interval advancement back after a database failure, then permits retry', async () => {
    await pool.query(`CREATE FUNCTION workflow_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic enqueue failure'; END $$;
      CREATE TRIGGER workflow_fixture_failure BEFORE INSERT ON job_queue FOR EACH ROW EXECUTE FUNCTION workflow_fixture_failure()`);
    try {
      expect((await invoke()).status).toBe(500);
      expect(await jobs()).toHaveLength(0);
      expect((await pool.query('SELECT last_triggered_at FROM workflows WHERE id=$1', [workflow])).rows[0].last_triggered_at).toBeNull();
    } finally {
      await pool.query('DROP TRIGGER workflow_fixture_failure ON job_queue; DROP FUNCTION workflow_fixture_failure()');
    }
    expect((await invoke()).status).toBe(200);
    expect(await jobs()).toHaveLength(1);
  });
});
