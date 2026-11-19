// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { closeDatabasePool } from '../_lib/db';
import { hashToken } from '../_lib/crypto';
import { getWorkspaceAvailableGiftSeats } from '../_lib/licensing';
import { MIGRATIONS } from '../migrate';
import billing from '../superadmin-billing';
import invoiceRequest from '../license-grants';

const url = process.env.INVOICE_GIFT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('pending invoice gift repricing with PostgreSQL and authenticated handlers', () => {
  let pool: pg.Pool;
  let workspace: string;
  let operator: string;
  let plan: string;
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: 'flash_session=synthetic-gift-fixture',
  };
  const request = (path: string, body?: object) => new Request('http://localhost' + path, {
    method: 'POST', headers, body: body && JSON.stringify(body),
  });
  const gift = (seats: number) => billing(request('/api/superadmin/billing/grants/manual', {
    workspace_id: workspace, grant_type: 'gift', seat_count: seats,
  }), {} as never);
  const create = (seats: number, months = 1) => invoiceRequest(request('/api/licenses/grants/invoice-request', {
    workspace_id: workspace, plan_id: plan, seat_count: seats, duration_months: months,
  }), {} as never);
  const paid = (invoice: string) => billing(request('/api/superadmin/billing/invoices/' + invoice + '/mark-paid'), {} as never);

  async function createInvoice(seats: number, months = 1) {
    const response = await create(seats, months);
    expect(response.status).toBe(201);
    return (await response.json()).invoice_id as string;
  }

  async function snapshot(id: string) {
    const invoice = (await pool.query('SELECT status, paid_at, subtotal_cents, metadata FROM billing_invoices WHERE id=$1', [id])).rows[0];
    const items = (await pool.query('SELECT quantity, metadata FROM billing_invoice_items WHERE invoice_id=$1 ORDER BY created_at, id', [id])).rows;
    return { ...invoice, items };
  }

  async function assertNet(id: string, requested: number, offset: number, intervals: number) {
    const remaining = requested - offset;
    const expected = { seat_count: requested, gift_offset_seats: offset, billable_seat_count: remaining };
    expect(await snapshot(id)).toMatchObject({
      status: remaining ? 'pending' : 'paid',
      subtotal_cents: remaining * intervals * 100,
      metadata: expected,
      items: [{ quantity: remaining * intervals, metadata: { ...expected, billing_intervals: intervals } }],
    });
  }

  async function waitForLocks(count = 1) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const row = (await pool.query(`SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname=current_database() AND application_name='gift_fixture_app' AND wait_event_type='Lock'`)).rows[0];
      if (Number(row.count) >= count) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected fixture lock contention');
  }

  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/flash_invoice_gift_fixture') {
      throw Error('Refusing non-disposable gift fixture');
    }
    target.searchParams.set('application_name', 'gift_fixture_app');
    process.env.DATABASE_URL = target.toString();
    process.env.NODE_ENV = 'development';
    process.env.URL = 'http://localhost';
    pool = new pg.Pool({ connectionString: url });
    for (const migration of MIGRATIONS) await pool.query(migration.sql);
  });
  afterAll(async () => { await closeDatabasePool(); await pool?.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE workspaces, users CASCADE');
    await pool.query(`INSERT INTO platform_settings(id,licensing_enabled) VALUES(1,true)
      ON CONFLICT(id) DO UPDATE SET licensing_enabled=true`);
    operator = (await pool.query("INSERT INTO users(email,is_superadmin) VALUES('gift-operator@example.invalid',true) RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '14 days')", [operator, hashToken('synthetic-gift-fixture')]);
    workspace = (await pool.query("INSERT INTO workspaces(name) VALUES('Gift fixture') RETURNING id")).rows[0].id;
    plan = (await pool.query(`INSERT INTO license_plans(name,max_devices,features)
      VALUES('Gift fixture',100,'{"invoice_unit_amount_cents":100}') RETURNING id`)).rows[0].id;
  });

  it('applies initial, incremental and excess gifts exactly once across billing intervals', async () => {
    expect((await gift(3)).status).toBe(201);
    const id = await createInvoice(10, 3);
    await assertNet(id, 10, 3, 3);
    for (const [added, offset, applied] of [[2, 5, 2], [4, 9, 4], [4, 10, 1]]) {
      const response = await gift(added);
      expect(response.status).toBe(201);
      expect((await response.json()).gift_offsets_applied).toEqual({ applied_seats: applied, updated_invoices: 1 });
      await assertNet(id, 10, offset, 3);
    }
    const settled = await snapshot(id);
    expect(settled.paid_at).toBeTruthy();
    expect((await (await gift(1)).json()).gift_offsets_applied).toEqual({ applied_seats: 0, updated_invoices: 0 });
    expect(await snapshot(id)).toEqual(settled);
    expect((await paid(id)).status).toBe(200);
    expect((await pool.query("SELECT id FROM license_grants WHERE source='invoice'")).rowCount).toBe(0);
    expect(await getWorkspaceAvailableGiftSeats(workspace)).toBe(4);
  });

  it('charges five seats after a two-seat gift is added to a seven-seat charge', async () => {
    expect((await gift(3)).status).toBe(201);
    const id = await createInvoice(10);
    await assertNet(id, 10, 3, 1);
    expect((await gift(2)).status).toBe(201);
    await assertNet(id, 10, 5, 1);
  });

  it('grants the eight remaining billable seats when a two-seat gift precedes payment', async () => {
    const id = await createInvoice(10);
    await assertNet(id, 10, 0, 1);
    expect((await gift(2)).status).toBe(201);
    await assertNet(id, 10, 2, 1);
    expect((await paid(id)).status).toBe(200);
    expect((await pool.query("SELECT source,seat_count FROM license_grants ORDER BY source")).rows)
      .toEqual([{ source: 'gift', seat_count: 2 }, { source: 'invoice', seat_count: 8 }]);
  });

  it('normalises every legacy gross line on a touched invoice even when the first uses the entire new gift', async () => {
    expect((await gift(3)).status).toBe(201);
    const id = await createInvoice(10, 2);
    // Older gross rows retain the original requested count in quantity.
    await pool.query("UPDATE billing_invoice_items SET quantity=20, metadata=metadata-'seat_item_format' WHERE invoice_id=$1", [id]);
    await pool.query("INSERT INTO license_grants(workspace_id,source,seat_count) VALUES($1,'gift',2)", [workspace]);
    await pool.query(`INSERT INTO billing_invoice_items(invoice_id,description,quantity,unit_amount_cents,metadata)
      VALUES($1,'Older second item',8,100,'{"seat_count":4,"gift_offset_seats":2,"billable_seat_count":2,"billing_intervals":2}')`, [id]);
    await pool.query('UPDATE billing_invoices SET subtotal_cents=1800 WHERE id=$1', [id]);
    expect((await gift(1)).status).toBe(201);
    const invoice = await snapshot(id);
    expect(invoice).toMatchObject({ subtotal_cents: 1600, metadata: { seat_count: 14, gift_offset_seats: 6, billable_seat_count: 8 },
      items: [{ quantity: 12, metadata: { gift_offset_seats: 4 } }, { quantity: 4, metadata: { gift_offset_seats: 2 } }] });
    expect((await paid(id)).status).toBe(200);
    expect((await pool.query("SELECT seat_count FROM license_grants WHERE source='invoice' ORDER BY seat_count")).rows)
      .toEqual([{ seat_count: 2 }, { seat_count: 6 }]);
  });

  it('preserves other invoice types while allocating across multiple eligible invoices in creation order', async () => {
    const unrelated = await createInvoice(10);
    await pool.query("UPDATE billing_invoices SET invoice_type='other' WHERE id=$1", [unrelated]);
    const untouched = await snapshot(unrelated);
    const first = await createInvoice(2);
    const second = await createInvoice(3);
    const response = await gift(4);
    expect((await response.json()).gift_offsets_applied).toEqual({ applied_seats: 4, updated_invoices: 2 });
    await assertNet(first, 2, 2, 1);
    await assertNet(second, 3, 2, 1);
    expect(await snapshot(unrelated)).toEqual(untouched);
  });

  it('rolls back a gift and earlier line changes when a later charge needs reconciliation', async () => {
    const first = await createInvoice(2);
    const second = await createInvoice(3);
    await pool.query('UPDATE billing_invoices SET subtotal_cents=1 WHERE id=$1', [second]);
    const original = await snapshot(first);
    expect((await gift(4)).status).toBe(409);
    expect(await snapshot(first)).toEqual(original);
    expect((await pool.query('SELECT id FROM license_grants')).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM audit_log WHERE action='superadmin.billing.grant.manual'")).rowCount).toBe(0);
  });

  it('rolls back the grant, price and status together when the final audit write fails', async () => {
    const id = await createInvoice(3);
    const original = await snapshot(id);
    await pool.query(`CREATE FUNCTION gift_fixture_audit_error() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='superadmin.billing.grant.manual' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER gift_fixture_audit_error BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION gift_fixture_audit_error()');
    try {
      expect((await gift(3)).status).toBe(500);
      expect(await snapshot(id)).toEqual(original);
      expect((await pool.query('SELECT id FROM license_grants')).rowCount).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER gift_fixture_audit_error ON audit_log');
      await pool.query('DROP FUNCTION gift_fixture_audit_error()');
    }
    expect((await gift(3)).status).toBe(201);
    await assertNet(id, 3, 3, 1);
  });

  it('keeps a zero-priced line with remaining seats pending until mark-paid creates its entitlement', async () => {
    const id = await createInvoice(3);
    await pool.query('UPDATE billing_invoice_items SET unit_amount_cents=0 WHERE invoice_id=$1', [id]);
    await pool.query('UPDATE billing_invoices SET subtotal_cents=0 WHERE id=$1', [id]);
    expect((await gift(1)).status).toBe(201);
    expect(await snapshot(id)).toMatchObject({ status: 'pending', subtotal_cents: 0,
      items: [{ quantity: 2, metadata: { billable_seat_count: 2 } }] });
    expect((await paid(id)).status).toBe(200);
    expect((await pool.query("SELECT seat_count FROM license_grants WHERE source='invoice'")).rows).toEqual([{ seat_count: 2 }]);
  });

  it('creates a future gift without reducing a current invoice', async () => {
    const id = await createInvoice(3);
    const response = await billing(request('/api/superadmin/billing/grants/manual', {
      workspace_id: workspace, grant_type: 'gift', seat_count: 2,
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    }), {} as never);
    expect(response.status).toBe(201);
    expect((await response.json()).gift_offsets_applied).toEqual({ applied_seats: 0, updated_invoices: 0 });
    await assertNet(id, 3, 0, 1);
  });

  it('serialises competing gift grants and an invoice request without consuming a gift seat twice', async () => {
    const first = await createInvoice(4);
    const lock = await pool.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [workspace]);
    const pending = [gift(2), gift(4), create(5)];
    try { await waitForLocks(3); } finally { await lock.query('COMMIT'); lock.release(); }
    const responses = await Promise.all(pending);
    expect(responses.map(response => response.status)).toEqual([201, 201, 201]);
    const second = (await responses[2].json()).invoice_id;
    await assertNet(first, 4, 4, 1);
    await assertNet(second, 5, 2, 1);
    expect(await getWorkspaceAvailableGiftSeats(workspace)).toBe(0);
  }, 12000);

  it.each(['demotion', 'platform-disable', 'workspace-disable'])('rechecks %s after waiting on a pending invoice', async change => {
    const id = await createInvoice(3);
    const lock = await pool.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE', [id]);
    const pending = gift(2);
    try {
      await waitForLocks();
      if (change === 'demotion') await pool.query('UPDATE users SET is_superadmin=false WHERE id=$1', [operator]);
      if (change === 'platform-disable') await pool.query('UPDATE platform_settings SET licensing_enabled=false WHERE id=1');
      if (change === 'workspace-disable') await pool.query(`INSERT INTO workspace_licensing_settings(workspace_id,licensing_enabled)
        VALUES($1,false) ON CONFLICT(workspace_id) DO UPDATE SET licensing_enabled=false`, [workspace]);
    } finally { await lock.query('COMMIT'); lock.release(); }
    expect((await pending).status).toBe(change === 'demotion' ? 403 : 409);
    await assertNet(id, 3, 0, 1);
    expect((await pool.query('SELECT id FROM license_grants')).rowCount).toBe(0);
  }, 12000);
});
