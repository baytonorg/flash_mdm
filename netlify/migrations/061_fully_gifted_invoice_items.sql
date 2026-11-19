-- Accept the guarded writer's zero-billable item without losing gift consumption.
-- Older writers do not emit this format marker and still fail closed on zero.
ALTER TABLE billing_invoice_items DROP CONSTRAINT IF EXISTS billing_invoice_items_amount_check;
ALTER TABLE billing_invoice_items ADD CONSTRAINT billing_invoice_items_amount_check CHECK (
  unit_amount_cents >= 0 AND (
    quantity > 0 OR (
      quantity = 0 AND (
        jsonb_typeof(metadata) = 'object'
        AND metadata->>'seat_item_format' = 'requested-net-v1'
        AND jsonb_typeof(metadata->'seat_count') = 'number'
        AND metadata->>'seat_count' ~ '^([1-9][0-9]{0,5}|1000000)$'
        AND metadata->>'gift_offset_seats' ~ '^([1-9][0-9]{0,5}|1000000)$'
        AND metadata->'gift_offset_seats' = metadata->'seat_count'
        AND metadata->'billable_seat_count' = '0'::jsonb
      ) IS TRUE
    )
  )
);
