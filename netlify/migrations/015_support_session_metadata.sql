ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS impersonation_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS support_reason TEXT,
  ADD COLUMN IF NOT EXISTS support_ticket_ref VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_notice_acknowledged_at TIMESTAMPTZ;

UPDATE sessions
SET impersonation_mode = COALESCE(impersonation_mode, 'full')
WHERE impersonated_by IS NOT NULL;

ALTER TABLE sessions
  ALTER COLUMN impersonation_mode SET DEFAULT 'full';

CREATE INDEX IF NOT EXISTS idx_sessions_impersonation_mode ON sessions(impersonation_mode);
