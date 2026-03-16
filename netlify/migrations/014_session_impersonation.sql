ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS impersonator_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_impersonated_by ON sessions(impersonated_by);
CREATE INDEX IF NOT EXISTS idx_sessions_impersonator_session ON sessions(impersonator_session_id);
