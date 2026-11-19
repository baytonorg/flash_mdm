// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate';
import { closeDatabasePool } from '../_lib/db';
import { hashToken } from '../_lib/crypto';
import { getEnvironmentLicensingSnapshot, getWorkspacePlatformEntitledSeats, getWorkspaceAvailableGiftSeats } from '../_lib/licensing';
import handler from '../superadmin-billing';
import requestInvoiceHandler from '../license-grants';

const url = process.env.INVOICE_PAID_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('net invoice grants with actual PostgreSQL and superadmin authentication', () => {
  let pool: pg.Pool; let workspace: string; let environment: string; let actor: string; let plan: string;
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Cookie: 'flash_session=synthetic-billing-session' };
  const paid = (id: string) => handler(new Request('http://localhost/api/superadmin/billing/invoices/' + id + '/mark-paid', { method: 'POST', headers }), {} as never);
  const gift = (seats: number) => handler(new Request('http://localhost/api/superadmin/billing/grants/manual', { method: 'POST', headers, body: JSON.stringify({ workspace_id: workspace, seat_count: seats, grant_type: 'gift' }) }), {} as never);
  async function invoice(requested = 10, offset = 3, intervals = 1, legacy = false, metadataOverride?: object, subtotalOverride?: number) {
    if (offset) await pool.query("INSERT INTO license_grants(workspace_id,source,seat_count) VALUES($1,'gift',$2)", [workspace, offset]);
    const metadata = metadataOverride ?? { ...(legacy ? {} : {seat_item_format: 'requested-net-v1'}), seat_count: requested, billable_seat_count: requested-offset, gift_offset_seats: offset, billing_intervals: intervals, duration_months: intervals };
    const id = (await pool.query("INSERT INTO billing_invoices(workspace_id,invoice_type,subtotal_cents,status,source) VALUES($1,'workspace_to_superadmin',$2,'pending','workspace_request') RETURNING id", [workspace, subtotalOverride ?? (requested-offset)*intervals*100])).rows[0].id;
    await pool.query("INSERT INTO billing_invoice_items(invoice_id,description,quantity,unit_amount_cents,metadata) VALUES($1,'Synthetic seats',$2,100,$3)", [id, (legacy?requested:requested-offset)*intervals, JSON.stringify(metadata)]);
    return id as string;
  }
  const grants = async () => (await pool.query("SELECT seat_count,metadata FROM license_grants WHERE source='invoice' ORDER BY created_at")).rows;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/flash_invoice_paid_fixture') throw Error('Refusing non-disposable invoice fixture');
    process.env.DATABASE_URL = url + '?application_name=flash_invoice_paid_fixture'; process.env.NODE_ENV = 'development'; process.env.URL = 'http://localhost';
    pool = new pg.Pool({ connectionString: url });
    for (const migration of MIGRATIONS) await pool.query(migration.sql);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE workspaces,users CASCADE');
    await pool.query('INSERT INTO platform_settings(id,licensing_enabled,default_free_enabled,default_free_seat_limit) VALUES(1,true,false,0) ON CONFLICT(id) DO UPDATE SET licensing_enabled=true,default_free_enabled=false,default_free_seat_limit=0');
    actor = (await pool.query("INSERT INTO users(email,is_superadmin) VALUES('operator@invoice-fixture.invalid',true) RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '14 days')", [actor,hashToken('synthetic-billing-session')]);
    workspace = (await pool.query("INSERT INTO workspaces(name) VALUES('Invoice fixture') RETURNING id")).rows[0].id;
    environment = (await pool.query("INSERT INTO environments(workspace_id,name) VALUES($1,'Invoice fixture') RETURNING id", [workspace])).rows[0].id;
    plan=(await pool.query(`INSERT INTO license_plans(name,max_devices,features) VALUES('Invoice fixture',100,'{"invoice_unit_amount_cents":100}') RETURNING id`)).rows[0].id;
    vi.spyOn(console,'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await closeDatabasePool(); await pool?.end(); });

  it.each([[10,0,1,false],[10,3,1,false],[10,10,1,false],[10,3,3,false],[10,3,1,true],[10,10,1,true]])('grants only billable seats for requested %s gift %s intervals %s legacy %s', async (requested,offset,intervals,legacy) => {
    const id = await invoice(requested as number,offset as number,intervals as number,legacy as boolean);
    const before = await getEnvironmentLicensingSnapshot(environment);
    expect((await paid(id)).status).toBe(200);
    expect((await grants()).map(x=>x.seat_count)).toEqual(offset===requested?[]:[Number(requested)-Number(offset)]);
    expect(await getWorkspacePlatformEntitledSeats(workspace)).toBe(requested);
    expect(await getEnvironmentLicensingSnapshot(environment)).toEqual(before);
    expect((await pool.query('SELECT 1 FROM job_queue')).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM environment_entitlements')).rowCount).toBe(0);
    expect((await paid(id)).status).toBe(200);
    expect((await grants()).length).toBe(offset===requested?0:1);
  });
  it('keeps a plain legacy item without seat metadata compatible', async () => {
    const id = await invoice(10,0,1,false,{});
    expect((await paid(id)).status).toBe(200); expect((await grants())[0].seat_count).toBe(10);
  });
  it('serialises five competing mark-paid requests without a second pooled read under the invoice lock', async () => {
    const id = await invoice(); const lock = await pool.connect(); await lock.query('BEGIN'); await lock.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE',[id]);
    const pending = Array.from({length:5},()=>paid(id));
    try {
      let blocked=0; const deadline=Date.now()+4000;
      while(Date.now()<deadline){blocked=Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='flash_invoice_paid_fixture' AND wait_event_type='Lock'")).rows[0].count);if(blocked===5)break;await new Promise(r=>setTimeout(r,10));}
      expect(blocked).toBe(5);
    } finally {await lock.query('COMMIT');lock.release();}
    expect((await Promise.all(pending)).map(x=>x.status)).toEqual([200,200,200,200,200]);
    expect((await grants()).map(x=>x.seat_count)).toEqual([7]);
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='superadmin.billing.invoice.mark_paid'")).rowCount).toBe(1);
  },15000);
  it.each([
    [{seat_count:10,billable_seat_count:7,gift_offset_seats:5},200],
    [{seat_count:10,billable_seat_count:7,gift_offset_seats:3},999],
    [{seat_count:10,billable_seat_count:7,gift_offset_seats:11},700],
    [{seat_count:'10',billable_seat_count:7,gift_offset_seats:3},700],
    [{gift_offset_seats:3},700],
  ])('leaves ambiguous or inconsistent invoice data untouched', async (metadata,subtotal) => {
    const id = await invoice(10,3,1,false,metadata as object,subtotal as number);
    const before=(await pool.query('SELECT status,subtotal_cents FROM billing_invoices WHERE id=$1',[id])).rows[0];
    expect((await paid(id)).status).toBe(409); expect(await grants()).toEqual([]);
    expect((await pool.query('SELECT status,subtotal_cents FROM billing_invoices WHERE id=$1',[id])).rows[0]).toEqual(before);
    expect((await pool.query("SELECT 1 FROM audit_log WHERE action='superadmin.billing.invoice.mark_paid'")).rowCount).toBe(0);
  });
  it('rejects an exact persisted fractional value before the JSON decoder rounds it', async () => {
    const id=await invoice(); await pool.query(`UPDATE billing_invoice_items SET metadata=jsonb_set(metadata,'{seat_count}','10.0000000000000001'::jsonb) WHERE invoice_id=$1`,[id]);
    expect((await paid(id)).status).toBe(409); expect(await grants()).toEqual([]);
  });
  it('rolls invoice payment and grants back together on a grant write failure',async()=>{
    const id=await invoice();await pool.query("CREATE FUNCTION invoice_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source='invoice' THEN RAISE EXCEPTION 'synthetic grant failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER invoice_fixture_failure BEFORE INSERT ON license_grants FOR EACH ROW EXECUTE FUNCTION invoice_fixture_failure()");
    try { expect((await paid(id)).status).toBe(500);expect(await grants()).toEqual([]);expect((await pool.query('SELECT status FROM billing_invoices WHERE id=$1',[id])).rows[0].status).toBe('pending'); }
    finally{await pool.query('DROP TRIGGER invoice_fixture_failure ON license_grants;DROP FUNCTION invoice_fixture_failure()');}
    expect((await paid(id)).status).toBe(200);
  });
  it('rolls paid state and invoice grants back when their terminal audit cannot persist',async()=>{
    const id=await invoice();await pool.query("CREATE FUNCTION invoice_fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='superadmin.billing.invoice.mark_paid' THEN RAISE EXCEPTION 'synthetic invoice audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER invoice_fixture_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION invoice_fixture_audit_failure()");
    try { expect((await paid(id)).status).toBe(500);expect(await grants()).toEqual([]);expect((await pool.query('SELECT status FROM billing_invoices WHERE id=$1',[id])).rows[0].status).toBe('pending'); }
    finally{await pool.query('DROP TRIGGER invoice_fixture_audit_failure ON audit_log;DROP FUNCTION invoice_fixture_audit_failure()');}
    expect((await paid(id)).status).toBe(200);
  });
  it('does not let a gift repricer waiting on a paid invoice mutate its items afterwards',async()=>{
    const id=await invoice();const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE',[id]);
    const pending=gift(2);
    try{
      let blocked=0;const deadline=Date.now()+4000;
      while(Date.now()<deadline){blocked=Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='flash_invoice_paid_fixture' AND wait_event_type='Lock'")).rows[0].count);if(blocked)break;await new Promise(r=>setTimeout(r,10));}
      expect(blocked).toBe(1);
      await lock.query("UPDATE billing_invoices SET status='paid',paid_at=now() WHERE id=$1",[id]);
      await lock.query("INSERT INTO license_grants(workspace_id,source,seat_count,external_ref) VALUES($1,'invoice',7,$2)",[workspace,id]);
    }finally{await lock.query('COMMIT');lock.release();}
    expect((await pending).status).toBe(201);
    expect((await pool.query('SELECT metadata FROM billing_invoice_items WHERE invoice_id=$1',[id])).rows[0].metadata.gift_offset_seats).toBe(3);
  });
  it('preserves legacy settings fallback without aborting the invoice transaction',async()=>{
    const id=await invoice();
    await pool.query('ALTER TABLE workspace_licensing_settings DROP COLUMN licensing_enabled');
    await pool.query('ALTER TABLE platform_settings DROP COLUMN assistant_enabled');
    try{expect((await paid(id)).status).toBe(200);expect((await grants()).map(x=>x.seat_count)).toEqual([7]);}
    finally{await pool.query('ALTER TABLE workspace_licensing_settings ADD COLUMN licensing_enabled boolean DEFAULT true');await pool.query('ALTER TABLE platform_settings ADD COLUMN assistant_enabled boolean DEFAULT false');}
  });
  const requestInvoice = (seats=3) => requestInvoiceHandler(new Request('http://localhost/api/licenses/grants/invoice-request', { method:'POST',headers,body:JSON.stringify({workspace_id:workspace,plan_id:plan,seat_count:seats,duration_months:1}) }),{} as never);
  async function waitForLocks(count=1) {
    let blocked=0;const deadline=Date.now()+4000;
    while(Date.now()<deadline){blocked=Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='flash_invoice_paid_fixture' AND wait_event_type='Lock'")).rows[0].count);if(blocked>=count)break;await new Promise(r=>setTimeout(r,10));}
    expect(blocked).toBeGreaterThanOrEqual(count);
  }
  it.each([0,1,3])('creates a schema-valid invoice request using %s available gifts',async available=>{
    if(available)await pool.query("INSERT INTO license_grants(workspace_id,source,seat_count) VALUES($1,'gift',$2)",[workspace,available]);
    const response=await requestInvoice();expect(response.status).toBe(201);const body=await response.json();
    expect(body).toMatchObject({status:available===3?'paid':'pending',gift_offset_seats:available,billable_seat_count:3-available});
    const row=(await pool.query('SELECT quantity,metadata FROM billing_invoice_items')).rows[0];
    expect(row.quantity).toBe(3-available);expect(row.metadata.seat_item_format).toBe('requested-net-v1');
    expect(await getWorkspaceAvailableGiftSeats(workspace)).toBe(0);
    expect((await paid(body.invoice_id)).status).toBe(200);
    expect((await grants()).map(x=>x.seat_count)).toEqual(available===3?[]:[3-available]);
    expect(await getWorkspacePlatformEntitledSeats(workspace)).toBe(3);
  });
  it('serialises concurrent local requests so the gift is consumed once',async()=>{
    await pool.query("INSERT INTO license_grants(workspace_id,source,seat_count) VALUES($1,'gift',3)",[workspace]);
    const responses=await Promise.all([requestInvoice(),requestInvoice()]);expect(responses.map(x=>x.status)).toEqual([201,201]);
    const bodies=await Promise.all(responses.map(x=>x.json()));expect(bodies.map(x=>x.gift_offset_seats).sort()).toEqual([0,3]);
    expect((await pool.query("SELECT SUM((metadata->>'gift_offset_seats')::int)::int AS consumed FROM billing_invoice_items")).rows[0].consumed).toBe(3);
    expect(await getWorkspaceAvailableGiftSeats(workspace)).toBe(0);
  });
  it('keeps accepted zero rows readable while an old unmarked writer still fails closed',async()=>{
    await pool.query("INSERT INTO license_grants(workspace_id,source,seat_count) VALUES($1,'gift',3)",[workspace]);
    const response=await requestInvoice();expect(response.status).toBe(201);const body=await response.json();
    const oldMetadata={seat_count:3,billable_seat_count:0,gift_offset_seats:3,billing_intervals:1,duration_months:1};
    await expect(pool.query("INSERT INTO billing_invoice_items(invoice_id,description,quantity,unit_amount_cents,metadata) VALUES($1,'Old writer',0,100,$2)",[body.invoice_id,oldMetadata])).rejects.toMatchObject({code:'23514'});
    expect((await pool.query('SELECT 1 FROM billing_invoice_items')).rowCount).toBe(1);
    expect(await getWorkspaceAvailableGiftSeats(workspace)).toBe(0);
  });
  it.each([null,{}, {seat_item_format:'requested-net-v1'}, {seat_item_format:'requested-net-v1',seat_count:'3',gift_offset_seats:'3',billable_seat_count:0}, {seat_item_format:'requested-net-v1',seat_count:null,gift_offset_seats:null,billable_seat_count:0}, {seat_item_format:'requested-net-v1',seat_count:3.1,gift_offset_seats:3.1,billable_seat_count:0}, {seat_item_format:'requested-net-v1',seat_count:3,gift_offset_seats:3,billable_seat_count:0.001}])('rejects unguarded zero rows with missing/null/string/fractional metadata',async metadata=>{
    const id=await invoice();await expect(pool.query("INSERT INTO billing_invoice_items(invoice_id,description,quantity,unit_amount_cents,metadata) VALUES($1,'Invalid zero',0,100,$2::jsonb)",[id,JSON.stringify(metadata)])).rejects.toMatchObject({code:'23514'});
  });
  it.each(['expired','newly-active'])('uses post-lock gift validity for %s grants',async state=>{
    await pool.query("INSERT INTO license_grants(workspace_id,source,seat_count,starts_at) VALUES($1,'gift',3,CASE WHEN $2='newly-active' THEN now()+interval'1 day' ELSE now() END)",[workspace,state]);
    const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE',[workspace]);
    const pending=requestInvoice();
    try{await waitForLocks();if(state==='expired')await pool.query("UPDATE license_grants SET ends_at=clock_timestamp() WHERE workspace_id=$1",[workspace]);else await pool.query("UPDATE license_grants SET starts_at=clock_timestamp() WHERE workspace_id=$1",[workspace]);await new Promise(r=>setTimeout(r,30));}
    finally{await lock.query('COMMIT');lock.release();}
    const response=await pending;expect(response.status).toBe(201);expect((await response.json()).gift_offset_seats).toBe(state==='expired'?0:3);
  });
  it('rechecks superadmin after waiting for the invoice lock',async()=>{
    const id=await invoice();const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE',[id]);const pending=paid(id);
    try{await waitForLocks();await pool.query('UPDATE users SET is_superadmin=false WHERE id=$1',[actor]);}finally{await lock.query('COMMIT');lock.release();}
    expect((await pending).status).toBe(403);expect(await grants()).toEqual([]);
  });
  it.each(['demotion','plan-change'])('rechecks %s after waiting for the workspace lock',async change=>{
    const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE',[workspace]);const pending=requestInvoice();
    try{await waitForLocks();if(change==='demotion')await pool.query('UPDATE users SET is_superadmin=false WHERE id=$1',[actor]);else await pool.query(`UPDATE license_plans SET features=features||'{"hidden":true}'::jsonb WHERE id=$1`,[plan]);}finally{await lock.query('COMMIT');lock.release();}
    expect((await pending).status).toBe(change==='demotion'?403:409);expect((await pool.query('SELECT 1 FROM billing_invoices')).rowCount).toBe(0);
  });
  it('denies a non-superadmin before changing invoice or grants',async()=>{
    const id=await invoice();await pool.query('UPDATE users SET is_superadmin=false WHERE id=$1',[actor]);
    expect((await paid(id)).status).toBe(403);expect(await grants()).toEqual([]);
  });
  it.each([1,2])('grants each of two invoice items once with second duration %s', async duration => {
    const id=await invoice(5,0);
    await pool.query("INSERT INTO billing_invoice_items(invoice_id,description,quantity,unit_amount_cents,metadata) VALUES($1,'Second item',2,100,$2)",[id,JSON.stringify({seat_count:2,billable_seat_count:2,gift_offset_seats:0,billing_intervals:1,duration_months:duration})]);
    await pool.query('UPDATE billing_invoices SET subtotal_cents=700 WHERE id=$1',[id]);
    expect((await paid(id)).status).toBe(200);
    expect((await grants()).map(row=>row.seat_count).sort()).toEqual([2,5]);
    const rows=(await pool.query("SELECT external_ref,metadata,round(extract(epoch FROM ends_at-starts_at)/86400)::int days FROM license_grants WHERE source='invoice' ORDER BY seat_count")).rows;
    expect(new Set(rows.map(row=>row.external_ref)).size).toBe(2);
    expect(rows.every(row=>row.metadata.invoice_id===id && typeof row.metadata.item_id==='string')).toBe(true);
    expect(rows[0].days).toBeGreaterThanOrEqual(duration===1?28:59);
    expect((await paid(id)).status).toBe(200);expect((await grants()).length).toBe(2);
  });
  it.each(['platform','workspace'])('rechecks %s licensing after waiting for the workspace lock',async scope=>{
    const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE',[workspace]);const pending=requestInvoice();
    try{await waitForLocks();if(scope==='platform')await pool.query('UPDATE platform_settings SET licensing_enabled=false WHERE id=1');else await pool.query('INSERT INTO workspace_licensing_settings(workspace_id,licensing_enabled) VALUES($1,false) ON CONFLICT(workspace_id) DO UPDATE SET licensing_enabled=false',[workspace]);}finally{await lock.query('COMMIT');lock.release();}
    expect((await pending).status).toBe(409);expect((await pool.query('SELECT 1 FROM billing_invoices')).rowCount).toBe(0);
  });
  it('rejects an integral decimal gift offset whose text cannot be read as integer',async()=>{
    const id=await invoice();
    await expect(pool.query(`INSERT INTO billing_invoice_items(invoice_id,description,quantity,unit_amount_cents,metadata) VALUES($1,'Scaled gift',0,100,'{"seat_item_format":"requested-net-v1","seat_count":3,"gift_offset_seats":3.0,"billable_seat_count":0}'::jsonb)`,[id])).rejects.toMatchObject({code:'23514'});
    expect(await getWorkspaceAvailableGiftSeats(workspace)).toBe(0);
  });

  it.each(['role','scope','matrix'])('rechecks current workspace billing %s after a queued regular-user request',async change=>{
    await pool.query('UPDATE users SET is_superadmin=false WHERE id=$1',[actor]);
    const owner=(await pool.query("INSERT INTO users(email) VALUES('owner@invoice-fixture.invalid') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'owner','workspace')",[workspace,owner]);
    await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'admin','workspace')",[workspace,actor]);
    const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE',[workspace]);const pending=requestInvoice();
    try{await waitForLocks();if(change==='matrix')await lock.query(`UPDATE workspaces SET settings=jsonb_set(settings,'{rbac}','{"permission_matrix":{"billing":{"billing_manage":"owner"}}}'::jsonb) WHERE id=$1`,[workspace]);else if(change==='scope')await lock.query("UPDATE workspace_memberships SET access_scope='scoped' WHERE workspace_id=$1 AND user_id=$2",[workspace,actor]);else await lock.query("UPDATE workspace_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",[workspace,actor]);}finally{await lock.query('COMMIT');lock.release();}
    expect((await pending).status).toBe(403);expect((await pool.query('SELECT 1 FROM billing_invoices')).rowCount).toBe(0);
  });

  it.each(['requested-net-v1','unknown-future-format'])('rejects gross quantity for an explicitly marked %s item',async format=>{
    const id=await invoice(10,3,1,true);await pool.query("UPDATE billing_invoice_items SET metadata=metadata||jsonb_build_object('seat_item_format',$2::text) WHERE invoice_id=$1",[id,format]);
    expect((await paid(id)).status).toBe(409);expect(await grants()).toEqual([]);
  });

  it('keeps a zero-priced billable request pending until its net entitlement is granted',async()=>{
    await pool.query(`UPDATE license_plans SET features='{"invoice_unit_amount_cents":0}'::jsonb WHERE id=$1`,[plan]);
    const response=await requestInvoice();expect(response.status).toBe(201);const body=await response.json();expect(body.status).toBe('pending');
    expect((await paid(body.invoice_id)).status).toBe(200);expect((await grants()).map(row=>row.seat_count)).toEqual([3]);
  });
  it('reads an exact scaled legacy gift offset in both balance paths and reprices safely',async()=>{
    const id=await invoice();await pool.query(`UPDATE billing_invoice_items SET metadata=jsonb_set(metadata,'{gift_offset_seats}','3.0'::jsonb) WHERE invoice_id=$1`,[id]);
    expect(await getWorkspaceAvailableGiftSeats(workspace)).toBe(0);
    expect((await gift(2)).status).toBe(201);
    expect((await pool.query('SELECT subtotal_cents FROM billing_invoices WHERE id=$1',[id])).rows[0].subtotal_cents).toBe(500);
  });
  it.each(['3.1','-3','"3"','null','1000001'])('rejects malformed persisted gift offset %s without retaining a new gift',async raw=>{
    const id=await invoice();await pool.query(`UPDATE billing_invoice_items SET metadata=jsonb_set(metadata,'{gift_offset_seats}',$2::jsonb) WHERE invoice_id=$1`,[id,raw]);
    await expect(getWorkspaceAvailableGiftSeats(workspace)).rejects.toMatchObject({status:409});
    expect((await gift(2)).status).toBe(409);expect((await pool.query("SELECT SUM(seat_count)::int seats FROM license_grants WHERE source='gift'")).rows[0].seats).toBe(3);
  });

  it('rejects an empty pending zero-subtotal invoice without claiming payment',async()=>{
    const id=(await pool.query("INSERT INTO billing_invoices(workspace_id,invoice_type,status,subtotal_cents) VALUES($1,'workspace_to_superadmin','pending',0) RETURNING id",[workspace])).rows[0].id;
    expect((await paid(id)).status).toBe(409);expect(await grants()).toEqual([]);
    expect((await pool.query('SELECT status FROM billing_invoices WHERE id=$1',[id])).rows[0].status).toBe('pending');
  });

});
