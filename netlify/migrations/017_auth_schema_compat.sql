ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_pending_enc TEXT,
  ADD COLUMN IF NOT EXISTS totp_backup_codes_enc TEXT;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
