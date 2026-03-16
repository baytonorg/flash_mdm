-- ── App Model Rework ──────────────────────────────────────────────────
-- Separates "import an app" from "configure an app per scope".
-- apps: one row per package per environment (the catalog entry).
-- app_scope_configs: per-scope configuration for each app.

CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  package_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  default_install_type VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
  default_auto_update_mode VARCHAR(50) NOT NULL DEFAULT 'AUTO_UPDATE_DEFAULT',
  default_managed_config JSONB DEFAULT '{}',
  icon_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(environment_id, package_name)
);
CREATE INDEX IF NOT EXISTS idx_apps_env ON apps(environment_id);

CREATE TABLE IF NOT EXISTS app_scope_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID NOT NULL,
  install_type VARCHAR(50),
  auto_update_mode VARCHAR(50),
  managed_config JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(app_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_app_scope_configs_app ON app_scope_configs(app_id);
CREATE INDEX IF NOT EXISTS idx_app_scope_configs_scope ON app_scope_configs(scope_type, scope_id);

-- Migrate existing app_deployments data into the new tables.
-- Create one apps row per distinct (environment_id, package_name).
INSERT INTO apps (environment_id, package_name, display_name, default_install_type, default_auto_update_mode, default_managed_config, created_at, updated_at)
SELECT DISTINCT ON (environment_id, package_name)
  environment_id,
  package_name,
  COALESCE(display_name, package_name),
  install_type,
  COALESCE(auto_update_mode, 'AUTO_UPDATE_DEFAULT'),
  COALESCE(managed_config, '{}'),
  created_at,
  updated_at
FROM app_deployments
ORDER BY environment_id, package_name, updated_at DESC
ON CONFLICT (environment_id, package_name) DO NOTHING;

-- Create per-scope configs from existing deployments.
INSERT INTO app_scope_configs (app_id, environment_id, scope_type, scope_id, install_type, auto_update_mode, managed_config, created_at, updated_at)
SELECT
  a.id,
  ad.environment_id,
  ad.scope_type,
  ad.scope_id,
  ad.install_type,
  ad.auto_update_mode,
  ad.managed_config,
  ad.created_at,
  ad.updated_at
FROM app_deployments ad
JOIN apps a ON a.environment_id = ad.environment_id AND a.package_name = ad.package_name
ON CONFLICT (app_id, scope_type, scope_id) DO NOTHING;
