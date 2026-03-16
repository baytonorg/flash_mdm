ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_expires_active
  ON api_keys(expires_at)
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
