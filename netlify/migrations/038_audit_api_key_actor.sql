ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL;

ALTER TABLE audit_log
  DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('user', 'system', 'api_key'));

CREATE INDEX IF NOT EXISTS idx_audit_api_key ON audit_log(api_key_id, created_at DESC);

