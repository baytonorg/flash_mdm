ALTER TABLE devices ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- Backfill existing devices: Model_SerialNumber or Model_AMAPI-suffix
UPDATE devices SET name = CONCAT(
  COALESCE(model, 'Device'),
  '_',
  COALESCE(serial_number, REVERSE(SPLIT_PART(REVERSE(amapi_name), '/', 1)))
) WHERE name IS NULL;
