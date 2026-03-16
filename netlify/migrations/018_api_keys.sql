-- API keys for local/external clients

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('workspace', 'environment')),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES environments(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  token_prefix VARCHAR(32) NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  last_used_ip INET,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT api_keys_scope_env_required CHECK (
    (scope_type = 'workspace' AND environment_id IS NULL)
    OR
    (scope_type = 'environment' AND environment_id IS NOT NULL)
  )
);

CREATE INDEX idx_api_keys_workspace_scope ON api_keys(workspace_id, scope_type) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_environment_scope ON api_keys(environment_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_created_by ON api_keys(created_by_user_id);
