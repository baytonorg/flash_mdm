CREATE TABLE IF NOT EXISTS policy_derivatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  amapi_name VARCHAR(255),
  config JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(policy_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_policy_derivatives_policy ON policy_derivatives(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_derivatives_scope ON policy_derivatives(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_policy_derivatives_env ON policy_derivatives(environment_id);
CREATE INDEX IF NOT EXISTS idx_policy_derivatives_hash ON policy_derivatives(payload_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_derivatives_amapi_name
  ON policy_derivatives(amapi_name)
  WHERE amapi_name IS NOT NULL;
