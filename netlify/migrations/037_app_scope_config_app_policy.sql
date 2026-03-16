ALTER TABLE app_scope_configs
  ADD COLUMN IF NOT EXISTS app_policy JSONB;

CREATE INDEX IF NOT EXISTS idx_app_scope_configs_app_policy_gin
  ON app_scope_configs USING GIN (app_policy)
  WHERE app_policy IS NOT NULL;
