ALTER TABLE users ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS signup_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  slug VARCHAR(100) UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  default_role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  default_access_scope VARCHAR(20) NOT NULL DEFAULT 'workspace',
  auto_assign_environment_ids JSONB DEFAULT '[]',
  auto_assign_group_ids JSONB DEFAULT '[]',
  allow_environment_creation BOOLEAN NOT NULL DEFAULT false,
  display_name VARCHAR(255),
  display_description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_links_token ON signup_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_signup_links_slug ON signup_links(slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_links_scope ON signup_links(scope_type, scope_id);
