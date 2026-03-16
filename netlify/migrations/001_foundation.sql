-- Flash MDM Foundation Schema
-- Workspaces, Environments, Groups, Group Closures, Users, Sessions

-- WORKSPACES (map to GCP projects)
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  gcp_project_id VARCHAR(255),
  google_credentials_enc TEXT,
  google_auth_mode VARCHAR(20) DEFAULT 'service_account',
  stripe_customer_id VARCHAR(255),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ENVIRONMENTS (map to AMAPI enterprises)
CREATE TABLE environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  enterprise_name VARCHAR(255),
  enterprise_display_name VARCHAR(255),
  pubsub_topic VARCHAR(512),
  enterprise_features JSONB DEFAULT '{}',
  signup_url_name VARCHAR(512),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_environments_workspace ON environments(workspace_id);

-- GROUPS (hierarchical org units)
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  parent_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_groups_environment ON groups(environment_id);
CREATE INDEX idx_groups_parent ON groups(parent_group_id);

-- CLOSURE TABLE for efficient hierarchy queries
CREATE TABLE group_closures (
  ancestor_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  descendant_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX idx_gc_descendant ON group_closures(descendant_id);
CREATE INDEX idx_gc_depth ON group_closures(depth);

-- USERS
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255),
  totp_secret_enc TEXT,
  totp_pending_enc TEXT,
  totp_backup_codes_enc TEXT,
  totp_enabled BOOLEAN DEFAULT false,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  is_superadmin BOOLEAN DEFAULT false,
  last_login_at TIMESTAMPTZ,
  last_login_ip VARCHAR(45),
  last_login_method VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- SESSIONS
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(64) UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  environment_id UUID REFERENCES environments(id) ON DELETE SET NULL,
  active_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- MAGIC LINKS
CREATE TABLE magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_magic_links_token ON magic_links(token_hash);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
