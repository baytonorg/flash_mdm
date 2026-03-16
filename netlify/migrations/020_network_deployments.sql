CREATE TABLE IF NOT EXISTS network_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  ssid VARCHAR(255) NOT NULL,
  hidden_ssid BOOLEAN NOT NULL DEFAULT false,
  auto_connect BOOLEAN NOT NULL DEFAULT true,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID NOT NULL,
  onc_profile JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(environment_id, ssid, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_network_deploy_env ON network_deployments(environment_id);
CREATE INDEX IF NOT EXISTS idx_network_deploy_scope ON network_deployments(scope_type, scope_id);
