CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  environment_id UUID REFERENCES environments(id),
  user_id UUID REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_ws ON audit_log(workspace_id, created_at DESC);
CREATE INDEX idx_audit_env ON audit_log(environment_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_device ON audit_log(device_id, created_at DESC);
