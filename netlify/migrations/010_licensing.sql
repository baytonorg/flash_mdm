CREATE TABLE license_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  max_devices INTEGER NOT NULL,
  stripe_price_id VARCHAR(255),
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default plans
INSERT INTO license_plans (name, max_devices, features) VALUES
  ('Free', 10, '{"basic_reports": true}'),
  ('Pro', 100, '{"basic_reports": true, "advanced_reports": true, "workflows": true}'),
  ('Enterprise', -1, '{"basic_reports": true, "advanced_reports": true, "workflows": true, "geofencing": true, "api_access": true}');

CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES license_plans(id),
  stripe_subscription_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_licenses_workspace ON licenses(workspace_id);
