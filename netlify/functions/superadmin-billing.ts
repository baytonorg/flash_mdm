import type { Context } from '@netlify/functions';
import type { PoolClient } from 'pg';
import { query, transaction } from './_lib/db.js';
import { requireSuperadmin } from './_lib/auth.js';
import { jsonResponse, errorResponse, getSearchParams, parseJsonBody, isValidUuid, getClientIp } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { invoiceGrantSeats, VALID_INVOICE_SEAT_METADATA_SQL } from './_lib/invoice-seats.js';
import { getWorkspaceAvailableGiftSeats, getWorkspaceLicensingSettings, isPlatformLicensingEnabled } from './_lib/licensing.js';

interface ManualGrantBody {
  workspace_id: string;
  seat_count: number;
  duration_months?: number;
  expires_at?: string | null;
  starts_at?: string;
  note?: string;
  grant_type?: 'manual' | 'gift';
}

const MANUAL_GRANT_MAX_SEATS = 1_000_000;
const MANUAL_GRANT_MAX_DURATION_MONTHS = 120;
const ALLOWED_INVOICE_STATUSES = ['pending', 'paid', 'cancelled'] as const;
const ALLOWED_INVOICE_STATUS_SET = new Set<string>(ALLOWED_INVOICE_STATUSES);

function getRoute(pathname: string): {
  resource: 'invoices' | 'manual_grant' | 'unknown';
  invoiceId?: string;
  action?: 'mark_paid' | 'cancel';
} {
  const normalized = pathname
    .replace(/^\/api\/superadmin\/billing\/?/, '')
    .replace(/^\/\.netlify\/functions\/superadmin-billing\/?/, '');
  const tail = normalized.split('/').filter(Boolean);

  if (tail[0] === 'invoices' && tail.length === 1) return { resource: 'invoices' };
  if (tail[0] === 'invoices' && tail.length === 3 && tail[2] === 'mark-paid') {
    return { resource: 'invoices', invoiceId: tail[1], action: 'mark_paid' };
  }
  if (tail[0] === 'invoices' && tail.length === 3 && tail[2] === 'cancel') {
    return { resource: 'invoices', invoiceId: tail[1], action: 'cancel' };
  }
  if (tail[0] === 'grants' && tail[1] === 'manual') return { resource: 'manual_grant' };
  return { resource: 'unknown' };
}

type PendingInvoice = { id: string; subtotal_cents: number };
type SeatItem = Parameters<typeof invoiceGrantSeats>[0] & { id: string };

async function applyGiftOffsetsToPendingInvoices(
  client: PoolClient,
  workspaceId: string,
  invoices: PendingInvoice[],
): Promise<{ applied_seats: number; updated_invoices: number }> {
  let available = await getWorkspaceAvailableGiftSeats(workspaceId, client);
  let applied = 0;
  let updatedInvoices = 0;
  for (const invoice of invoices) {
    if (available <= 0) break;
    const items = (await client.query<SeatItem>(
      `SELECT id, quantity, metadata, unit_amount_cents,
              (${VALID_INVOICE_SEAT_METADATA_SQL}) AS valid_seat_metadata
       FROM billing_invoice_items WHERE invoice_id = $1 ORDER BY created_at, id FOR UPDATE`,
      [invoice.id],
    )).rows;
    let seats;
    try {
      seats = items.map(invoiceGrantSeats);
      if (!seats.length || seats.reduce((sum, item) => sum + item.subtotal_cents, 0) !== invoice.subtotal_cents) {
        throw Error('Invoice subtotal needs operator review');
      }
    } catch {
      throw errorResponse('Invoice billing metadata needs operator review before applying gifts', 409);
    }
    if (!seats.some(item => item.billable_seats > 0)) continue;

    let requestedTotal = 0;
    let offsetTotal = 0;
    for (const [index, item] of items.entries()) {
      const previous = seats[index];
      const extra = Math.min(available, previous.billable_seats);
      const offset = previous.gift_offset_seats + extra;
      const billable = previous.billable_seats - extra;
      available -= extra;
      applied += extra;
      requestedTotal += previous.requested_seats;
      offsetTotal += offset;
      // A touched legacy invoice may also contain unallocated gross siblings.
      // Normalise every item before summing net quantities for the invoice.
      const metadata = {
        ...item.metadata,
        seat_item_format: 'requested-net-v1',
        seat_count: previous.requested_seats,
        gift_offset_seats: offset,
        billable_seat_count: billable,
        billing_intervals: previous.billing_intervals,
        duration_months: previous.duration_months,
        ...(extra > 0 ? { gift_offset_applied_at: new Date().toISOString() } : {}),
      };
      await client.query(
        'UPDATE billing_invoice_items SET quantity = $1, metadata = $2::jsonb WHERE id = $3',
        [billable * previous.billing_intervals, JSON.stringify(metadata), item.id],
      );
    }
    const fullyGifted = requestedTotal === offsetTotal;
    await client.query(
      `UPDATE billing_invoices
       SET subtotal_cents = (SELECT SUM(quantity::bigint * unit_amount_cents)
                             FROM billing_invoice_items WHERE invoice_id = $1),
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           status = CASE WHEN $3 THEN 'paid' ELSE status END,
           paid_at = CASE WHEN $3 THEN now() ELSE paid_at END,
           updated_at = now()
       WHERE id = $1`,
      [invoice.id, JSON.stringify({ seat_item_format: 'requested-net-v1', seat_count: requestedTotal,
        gift_offset_seats: offsetTotal, billable_seat_count: requestedTotal - offsetTotal }), fullyGifted],
    );
    updatedInvoices++;
  }
  return { applied_seats: applied, updated_invoices: updatedInvoices };
}

export default async function handler(request: Request, _context: Context) {
  try {
    const auth = await requireSuperadmin(request);
    const platformLicensingEnabled = await isPlatformLicensingEnabled();
    if (!platformLicensingEnabled) {
      if (request.method === 'GET') {
        return jsonResponse({ invoices: [], licensing_enabled: false });
      }
      return errorResponse('Licensing is disabled at the platform level', 409);
    }
    const route = getRoute(new URL(request.url).pathname);

    if (request.method === 'GET' && route.resource === 'invoices') {
      const params = getSearchParams(request);
      const statusRaw = params.get('status');
      const workspaceId = params.get('workspace_id');
      if (workspaceId && !isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');

      const clauses: string[] = [];
      const values: unknown[] = [];
      if (statusRaw !== null) {
        const normalizedStatus = statusRaw.trim().toLowerCase();
        if (!ALLOWED_INVOICE_STATUS_SET.has(normalizedStatus)) {
          return errorResponse(`status must be one of: ${ALLOWED_INVOICE_STATUSES.join(', ')}`);
        }
        values.push(normalizedStatus);
        clauses.push(`bi.status = $${values.length}`);
      }
      if (workspaceId) {
        values.push(workspaceId);
        clauses.push(`bi.workspace_id = $${values.length}`);
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const invoices = await query<{
        id: string;
        workspace_id: string;
        workspace_name: string;
        invoice_type: string;
        status: string;
        subtotal_cents: number;
        currency: string;
        due_at: string | null;
        paid_at: string | null;
        source: string | null;
        metadata: Record<string, unknown>;
        created_at: string;
      }>(
        `SELECT bi.id, bi.workspace_id, w.name as workspace_name, bi.invoice_type, bi.status,
                bi.subtotal_cents, bi.currency, bi.due_at, bi.paid_at, bi.source, bi.metadata, bi.created_at
         FROM billing_invoices bi
         JOIN workspaces w ON w.id = bi.workspace_id
         ${where}
         ORDER BY bi.created_at DESC
         LIMIT 500`,
        values
      );

      return jsonResponse({ invoices });
    }

    if (request.method === 'POST' && route.resource === 'invoices' && route.action === 'mark_paid' && route.invoiceId) {
      if (!isValidUuid(route.invoiceId)) return errorResponse('invoice id must be a valid UUID');

      const paidResult = await transaction(async (client) => {
        const invoiceResult = await client.query<{
          id: string;
          workspace_id: string;
          status: string;
          currency: string;
          subtotal_cents: number;
        }>(
          `SELECT id, workspace_id, status, currency, subtotal_cents
           FROM billing_invoices
           WHERE id = $1
           FOR UPDATE`,
          [route.invoiceId]
        );
        const invoice = invoiceResult.rows[0];
        if (!invoice) throw new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404 });
        if (invoice.status === 'paid') return { invoice, grantsCreated: 0 };
        if (invoice.status !== 'pending') {
          throw new Response(JSON.stringify({ error: `Cannot mark a ${invoice.status} invoice as paid` }), { status: 409 });
        }
        const operator = (await client.query<{is_superadmin: boolean}>(
          'SELECT is_superadmin FROM users WHERE id=$1 FOR SHARE', [auth.user.id],
        )).rows[0];
        if (!operator?.is_superadmin) throw errorResponse('Superadmin permission changed', 403);
        const workspaceLicensing = await getWorkspaceLicensingSettings(invoice.workspace_id, client);
        if (!workspaceLicensing.effective_licensing_enabled) {
          throw new Response(JSON.stringify({ error: 'Licensing is disabled for this workspace' }), { status: 409 });
        }

        const items = await client.query<{
          id: string;
          quantity: number;
          metadata: Record<string, unknown> | null;
          period_end: string | null;
          unit_amount_cents: number;
          valid_seat_metadata: boolean;
        }>(
          `SELECT id, quantity, metadata, period_end, unit_amount_cents,
                  (${VALID_INVOICE_SEAT_METADATA_SQL}) AS valid_seat_metadata
           FROM billing_invoice_items
           WHERE invoice_id = $1 ORDER BY id FOR UPDATE`,
          [route.invoiceId]
        );

        let resolvedItems;
        try {
          resolvedItems = items.rows.map(item => ({ ...invoiceGrantSeats(item), item_id: item.id }));
          const expectedSubtotal = resolvedItems.reduce((sum, item) => sum + item.subtotal_cents, 0);
          if (!resolvedItems.length || !Number.isSafeInteger(expectedSubtotal) || expectedSubtotal !== invoice.subtotal_cents) throw Error('Invoice subtotal needs operator review');
        } catch {
          throw new Response(JSON.stringify({ error: 'Invoice billing metadata needs operator review before marking paid' }), { status: 409 });
        }
        await client.query(
          `UPDATE billing_invoices SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1`,
          [route.invoiceId],
        );
        let grantsCreated = 0;
        const multipleGrants = resolvedItems.filter(item => item.billable_seats > 0).length > 1;
        for (const item of resolvedItems) {
          const seatCount = item.billable_seats;
          const durationMonths = item.duration_months;
          if (seatCount === 0) continue;

          await client.query(
            `INSERT INTO license_grants
               (id, workspace_id, source, seat_count, starts_at, ends_at, status, external_ref, metadata, created_by)
             VALUES ($1, $2, 'invoice', $3, now(), now() + ($4 || ' months')::interval, 'active', $5, $6::jsonb, $7)`,
            [
              crypto.randomUUID(),
              invoice.workspace_id,
              Math.trunc(seatCount),
              String(Math.max(1, Math.trunc(durationMonths))),
              multipleGrants ? `${invoice.id}:${item.item_id}` : invoice.id,
              JSON.stringify({ invoice_id: invoice.id, ...item }),
              auth.user.id,
            ]
          );
          grantsCreated += 1;
        }

        await logAudit({
          workspace_id: invoice.workspace_id, user_id: auth.user.id,
          action: 'superadmin.billing.invoice.mark_paid', resource_type: 'invoice', resource_id: invoice.id,
          details: { grants_created: grantsCreated, items: resolvedItems }, ip_address: getClientIp(request),
        }, client);
        return { invoice, grantsCreated };
      });



      return jsonResponse({ message: 'Invoice marked as paid', grants_created: paidResult.grantsCreated });
    }

    if (request.method === 'POST' && route.resource === 'invoices' && route.action === 'cancel' && route.invoiceId) {
      if (!isValidUuid(route.invoiceId)) return errorResponse('invoice id must be a valid UUID');

      const cancelResult = await transaction(async (client) => {
        const invoiceResult = await client.query<{
          id: string;
          workspace_id: string;
          status: string;
        }>(
          `SELECT id, workspace_id, status
           FROM billing_invoices
           WHERE id = $1
           FOR UPDATE`,
          [route.invoiceId]
        );
        const invoice = invoiceResult.rows[0];
        if (!invoice) throw new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404 });
        if (invoice.status === 'cancelled') return { invoice, changed: false };
        if (invoice.status !== 'pending') {
          throw new Response(JSON.stringify({ error: `Cannot cancel a ${invoice.status} invoice` }), { status: 409 });
        }

        await client.query(
          `UPDATE billing_invoices
           SET status = 'cancelled', updated_at = now()
           WHERE id = $1`,
          [route.invoiceId]
        );
        return { invoice, changed: true };
      });

      if (cancelResult.changed) {
        await logAudit({
          workspace_id: cancelResult.invoice.workspace_id,
          user_id: auth.user.id,
          action: 'superadmin.billing.invoice.cancelled',
          resource_type: 'invoice',
          resource_id: route.invoiceId,
          details: { previous_status: 'pending', status: 'cancelled' },
          ip_address: getClientIp(request),
        });
      }

      return jsonResponse({
        message: cancelResult.changed ? 'Invoice cancelled' : 'Invoice already cancelled',
        status: 'cancelled',
      });
    }

    if (request.method === 'POST' && route.resource === 'manual_grant') {
      const body = await parseJsonBody<ManualGrantBody>(request);
      if (!body.workspace_id || !isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');
      if (!Number.isInteger(body.seat_count) || body.seat_count <= 0) return errorResponse('seat_count must be a positive integer');
      if (body.duration_months !== undefined && (!Number.isInteger(body.duration_months) || body.duration_months <= 0)) {
        return errorResponse('duration_months must be a positive integer');
      }
      if (body.duration_months !== undefined && body.expires_at) {
        return errorResponse('Provide either duration_months or expires_at, not both');
      }
      const seatCount = Math.min(MANUAL_GRANT_MAX_SEATS, body.seat_count);
      const durationMonths = body.duration_months === undefined
        ? null
        : Math.min(MANUAL_GRANT_MAX_DURATION_MONTHS, body.duration_months);

      const startsAt = body.starts_at ? new Date(body.starts_at) : new Date();
      if (Number.isNaN(startsAt.getTime())) return errorResponse('starts_at must be a valid ISO datetime');
      const source = body.grant_type === 'gift' ? 'gift' : 'manual';

      let endsAt: string | null = null;
      if (body.expires_at) {
        const parsedEndsAt = new Date(body.expires_at);
        if (Number.isNaN(parsedEndsAt.getTime())) return errorResponse('expires_at must be a valid ISO datetime');
        if (parsedEndsAt.getTime() <= startsAt.getTime()) return errorResponse('expires_at must be after starts_at');
        endsAt = parsedEndsAt.toISOString();
      } else if (durationMonths !== null) {
        const durationEnd = new Date(startsAt.toISOString());
        durationEnd.setUTCMonth(durationEnd.getUTCMonth() + durationMonths);
        endsAt = durationEnd.toISOString();
      }

      const grantId = crypto.randomUUID();
      const giftOffsetResult = await transaction(async client => {
        const workspace = await client.query('SELECT id FROM workspaces WHERE id = $1 FOR NO KEY UPDATE', [body.workspace_id]);
        if (!workspace.rowCount) throw errorResponse('Workspace not found', 404);
        const pending = source === 'gift' ? (await client.query<PendingInvoice>(
          `SELECT id, subtotal_cents FROM billing_invoices
           WHERE workspace_id = $1 AND invoice_type = 'workspace_to_superadmin' AND status = 'pending'
           ORDER BY created_at, id FOR UPDATE`,
          [body.workspace_id],
        )).rows : [];
        // Recheck the actor and settings after waiting for competing invoice writers.
        const operator = (await client.query<{ is_superadmin: boolean }>(
          'SELECT is_superadmin FROM users WHERE id = $1 FOR SHARE', [auth.user.id],
        )).rows[0];
        if (!operator?.is_superadmin) throw errorResponse('Superadmin permission changed', 403);
        const licensing = await getWorkspaceLicensingSettings(body.workspace_id, client);
        if (!licensing.effective_licensing_enabled) throw errorResponse('Licensing is disabled for this workspace', 409);

        await client.query(
          `INSERT INTO license_grants
             (id, workspace_id, source, seat_count, starts_at, ends_at, status, metadata, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::jsonb, $8)`,
          [
            grantId,
            body.workspace_id,
            source,
            seatCount,
            startsAt.toISOString(),
            endsAt,
            JSON.stringify({ note: body.note ?? null, grant_type: source }),
            auth.user.id,
          ]
        );

        const result = source === 'gift'
          ? await applyGiftOffsetsToPendingInvoices(client, body.workspace_id, pending)
          : null;

        await logAudit({
          workspace_id: body.workspace_id,
          user_id: auth.user.id,
          action: 'superadmin.billing.grant.manual',
          resource_type: 'license_grant',
          resource_id: grantId,
          details: {
            source,
            seat_count: seatCount,
            duration_months: durationMonths,
            expires_at: endsAt,
            gift_offsets_applied: result,
            note: body.note ?? null,
          },
          ip_address: getClientIp(request),
        }, client);

        return result;
      });
      return jsonResponse({
        message: source === 'gift' ? 'Gift grant created' : 'Manual grant created',
        grant_id: grantId,
        gift_offsets_applied: giftOffsetResult,
      }, 201);
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('superadmin-billing error:', err);
    return errorResponse('Internal server error', 500);
  }
}
