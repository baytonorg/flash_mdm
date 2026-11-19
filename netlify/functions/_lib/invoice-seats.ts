// PostgreSQL verifies exact persisted numbers before the JSON decoder can round
// a fractional value into an integer. Missing fields remain legacy-compatible.
export const VALID_INVOICE_SEAT_METADATA_SQL = `(metadata IS NULL OR jsonb_typeof(metadata) = 'object') AND NOT EXISTS (
  SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(metadata)='object' THEN metadata ELSE '{}'::jsonb END) field
  WHERE field.key IN ('seat_count','billable_seat_count','gift_offset_seats','billing_intervals','duration_months')
    AND (jsonb_typeof(field.value) <> 'number' OR field.value::text !~ '^(0|[1-9][0-9]*)(\\.0+)?$')
)`;

interface InvoiceSeatItem {
  quantity: number;
  unit_amount_cents: number;
  metadata: Record<string, unknown> | null;
  valid_seat_metadata: boolean;
}
export function invoiceGrantSeats(item: InvoiceSeatItem) {
  const metadata = item.metadata ?? {};
  const integer = (value: unknown, min: number, max: number) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw Error('Invoice item billing metadata needs operator review');
    return value;
  };
  if (!item.valid_seat_metadata) throw Error('Invoice item billing metadata needs operator review');
  const quantity = integer(item.quantity, 0, 2147483647);
  const hasSeatMetadata = ['billable_seat_count','gift_offset_seats','billing_intervals'].some(key => metadata[key] !== undefined);
  if (metadata.seat_count === undefined && hasSeatMetadata) throw Error('Invoice item billing metadata needs operator review');
  const requested = integer(metadata.seat_count ?? quantity, 0, 1_000_000);
  const offset = integer(metadata.gift_offset_seats ?? 0, 0, requested);
  const billable = requested - offset;
  const intervals = integer(metadata.billing_intervals ?? 1, 1, 120);
  const duration = integer(metadata.duration_months ?? 1, 1, 120);
  if (metadata.billable_seat_count !== undefined && integer(metadata.billable_seat_count, 0, requested) !== billable) throw Error('Invoice item billing metadata needs operator review');
  // Current net quantities and documented legacy gross quantities are accepted.
  // Other representations must be reconciled deliberately, never guessed.
  if (metadata.seat_item_format !== undefined && metadata.seat_item_format !== 'requested-net-v1') throw Error('Invoice item billing metadata needs operator review');
  if (quantity !== billable * intervals && (metadata.seat_item_format === 'requested-net-v1' || quantity !== requested * intervals)) throw Error('Invoice item billing metadata needs operator review');
  const unit = integer(item.unit_amount_cents, 0, 2147483647);
  const subtotal = billable * intervals * unit;
  if (!Number.isSafeInteger(subtotal) || subtotal > 2147483647) throw Error('Invoice item billing metadata needs operator review');
  return { requested_seats: requested, gift_offset_seats: offset, billable_seats: billable, billing_intervals: intervals, duration_months: duration, subtotal_cents: subtotal };
}
