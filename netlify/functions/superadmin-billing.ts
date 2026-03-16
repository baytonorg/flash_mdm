import type { Context } from '@netlify/functions';
import { execute, query, queryOne, transaction } from './_lib/db.js';
import { requireSuperadmin } from './_lib/auth.js';
import { jsonResponse, errorResponse, getSearchParams, parseJsonBody, isValidUuid, getClientIp } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
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
  action?: 'mark_paid';
} {
  const normalized = pathname
    .replace(/^\/api\/superadmin\/billing\/?/, '')
    .replace(/^\/\.netlify\/functions\/superadmin-billing\/?/, '');
  const tail = normalized.split('/').filter(Boolean);

  if (tail[0] === 'invoices' && tail.length === 1) return { resource: 'invoices' };
  if (tail[0] === 'invoices' && tail.length === 3 && tail[2] === 'mark-paid') {
    return { resource: 'invoices', invoiceId: tail[1], action: 'mark_paid' };
  }
  if (tail[0] === 'grants' && tail[1] === 'manual') return { resource: 'manual_grant' };
  return { resource: 'unknown' };
}

async function applyGiftOffsetsToPendingInvoices(workspaceId: string): Promise<{ applied_seats: number; updated_invoices: number }> {
  let availableSeats = await getWorkspaceAvailableGiftSeats(workspaceId);
  if (availableSeats <= 0) return { applied_seats: 0, updated_invoices: 0 };

  const invoiceItems = await query<{
    id: string;
    invoice_id: string;
    quantity: number;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT bii.id, bii.invoice_id, bii.quantity, bii.metadata
     FROM billing_invoice_items bii
     JOIN billing_invoices bi ON bi.id = bii.invoice_id
     WHERE bi.workspace_id = $1
       AND bi.status = 'pending'
     ORDER BY bi.created_at ASC, bii.created_at ASC, bii.id ASC`,
    [workspaceId]
  );

  let appliedSeats = 0;
  const touchedInvoiceIds = new Set<string>();

  for (const item of invoiceItems) {
    if (availableSeats <= 0) break;
    const metadata = item.metadata ?? {};
    const existingOffsetRaw = metadata.gift_offset_seats;
    const existingOffset = Number.isFinite(Number(existingOffsetRaw))
      ? Math.max(0, Math.trunc(Number(existingOffsetRaw)))
      : 0;
    const remainingBillableSeats = Math.max(0, item.quantity - existingOffset);
    if (remainingBillableSeats <= 0) continue;

    const offsetSeats = Math.min(availableSeats, remainingBillableSeats);
    const updatedMetadata = {
      ...metadata,
      gift_offset_seats: existingOffset + offsetSeats,
      gift_offset_applied_at: new Date().toISOString(),
    };

    await execute(
      `UPDATE billing_invoice_items
       SET metadata = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(updatedMetadata), item.id]
    );

    availableSeats -= offsetSeats;
    appliedSeats += offsetSeats;
    touchedInvoiceIds.add(item.invoice_id);
  }

  for (const invoiceId of touchedInvoiceIds) {
    await execute(
      `UPDATE billing_invoices bi
       SET subtotal_cents = totals.subtotal_cents,
           status = CASE
             WHEN totals.subtotal_cents = 0 THEN 'paid'
             ELSE bi.status
           END,
           paid_at = CASE
             WHEN totals.subtotal_cents = 0 THEN COALESCE(bi.paid_at, now())
             ELSE bi.paid_at
           END,
           updated_at = now()
       FROM (
         SELECT bii.invoice_id,
                COALESCE(SUM(
                  GREATEST(
                    bii.quantity - COALESCE((bii.metadata ->> 'gift_offset_seats')::integer, 0),
                    0
                  ) * bii.unit_amount_cents
                ), 0) AS subtotal_cents
         FROM billing_invoice_items bii
         WHERE bii.invoice_id = $1
         GROUP BY bii.invoice_id
       ) totals
       WHERE bi.id = totals.invoice_id`,
      [invoiceId]
    );
  }

  return {
    applied_seats: appliedSeats,
    updated_invoices: touchedInvoiceIds.size,
  };
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
        }>(
          `SELECT id, workspace_id, status, currency
           FROM billing_invoices
           WHERE id = $1
           FOR UPDATE`,
          [route.invoiceId]
        );
        const invoice = invoiceResult.rows[0];
        if (!invoice) throw new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404 });
        if (invoice.status === 'paid') return { invoice, grantsCreated: 0 };
        const workspaceLicensing = await getWorkspaceLicensingSettings(invoice.workspace_id);
        if (!workspaceLicensing.effective_licensing_enabled) {
          throw new Response(JSON.stringify({ error: 'Licensing is disabled for this workspace' }), { status: 409 });
        }

        await client.query(
          `UPDATE billing_invoices
           SET status = 'paid', paid_at = now(), updated_at = now()
           WHERE id = $1`,
          [route.invoiceId]
        );

        const items = await client.query<{
          quantity: number;
          metadata: Record<string, unknown> | null;
          period_end: string | null;
        }>(
          `SELECT quantity, metadata, period_end
           FROM billing_invoice_items
           WHERE invoice_id = $1`,
          [route.invoiceId]
        );

        let grantsCreated = 0;
        for (const item of items.rows) {
          const seatCountRaw = (item.metadata?.seat_count ?? item.quantity) as unknown;
          const durationMonthsRaw = item.metadata?.duration_months as unknown;
          const seatCount = Number.isFinite(Number(seatCountRaw)) ? Number(seatCountRaw) : item.quantity;
          const durationMonths = Number.isFinite(Number(durationMonthsRaw))
            ? Number(durationMonthsRaw)
            : 1;
          if (seatCount <= 0) continue;

          await client.query(
            `INSERT INTO license_grants
               (id, workspace_id, source, seat_count, starts_at, ends_at, status, external_ref, metadata, created_by)
             VALUES ($1, $2, 'invoice', $3, now(), now() + ($4 || ' months')::interval, 'active', $5, $6::jsonb, $7)`,
            [
              crypto.randomUUID(),
              invoice.workspace_id,
              Math.trunc(seatCount),
              String(Math.max(1, Math.trunc(durationMonths))),
              invoice.id,
              JSON.stringify({ invoice_id: invoice.id }),
              auth.user.id,
            ]
          );
          grantsCreated += 1;
        }

        return { invoice, grantsCreated };
      });

      await logAudit({
        workspace_id: paidResult.invoice.workspace_id,
        user_id: auth.user.id,
        action: 'superadmin.billing.invoice.mark_paid',
        resource_type: 'invoice',
        resource_id: route.invoiceId,
        details: { grants_created: paidResult.grantsCreated },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: 'Invoice marked as paid', grants_created: paidResult.grantsCreated });
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

      const workspace = await queryOne<{ id: string }>('SELECT id FROM workspaces WHERE id = $1', [body.workspace_id]);
      if (!workspace) return errorResponse('Workspace not found', 404);
      const workspaceLicensing = await getWorkspaceLicensingSettings(body.workspace_id);
      if (!workspaceLicensing.effective_licensing_enabled) {
        return errorResponse('Licensing is disabled for this workspace', 409);
      }

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
      await execute(
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

      let giftOffsetResult: { applied_seats: number; updated_invoices: number } | null = null;
      if (source === 'gift') {
        giftOffsetResult = await applyGiftOffsetsToPendingInvoices(body.workspace_id);
      }

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
          gift_offsets_applied: giftOffsetResult,
          note: body.note ?? null,
        },
        ip_address: getClientIp(request),
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
