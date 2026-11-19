// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate';
import { closeDatabasePool } from '../_lib/db';
import { logAudit } from '../_lib/audit';
import handler from '../workflow-evaluate-background';
import worker from '../sync-process-background';

const url = process.env.WORKFLOW_AUDIT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('primary custom workflow audit with real PostgreSQL', () => {
  let pool: pg.Pool; let workspace: string; let environment: string; let device: string; let workflow: string;
  const request = () => new Request('http://localhost/internal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'synthetic-audit-internal' }, body: JSON.stringify({ workflow_id: workflow, device_id: device, trigger_data: {} }) });
  const execute = () => handler(request(), {} as never);
  const executions = async () => (await pool.query('SELECT id,status,result FROM workflow_executions ORDER BY created_at,id')).rows;
  const failPrimary = async (body: string) => pool.query(`CREATE FUNCTION audit_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type='workflow' AND NEW.action NOT LIKE 'workflow.execution.%' THEN ${body} END IF; RETURN NEW; END $$; CREATE TRIGGER audit_fixture_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_fixture_failure()`);
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/flash_workflow_audit_fixture') throw Error('Refusing non-disposable audit fixture');
    process.env.DATABASE_URL = url!; process.env.NODE_ENV = 'development'; process.env.INTERNAL_FUNCTION_SECRET = 'synthetic-audit-internal';
    pool = new pg.Pool({ connectionString: url });
  });
  beforeEach(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    for (const migration of MIGRATIONS) await pool.query(migration.sql);
    workspace = (await pool.query("INSERT INTO workspaces(name) VALUES('Audit fixture') RETURNING id")).rows[0].id;
    environment = (await pool.query("INSERT INTO environments(workspace_id,name) VALUES($1,'Audit fixture') RETURNING id", [workspace])).rows[0].id;
    device = (await pool.query("INSERT INTO devices(environment_id,amapi_name,state) VALUES($1,'enterprises/synthetic/devices/audit','ACTIVE') RETURNING id", [environment])).rows[0].id;
    workflow = (await pool.query("INSERT INTO workflows(environment_id,name,trigger_type,action_type,action_config,enabled) VALUES($1,'Audit fixture','scheduled','audit.log',$2,true) RETURNING id", [environment, JSON.stringify({ action: 'auth.login', details: { custom_workflow_action: false, execution_id: 'forged', workflow_id: 'forged', useful: 'retained', password: 'synthetic-redact' } })])).rows[0].id;
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterAll(async () => { await closeDatabasePool(); await pool?.end(); });

  it('has working primary and secondary effects before any injected database fault', async () => {
    await execute();
    expect((await executions())[0].status).toBe('success');
    expect((await pool.query('SELECT 1 FROM audit_log')).rowCount).toBe(2);
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='workflow.execution.executed'")).rowCount).toBe(1);
  });
  it('persists a distinct primary event with authoritative provenance and sanitized details', async () => {
    expect((await execute())?.status).toBe(200);
    const [execution] = await executions(); expect(execution.status).toBe('success');
    const rows = (await pool.query('SELECT action,workspace_id,environment_id,actor_type,visibility_scope,details FROM audit_log ORDER BY created_at')).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: 'workflow.custom_audit', workspace_id: workspace, environment_id: environment, actor_type: 'system', visibility_scope: 'privileged', details: { custom_workflow_action: true, execution_id: execution.id, workflow_id: workflow, requested_action: 'auth.login', useful: 'retained', password: '[REDACTED]' } });
    expect(rows[1].action).toBe('workflow.execution.executed');
    expect(execution.result).toEqual({ success: true, audit_logged: true, action: 'workflow.custom_audit' });
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='auth.login'")).rowCount).toBe(0);
  });
  it.each([
    ['x' + '😀'.repeat(60), 'x' + '😀'.repeat(60)],
    ['x' + '😀'.repeat(120), 'x' + '😀'.repeat(119)],
  ])('preserves Unicode labels and bounds them without creating isolated surrogates', async (label, expected) => {
    await pool.query('UPDATE workflows SET action_config=$1 WHERE id=$2', [JSON.stringify({ action: label }), workflow]);
    await execute();
    expect((await executions())[0].status).toBe('success');
    const row = (await pool.query("SELECT details->>'requested_action' AS label FROM audit_log WHERE action='workflow.custom_audit'")).rows[0];
    expect(row.label).toBe(expected);
  });
  it('rolls primary effect back when its authoritative execution result cannot persist', async () => {
    await pool.query("CREATE FUNCTION audit_fixture_outcome_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='success' THEN RAISE EXCEPTION 'synthetic outcome failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER audit_fixture_outcome_failure BEFORE UPDATE ON workflow_executions FOR EACH ROW EXECUTE FUNCTION audit_fixture_outcome_failure()");
    await execute();
    expect((await executions())[0].status).toBe('failed');
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='workflow.custom_audit'")).rowCount).toBe(0);
    expect((await pool.query('SELECT action FROM audit_log')).rows).toEqual([{ action: 'workflow.execution.failed' }]);
  });
  it('retains committed primary success and exposes metadata-only failure without a contradictory audit', async () => {
    await pool.query("CREATE FUNCTION audit_fixture_metadata_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic metadata failure'; END $$; CREATE TRIGGER audit_fixture_metadata_failure BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION audit_fixture_metadata_failure()");
    const response = await execute();
    expect(await response?.json()).toMatchObject({ status: 'success', errors: 1, metadata_update_failed: true });
    expect((await executions())[0].status).toBe('success');
    expect((await pool.query('SELECT action FROM audit_log ORDER BY created_at')).rows).toEqual([{ action: 'workflow.custom_audit' }, { action: 'workflow.execution.executed' }]);
    expect((await pool.query('SELECT last_triggered_at FROM workflows')).rows[0].last_triggered_at).toBeNull();
  });
  it('keeps a persisted primary outcome successful when only its secondary engine audit fails', async () => {
    await pool.query("CREATE FUNCTION audit_fixture_secondary_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'workflow.execution.%' THEN RAISE EXCEPTION 'synthetic secondary failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER audit_fixture_secondary_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_fixture_secondary_failure()");
    await execute();
    expect((await executions())[0].status).toBe('success');
    expect((await pool.query('SELECT action FROM audit_log')).rows).toEqual([{ action: 'workflow.custom_audit' }]);
  });
  it('recovers a real committed success when only the COMMIT acknowledgement is lost', async () => {
    const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
    const original = prototype.query;
    let injected = false;
    vi.spyOn(prototype, 'query').mockImplementation(function(this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (!injected && String(args[0]).trim() === 'COMMIT') {
        injected = true;
        return Promise.resolve(result).then(() => { throw Object.assign(new Error('synthetic lost COMMIT acknowledgement'), { code: '08006' }); });
      }
      return result;
    });
    const response = await execute();
    expect(injected).toBe(true);
    expect(await response?.json()).toMatchObject({ status: 'success', errors: 1, outcome_recovered: true });
    expect((await executions())[0].status).toBe('success');
    expect((await pool.query('SELECT action FROM audit_log ORDER BY created_at')).rows).toEqual([{ action: 'workflow.custom_audit' }, { action: 'workflow.execution.executed' }]);
  });
  it('suppresses automatic queue replay when the committed primary outcome cannot be read', async () => {
    const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
    const original = prototype.query;
    let commitLost = false;
    vi.spyOn(prototype, 'query').mockImplementation(function(this: unknown, ...args: unknown[]) {
      const text = String(args[0]);
      if (commitLost && (text.includes("AND status = 'running'") || text.includes('SELECT status, result FROM workflow_executions'))) {
        const failure = Object.assign(new Error('synthetic outcome read unavailable'), { code: '08006' });
        const callback = args.at(-1);
        if (typeof callback === 'function') { callback(failure); return; }
        return Promise.reject(failure);
      }
      const result = original.apply(this, args);
      if (!commitLost && text.trim() === 'COMMIT' && !(this as { auditPrimary?: boolean }).auditPrimary) {
        // The worker claim also commits. Inject on the primary transaction only,
        // identified below by a prior audit INSERT on this actual client.
        return result;
      }
      if (!commitLost && text.trim() === 'COMMIT' && (this as { auditPrimary?: boolean }).auditPrimary) {
        commitLost = true;
        return Promise.resolve(result).then(() => { throw Object.assign(new Error('synthetic lost acknowledgement'), { code: '08006' }); });
      }
      if (text.includes('INSERT INTO audit_log')) (this as { auditPrimary?: boolean }).auditPrimary = true;
      return result;
    });
    // Route the worker through the actual evaluator; no external endpoint exists.
    vi.stubGlobal('fetch', vi.fn(async (input, init) => handler(new Request(String(input), init), {} as never)));
    await pool.query("INSERT INTO job_queue(environment_id,job_type,payload,status) VALUES($1,'workflow_evaluate',$2,'pending')", [environment, JSON.stringify({ workflow_id: workflow, device_id: device })]);
    await worker(request(), {} as never);
    expect(commitLost).toBe(true);
    const job = (await pool.query('SELECT status,error FROM job_queue')).rows[0];
    expect(job.status).toBe('delivery_uncertain');
    expect(job.error).toContain('unverified audit commit');
    expect(job.error).not.toContain('AMAPI');
    expect((await executions())[0].status).toBe('success');
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='workflow.custom_audit'")).rowCount).toBe(1);
  });
  it('preserves secondary system privilege with only the key column absent', async () => {
    await pool.query('ALTER TABLE audit_log DROP COLUMN api_key_id');
    await logAudit({ action: 'fixture.secondary', actor_type: 'system', visibility_scope: 'privileged', environment_id: environment });
    expect((await pool.query('SELECT actor_type,visibility_scope FROM audit_log')).rows).toEqual([{ actor_type: 'system', visibility_scope: 'privileged' }]);
  });
  it.each(['actor_type', 'visibility_scope'])('skips secondary writes rather than weakening missing %s', async column => {
    await pool.query('ALTER TABLE audit_log DROP COLUMN ' + column);
    await expect(logAudit({ action: 'fixture.secondary', actor_type: 'system', visibility_scope: 'privileged', environment_id: environment })).resolves.toBeUndefined();
    expect((await pool.query('SELECT 1 FROM audit_log')).rowCount).toBe(0);
  });
  it('never converts an independent key principal into a human in legacy fallback', async () => {
    await pool.query('ALTER TABLE audit_log DROP COLUMN api_key_id');
    await expect(logAudit({ action: 'fixture.secondary', actor_type: 'api_key', api_key_id: '11111111-1111-4111-8111-111111111111', environment_id: environment })).resolves.toBeUndefined();
    expect((await pool.query('SELECT 1 FROM audit_log')).rowCount).toBe(0);
  });
  it('records failure when the primary audit write fails, preserving secondary best-effort evidence', async () => {
    await failPrimary("RAISE EXCEPTION 'synthetic primary failure';");
    await execute();
    expect((await executions())[0].status).toBe('failed');
    expect((await pool.query('SELECT action FROM audit_log')).rows).toEqual([{ action: 'workflow.execution.failed' }]);
  });
  it('rejects zero-row primary writes rather than reporting a missing record as success', async () => {
    await failPrimary('RETURN NULL;');
    await execute();
    expect((await executions())[0]).toMatchObject({ status: 'failed', result: { error: 'Requested audit record was not inserted' } });
    expect((await pool.query('SELECT action FROM audit_log')).rows).toEqual([{ action: 'workflow.execution.failed' }]);
  });
  it('keeps the primary system and privileged semantics when only the legacy key column is absent', async () => {
    await pool.query('ALTER TABLE audit_log DROP COLUMN api_key_id');
    await execute();
    expect((await executions())[0].status).toBe('success');
    const primary = (await pool.query("SELECT actor_type,visibility_scope,details FROM audit_log WHERE action='workflow.custom_audit'")).rows[0];
    expect(primary).toMatchObject({ actor_type: 'system', visibility_scope: 'privileged', details: { custom_workflow_action: true } });
  });
  it.each(['actor_type', 'visibility_scope'])('fails closed when legacy schema cannot express %s', async column => {
    await pool.query('ALTER TABLE audit_log DROP COLUMN ' + column);
    await execute();
    expect((await executions())[0].status).toBe('failed');
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='workflow.custom_audit'")).rowCount).toBe(0);
  });
  it('does not recursively claim success when both primary and secondary writes fail', async () => {
    await pool.query("CREATE FUNCTION audit_fixture_all_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic all audit failure'; END $$; CREATE TRIGGER audit_fixture_all_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_fixture_all_failure()");
    await execute();
    expect((await executions())[0].status).toBe('failed');
    expect((await pool.query('SELECT 1 FROM audit_log')).rowCount).toBe(0);
    expect(vi.mocked(console.error).mock.calls.length).toBeLessThanOrEqual(2);
  });
  it('exposes transient primary failure through the actual worker dispatch contract and a later explicit attempt succeeds', async () => {
    await pool.query('CREATE SEQUENCE audit_fixture_attempts');
    await failPrimary("IF nextval('audit_fixture_attempts')=1 THEN RAISE EXCEPTION 'synthetic transient audit failure' USING ERRCODE='40001'; END IF;");
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (!String(input).endsWith('/workflow-evaluate-background')) throw Error('Unexpected external request in audit fixture');
      return handler(new Request(String(input), init), {} as never);
    }));
    const enqueue = () => pool.query("INSERT INTO job_queue(environment_id,job_type,payload,status) VALUES($1,'workflow_evaluate',$2,'pending')", [environment, JSON.stringify({ workflow_id: workflow, device_id: device })]);
    await enqueue(); await worker(request(), {} as never);
    expect((await executions()).map(x => x.status)).toEqual(['failed']);
    // Queue completion means dispatch finished under the existing contract (#275),
    // while the requested effect is truthfully failed in workflow_executions.
    expect((await pool.query('SELECT status FROM job_queue')).rows).toEqual([{ status: 'completed' }]);
    await enqueue(); await worker(request(), {} as never);
    expect((await executions()).map(x => x.status)).toEqual(['failed', 'success']);
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='workflow.custom_audit'")).rowCount).toBe(1);
  });
});
