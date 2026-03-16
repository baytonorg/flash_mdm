-- Policies, Components, Versions, Assignments

CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  deployment_scenario VARCHAR(20) NOT NULL DEFAULT 'fm',
  config JSONB NOT NULL DEFAULT '{}',
  amapi_name VARCHAR(255),
  version INTEGER DEFAULT 1,
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_policies_environment ON policies(environment_id);

CREATE TABLE policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  changed_by UUID REFERENCES users(id),
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_policy_versions_policy ON policy_versions(policy_id, version DESC);

CREATE TABLE policy_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  config_fragment JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_components_environment ON policy_components(environment_id);

CREATE TABLE policy_component_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES policy_components(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(policy_id, component_id)
);

CREATE TABLE policy_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(policy_id, scope_type, scope_id)
);
CREATE INDEX idx_policy_assignments_scope ON policy_assignments(scope_type, scope_id);
