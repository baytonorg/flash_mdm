ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'user';

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS visibility_scope VARCHAR(20) NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_type_check'
  ) THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_actor_type_check
      CHECK (actor_type IN ('user', 'system'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_visibility_scope_check'
  ) THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_visibility_scope_check
      CHECK (visibility_scope IN ('standard', 'privileged'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_env_visibility_created
  ON audit_log(environment_id, visibility_scope, created_at DESC);
