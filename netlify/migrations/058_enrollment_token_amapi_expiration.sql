ALTER TABLE enrollment_tokens
  ADD COLUMN IF NOT EXISTS amapi_expiration_timestamp TEXT;
