ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_pending_created_at TIMESTAMPTZ;
