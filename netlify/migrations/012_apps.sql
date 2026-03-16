CREATE TABLE app_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  package_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  install_type VARCHAR(50) NOT NULL,
  managed_config JSONB DEFAULT '{}',
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID NOT NULL,
  auto_update_mode VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(environment_id, package_name, scope_type, scope_id)
);
CREATE INDEX idx_app_deploy_env ON app_deployments(environment_id);
CREATE INDEX idx_app_deploy_scope ON app_deployments(scope_type, scope_id);
