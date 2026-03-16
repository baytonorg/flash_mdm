import type { Context } from '@netlify/functions';
import pg from 'pg';
import { normalizePostgresConnectionString } from './_lib/postgres-connection.js';
import { timingSafeEqual } from 'crypto';

/**
 * Smart migration runner. Hit GET /api/migrate to apply pending migrations.
 * Tracks applied migrations in a `_migrations` table so it's safe to re-run.
 * Each migration is only applied once — already-applied migrations are skipped.
 */

// All migrations inlined (Netlify esbuild doesn't bundle .sql files)
const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: '001_foundation',
    sql: `
-- Flash MDM Foundation Schema
CREATE TABLE IF NOT EXISTS workspaces (
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

CREATE TABLE IF NOT EXISTS environments (
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
CREATE INDEX IF NOT EXISTS idx_environments_workspace ON environments(workspace_id);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  parent_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_groups_environment ON groups(environment_id);
CREATE INDEX IF NOT EXISTS idx_groups_parent ON groups(parent_group_id);

CREATE TABLE IF NOT EXISTS group_closures (
  ancestor_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  descendant_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX IF NOT EXISTS idx_gc_descendant ON group_closures(descendant_id);
CREATE INDEX IF NOT EXISTS idx_gc_depth ON group_closures(depth);

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS sessions (
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
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);
`,
  },
  {
    name: '002_rbac',
    sql: `
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ws_membership_user ON workspace_memberships(user_id);

CREATE TABLE IF NOT EXISTS environment_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(environment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_env_membership_user ON environment_memberships(user_id);

CREATE TABLE IF NOT EXISTS group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_grp_membership_user ON group_memberships(user_id);

CREATE TABLE IF NOT EXISTS user_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES environments(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  permissions JSONB DEFAULT '{}',
  invited_by UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON user_invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_token ON user_invites(token_hash);
`,
  },
  {
    name: '003_policies',
    sql: `
CREATE TABLE IF NOT EXISTS policies (
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
CREATE INDEX IF NOT EXISTS idx_policies_environment ON policies(environment_id);

CREATE TABLE IF NOT EXISTS policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  changed_by UUID REFERENCES users(id),
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policy_versions_policy ON policy_versions(policy_id, version DESC);

CREATE TABLE IF NOT EXISTS policy_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  config_fragment JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_components_environment ON policy_components(environment_id);

CREATE TABLE IF NOT EXISTS policy_component_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES policy_components(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(policy_id, component_id)
);

CREATE TABLE IF NOT EXISTS policy_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(policy_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_policy_assignments_scope ON policy_assignments(scope_type, scope_id);
`,
  },
  {
    name: '004_devices',
    sql: `
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id),
  policy_id UUID REFERENCES policies(id),
  amapi_name VARCHAR(255) NOT NULL UNIQUE,
  serial_number VARCHAR(255),
  imei VARCHAR(50),
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  os_version VARCHAR(50),
  security_patch_level VARCHAR(20),
  state VARCHAR(50),
  ownership VARCHAR(50),
  management_mode VARCHAR(50),
  policy_compliant BOOLEAN,
  applied_policy_version BIGINT,
  enrollment_time TIMESTAMPTZ,
  last_status_report_at TIMESTAMPTZ,
  last_policy_sync_at TIMESTAMPTZ,
  previous_device_names TEXT[],
  snapshot JSONB,
  license_id UUID,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devices_env ON devices(environment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(group_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial_number);
CREATE INDEX IF NOT EXISTS idx_devices_state ON devices(state);
CREATE INDEX IF NOT EXISTS idx_devices_amapi ON devices(amapi_name);

CREATE TABLE IF NOT EXISTS device_status_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  report JSONB NOT NULL,
  received_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dsr_device ON device_status_reports(device_id, received_at DESC);

CREATE TABLE IF NOT EXISTS device_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  package_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  version_name VARCHAR(100),
  version_code INTEGER,
  state VARCHAR(50),
  source VARCHAR(50),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, package_name)
);

CREATE TABLE IF NOT EXISTS device_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  source VARCHAR(50),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devloc ON device_locations(device_id, recorded_at DESC);
`,
  },
  {
    name: '005_enrollment',
    sql: `
CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id),
  policy_id UUID REFERENCES policies(id),
  name VARCHAR(255) NOT NULL,
  amapi_name VARCHAR(255),
  amapi_value TEXT,
  qr_data TEXT,
  one_time_use BOOLEAN DEFAULT false,
  allow_personal_usage VARCHAR(50),
  signin_url VARCHAR(512),
  extras JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enrollment_env ON enrollment_tokens(environment_id);
`,
  },
  {
    name: '006_events',
    sql: `
CREATE TABLE IF NOT EXISTS pubsub_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id),
  message_id VARCHAR(255) NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  device_amapi_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(environment_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_pubsub_status ON pubsub_events(status, created_at);

CREATE TABLE IF NOT EXISTS job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(100) NOT NULL,
  environment_id UUID REFERENCES environments(id),
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255),
  scheduled_for TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON job_queue(status, scheduled_for) WHERE status = 'pending';
`,
  },
  {
    name: '007_audit',
    sql: `
CREATE TABLE IF NOT EXISTS audit_log (
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
CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_env ON audit_log(environment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_device ON audit_log(device_id, created_at DESC);
`,
  },
  {
    name: '008_workflows',
    sql: `
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  trigger_type VARCHAR(50) NOT NULL,
  trigger_config JSONB DEFAULT '{}',
  conditions JSONB DEFAULT '[]',
  action_type VARCHAR(50) NOT NULL,
  action_config JSONB DEFAULT '{}',
  scope_type VARCHAR(20) DEFAULT 'environment',
  scope_id UUID,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflows_env ON workflows(environment_id);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id),
  trigger_data JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_exec_workflow ON workflow_executions(workflow_id, created_at DESC);
`,
  },
  {
    name: '009_geofences',
    sql: `
CREATE TABLE IF NOT EXISTS geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_meters DOUBLE PRECISION NOT NULL,
  polygon JSONB,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID,
  action_on_enter JSONB DEFAULT '{}',
  action_on_exit JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geofences_env ON geofences(environment_id);

CREATE TABLE IF NOT EXISTS device_geofence_state (
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  inside BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  PRIMARY KEY (device_id, geofence_id)
);
`,
  },
  {
    name: '010_licensing',
    sql: `
CREATE TABLE IF NOT EXISTS license_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  max_devices INTEGER NOT NULL,
  stripe_price_id VARCHAR(255),
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default plans (skip if already exist)
INSERT INTO license_plans (name, max_devices, features)
SELECT 'Free', 10, '{"basic_reports": true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM license_plans WHERE name = 'Free');

INSERT INTO license_plans (name, max_devices, features)
SELECT 'Pro', 100, '{"basic_reports": true, "advanced_reports": true, "workflows": true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM license_plans WHERE name = 'Pro');

INSERT INTO license_plans (name, max_devices, features)
SELECT 'Enterprise', -1, '{"basic_reports": true, "advanced_reports": true, "workflows": true, "geofencing": true, "api_access": true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM license_plans WHERE name = 'Enterprise');

CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES license_plans(id),
  stripe_subscription_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_licenses_workspace ON licenses(workspace_id);
`,
  },
  {
    name: '011_certificates',
    sql: `
CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cert_type VARCHAR(50),
  fingerprint_sha256 VARCHAR(95),
  blob_key VARCHAR(512) NOT NULL,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID,
  not_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certs_env ON certificates(environment_id);
`,
  },
  {
    name: '012_apps',
    sql: `
CREATE TABLE IF NOT EXISTS app_deployments (
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
CREATE INDEX IF NOT EXISTS idx_app_deploy_env ON app_deployments(environment_id);
CREATE INDEX IF NOT EXISTS idx_app_deploy_scope ON app_deployments(scope_type, scope_id);
`,
  },
  {
    name: '013_rate_limits',
    sql: `
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id VARCHAR(255) PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL,
  max_tokens DOUBLE PRECISION NOT NULL,
  refill_rate DOUBLE PRECISION NOT NULL,
  last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '014_session_impersonation',
    sql: `
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS impersonator_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_impersonated_by ON sessions(impersonated_by);
CREATE INDEX IF NOT EXISTS idx_sessions_impersonator_session ON sessions(impersonator_session_id);
`,
  },
  {
    name: '015_support_session_metadata',
    sql: `
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS impersonation_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS support_reason TEXT,
  ADD COLUMN IF NOT EXISTS support_ticket_ref VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_notice_acknowledged_at TIMESTAMPTZ;

UPDATE sessions
SET impersonation_mode = COALESCE(impersonation_mode, 'full')
WHERE impersonated_by IS NOT NULL;

ALTER TABLE sessions
  ALTER COLUMN impersonation_mode SET DEFAULT 'full';

CREATE INDEX IF NOT EXISTS idx_sessions_impersonation_mode ON sessions(impersonation_mode);
`,
  },
  {
    name: '016_platform_settings',
    sql: `
CREATE TABLE IF NOT EXISTS platform_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  invite_only_registration BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id, invite_only_registration)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
`,
  },
  {
    name: '017_auth_schema_compat',
    sql: `
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_pending_enc TEXT,
  ADD COLUMN IF NOT EXISTS totp_backup_codes_enc TEXT;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
`,
  },
  {
    name: '018_policy_assignment_scope',
    sql: `
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_assignments_unique_scope
  ON policy_assignments(scope_type, scope_id);
`,
  },
  {
    name: '019_workspace_access_scope',
    sql: `
ALTER TABLE workspace_memberships
  ADD COLUMN IF NOT EXISTS access_scope VARCHAR(20) NOT NULL DEFAULT 'workspace';

UPDATE workspace_memberships
SET access_scope = 'workspace'
WHERE access_scope IS NULL OR access_scope = '';
`,
  },
  {
    name: '020_network_deployments',
    sql: `
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
`,
  },
  {
    name: '021_policy_derivatives',
    sql: `
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
`,
  },
  {
    name: '022_network_deployments_network_type',
    sql: `
ALTER TABLE network_deployments ADD COLUMN IF NOT EXISTS network_type VARCHAR(10) NOT NULL DEFAULT 'wifi';
UPDATE network_deployments SET network_type = 'apn' WHERE onc_profile::text LIKE '%apnPolicy%' AND network_type = 'wifi';
`,
  },
  {
    name: '023_strip_deployment_fields_from_policy_config',
    sql: `
-- Remove deployment-managed fields (openNetworkConfiguration, deviceConnectivityManagement)
-- from policies.config. These are always regenerated from network_deployments at derivative
-- build time, and stale entries were left behind when network deployments were deleted.
UPDATE policies
SET config = config - 'openNetworkConfiguration' - 'deviceConnectivityManagement',
    updated_at = now()
WHERE config ? 'openNetworkConfiguration'
   OR config ? 'deviceConnectivityManagement';
`,
  },
  {
    name: '024_device_last_policy_sync_name',
    sql: `
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_policy_sync_name TEXT;
`,
  },
  {
    name: '025_schema_cleanup',
    sql: `
-- M6: Drop redundant constraint made meaningless by migration 018's stricter UNIQUE(scope_type, scope_id)
ALTER TABLE policy_assignments DROP CONSTRAINT IF EXISTS policy_assignments_policy_id_scope_type_scope_id_key;

-- L2: Add compound indexes for hot-path deployment lookups (environment_id + scope_type + scope_id)
CREATE INDEX IF NOT EXISTS idx_app_deploy_env_scope ON app_deployments(environment_id, scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_network_deploy_env_scope ON network_deployments(environment_id, scope_type, scope_id);

-- L3: Replace unique constraint to include network_type, preventing APN/WiFi key collisions
-- Drop any existing unique constraint/index on the old key (without network_type)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'network_deployments_environment_id_ssid_scope_type_scope_id_key') THEN
    ALTER TABLE network_deployments DROP CONSTRAINT network_deployments_environment_id_ssid_scope_type_scope_id_key;
  END IF;
END $$;
DROP INDEX IF EXISTS network_deployments_environment_id_ssid_scope_type_scope_id_key;

-- Deduplicate before creating unique index: keep the most recently updated row per key
DELETE FROM network_deployments a
USING network_deployments b
WHERE a.environment_id = b.environment_id
  AND a.network_type = b.network_type
  AND a.ssid = b.ssid
  AND a.scope_type = b.scope_type
  AND a.scope_id = b.scope_id
  AND a.id <> b.id
  AND a.updated_at < b.updated_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_network_deploy_unique_scope
  ON network_deployments(environment_id, network_type, ssid, scope_type, scope_id);

-- M7: policy_derivatives.scope_id is polymorphic (references groups, devices, or environments
-- depending on scope_type). A standard FK cannot be used. Cleanup is handled by cascade logic
-- in group-crud.ts (group deletion) and device-get.ts (device soft-delete).
`,
  },
  {
    name: '026_device_name',
    sql: `
ALTER TABLE devices ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- Backfill existing devices: Model_SerialNumber or Model_AMAPI-suffix
UPDATE devices SET name = CONCAT(
  COALESCE(model, 'Device'),
  '_',
  COALESCE(serial_number, REVERSE(SPLIT_PART(REVERSE(amapi_name), '/', 1)))
) WHERE name IS NULL;
`,
  },
  {
    name: '027_policy_overrides_and_locks',
    sql: `
-- ── 2A. Lock fields on policy_assignments ────────────────────────────────
-- Locks control editability of inherited policy config (not assignment).
-- A child group can always assign a different policy even when locked.
ALTER TABLE policy_assignments
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_sections TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS locked_by UUID,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- ── 2B. Group policy overrides ──────────────────────────────────────────
-- Sparse override configs for groups that inherit a policy but want to
-- customise unlocked sections. Deep-merged during derivative generation.
CREATE TABLE IF NOT EXISTS group_policy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  override_config JSONB NOT NULL DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, policy_id)
);
CREATE INDEX IF NOT EXISTS idx_group_policy_overrides_group ON group_policy_overrides(group_id);
CREATE INDEX IF NOT EXISTS idx_group_policy_overrides_policy ON group_policy_overrides(policy_id);

-- ── 2C. Device policy overrides ─────────────────────────────────────────
-- Sparse override configs for individual devices. Merged last (highest
-- priority) during derivative generation. Individually toggleable/reversible.
CREATE TABLE IF NOT EXISTS device_policy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  override_config JSONB NOT NULL DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, policy_id)
);
CREATE INDEX IF NOT EXISTS idx_device_policy_overrides_device ON device_policy_overrides(device_id);
CREATE INDEX IF NOT EXISTS idx_device_policy_overrides_policy ON device_policy_overrides(policy_id);
`,
  },
  {
    name: '028_deployment_jobs',
    sql: `
-- ── Deployment Jobs ──────────────────────────────────────────────────────
-- Tracks batch deployments of policy derivatives to devices.
-- Supports progress tracking, cancellation, and rollback.
CREATE TABLE IF NOT EXISTS deployment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  total_devices INTEGER NOT NULL DEFAULT 0,
  completed_devices INTEGER NOT NULL DEFAULT 0,
  failed_devices INTEGER NOT NULL DEFAULT 0,
  skipped_devices INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  error_log JSONB DEFAULT '[]',
  rollback_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_jobs_env ON deployment_jobs(environment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_jobs_policy ON deployment_jobs(policy_id);
CREATE INDEX IF NOT EXISTS idx_deployment_jobs_status ON deployment_jobs(status);
`,
  },
  {
    name: '029_app_model_rework',
    sql: `
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
`,
  },
  {
    name: '030_default_policy_backfill',
    sql: `
-- Backfill a default safety-net policy for every environment that doesn't have one.
-- Mirrors the logic added to environment-crud.ts for new environments.
INSERT INTO policies (id, environment_id, name, description, deployment_scenario, config, status)
SELECT
  gen_random_uuid(),
  e.id,
  'Default',
  'Default safety-net policy applied when no group policy is assigned',
  'fm',
  '{}',
  CASE WHEN e.enterprise_name IS NOT NULL THEN 'production' ELSE 'draft' END
FROM environments e
WHERE NOT EXISTS (
  SELECT 1 FROM policies p WHERE p.environment_id = e.id AND p.name = 'Default'
);

-- Create version 1 for each newly backfilled default policy.
INSERT INTO policy_versions (id, policy_id, version, config)
SELECT gen_random_uuid(), p.id, 1, '{}'
FROM policies p
WHERE p.name = 'Default'
  AND NOT EXISTS (SELECT 1 FROM policy_versions pv WHERE pv.policy_id = p.id);

-- Assign each default policy at the environment scope.
-- ON CONFLICT handles environments that already have an environment-scoped assignment.
INSERT INTO policy_assignments (id, policy_id, scope_type, scope_id)
SELECT gen_random_uuid(), p.id, 'environment', p.environment_id
FROM policies p
WHERE p.name = 'Default'
  AND NOT EXISTS (
    SELECT 1 FROM policy_assignments pa
    WHERE pa.policy_id = p.id AND pa.scope_type = 'environment' AND pa.scope_id = p.environment_id
  )
ON CONFLICT (scope_type, scope_id) DO NOTHING;
`,
  },
  {
    name: '031_workspace_default_pubsub_topic',
    sql: `
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_pubsub_topic VARCHAR(512);
`,
  },
  {
    name: '032_signup_links',
    sql: `
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
`,
  },
  {
    name: '033_signin_enrollment',
    sql: `
-- Sign-in URL enrollment configuration per environment
CREATE TABLE IF NOT EXISTS signin_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  default_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  allow_personal_usage VARCHAR(50) NOT NULL DEFAULT 'PERSONAL_USAGE_ALLOWED',
  token_tag VARCHAR(255),
  amapi_signin_enrollment_token TEXT,
  amapi_qr_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(environment_id)
);

-- Short-lived email verification codes for sign-in enrollment
CREATE TABLE IF NOT EXISTS signin_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  provisioning_info TEXT,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signin_verifications_lookup
  ON signin_verifications(environment_id, email, expires_at);
`,
  },
  {
    name: '034_signup_links_allowed_domains',
    sql: `
ALTER TABLE signup_links
  ADD COLUMN IF NOT EXISTS allowed_domains TEXT[] NOT NULL DEFAULT '{}';
`,
  },
  {
    name: '035_api_keys',
    sql: `
CREATE TABLE IF NOT EXISTS api_keys (
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

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_scope
  ON api_keys(workspace_id, scope_type)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_environment_scope
  ON api_keys(environment_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by_user_id);
`,
  },
  {
    name: '036_audit_log_actor_visibility',
    sql: `
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'user';

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS visibility_scope VARCHAR(20) NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_type_check'
  ) THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_actor_type_check
      CHECK (actor_type IN ('user', 'system'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_visibility_scope_check'
  ) THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_visibility_scope_check
      CHECK (visibility_scope IN ('standard', 'privileged'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_env_visibility_created
  ON audit_log(environment_id, visibility_scope, created_at DESC);
`,
  },
  {
    name: '037_app_scope_config_app_policy',
    sql: `
ALTER TABLE app_scope_configs
  ADD COLUMN IF NOT EXISTS app_policy JSONB;

CREATE INDEX IF NOT EXISTS idx_app_scope_configs_app_policy_gin
  ON app_scope_configs USING GIN (app_policy)
  WHERE app_policy IS NOT NULL;
`,
  },
  {
    name: '038_audit_log_api_key_actor',
    sql: `
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL;

ALTER TABLE audit_log
  DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('user', 'system', 'api_key'));

CREATE INDEX IF NOT EXISTS idx_audit_api_key
  ON audit_log(api_key_id, created_at DESC);
`,
  },
  {
    name: '039_workflow_scope_environment_enforcement',
    sql: `
-- Normalize invalid group/device scopes to environment-wide scope.
-- Invalid means missing scope_id, cross-environment target, or deleted/non-existent target.
UPDATE workflows w
SET scope_type = 'environment',
    scope_id = NULL,
    updated_at = now()
WHERE (
  w.scope_type = 'group'
  AND (
    w.scope_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM groups g
      WHERE g.id = w.scope_id
        AND g.environment_id = w.environment_id
    )
  )
)
OR (
  w.scope_type = 'device'
  AND (
    w.scope_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM devices d
      WHERE d.id = w.scope_id
        AND d.environment_id = w.environment_id
        AND d.deleted_at IS NULL
    )
  )
);
`,
  },
  {
    name: '040_api_keys_optional_expiry',
    sql: `
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_expires_active
  ON api_keys(expires_at)
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
`,
  },
  {
    name: '041_two_tier_licensing',
    sql: `
CREATE TABLE IF NOT EXISTS workspace_licensing_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  free_enabled BOOLEAN NOT NULL DEFAULT true,
  free_seat_limit INTEGER NOT NULL DEFAULT 10,
  billing_method VARCHAR(20) NOT NULL DEFAULT 'stripe',
  customer_owner_enabled BOOLEAN NOT NULL DEFAULT false,
  grace_day_block INTEGER NOT NULL DEFAULT 10,
  grace_day_disable INTEGER NOT NULL DEFAULT 30,
  grace_day_wipe INTEGER NOT NULL DEFAULT 45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS license_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source VARCHAR(40) NOT NULL,
  seat_count INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  external_ref VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_license_grants_workspace
  ON license_grants(workspace_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  due_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  source VARCHAR(50),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_workspace
  ON billing_invoices(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_amount_cents INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_billing_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'disabled',
  stripe_secret_key_enc TEXT,
  stripe_webhook_secret_enc TEXT,
  stripe_publishable_key VARCHAR(255),
  default_currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  default_pricing_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_pricing_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  seat_price_cents INTEGER NOT NULL,
  duration_months INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255),
  email VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  pricing_id UUID REFERENCES workspace_pricing_catalog(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(environment_id)
);

CREATE TABLE IF NOT EXISTS environment_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  seat_count INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  external_ref VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_environment_entitlements_env
  ON environment_entitlements(environment_id, status, starts_at DESC);

CREATE TABLE IF NOT EXISTS workspace_billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source VARCHAR(30) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source, event_id)
);

CREATE TABLE IF NOT EXISTS license_overage_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  phase VARCHAR(20) NOT NULL DEFAULT 'warn',
  overage_peak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_license_overage_cases_env_open
  ON license_overage_cases(environment_id, started_at DESC)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS license_enforcement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES license_overage_cases(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  reason TEXT,
  executed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_enforcement_actions_dedupe
  ON license_enforcement_actions(case_id, device_id, action);
`,
  },
  {
    name: '042_licensing_hardening',
    sql: `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_licensing_settings_grace_order_check'
  ) THEN
    ALTER TABLE workspace_licensing_settings
      ADD CONSTRAINT workspace_licensing_settings_grace_order_check
      CHECK (
        grace_day_block >= 0
        AND grace_day_block < grace_day_disable
        AND grace_day_disable < grace_day_wipe
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_licensing_settings_free_seat_limit_check'
  ) THEN
    ALTER TABLE workspace_licensing_settings
      ADD CONSTRAINT workspace_licensing_settings_free_seat_limit_check
      CHECK (free_seat_limit >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_grants_seat_count_check'
  ) THEN
    ALTER TABLE license_grants
      ADD CONSTRAINT license_grants_seat_count_check
      CHECK (seat_count > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_entitlements_seat_count_check'
  ) THEN
    ALTER TABLE environment_entitlements
      ADD CONSTRAINT environment_entitlements_seat_count_check
      CHECK (seat_count > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_pricing_catalog_amount_check'
  ) THEN
    ALTER TABLE workspace_pricing_catalog
      ADD CONSTRAINT workspace_pricing_catalog_amount_check
      CHECK (seat_price_cents >= 0 AND duration_months > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_invoice_items_amount_check'
  ) THEN
    ALTER TABLE billing_invoice_items
      ADD CONSTRAINT billing_invoice_items_amount_check
      CHECK (quantity > 0 AND unit_amount_cents >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_billing_settings_default_pricing_fk'
  ) THEN
    ALTER TABLE workspace_billing_settings
      ADD CONSTRAINT workspace_billing_settings_default_pricing_fk
      FOREIGN KEY (default_pricing_id) REFERENCES workspace_pricing_catalog(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_license_grants_workspace_source_external_ref
  ON license_grants(workspace_id, source, external_ref)
  WHERE external_ref IS NOT NULL;

WITH ranked_open_cases AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY environment_id
           ORDER BY started_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM license_overage_cases
  WHERE resolved_at IS NULL
)
UPDATE license_overage_cases c
SET resolved_at = now(),
    phase = 'resolved',
    updated_at = now()
FROM ranked_open_cases r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_license_overage_cases_single_open
  ON license_overage_cases(environment_id)
  WHERE resolved_at IS NULL;
`,
  },
  {
    name: '043_licensing_free_tier_notifications',
    sql: `
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS default_free_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS default_free_seat_limit INTEGER NOT NULL DEFAULT 10;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS licensing_enabled BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_default_free_seat_limit_check'
  ) THEN
    ALTER TABLE platform_settings
      ADD CONSTRAINT platform_settings_default_free_seat_limit_check
      CHECK (default_free_seat_limit >= 0 AND default_free_seat_limit <= 1000000);
  END IF;
END $$;

ALTER TABLE workspace_licensing_settings
  ADD COLUMN IF NOT EXISTS inherit_platform_free_tier BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE workspace_licensing_settings
  ADD COLUMN IF NOT EXISTS licensing_enabled BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_licensing_settings_free_seat_limit_max_check'
  ) THEN
    ALTER TABLE workspace_licensing_settings
      ADD CONSTRAINT workspace_licensing_settings_free_seat_limit_max_check
      CHECK (free_seat_limit <= 1000000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS license_overage_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES license_overage_cases(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  notification_key VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(case_id, notification_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_overage_notifications_status_check'
  ) THEN
    ALTER TABLE license_overage_notifications
      ADD CONSTRAINT license_overage_notifications_status_check
      CHECK (status IN ('queued', 'sent', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_license_overage_notifications_workspace
  ON license_overage_notifications(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_license_overage_notifications_status
  ON license_overage_notifications(status, created_at DESC);
`,
  },
  {
    name: '044_licensing_enable_switch',
    sql: `
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS licensing_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE workspace_licensing_settings
  ADD COLUMN IF NOT EXISTS licensing_enabled BOOLEAN NOT NULL DEFAULT true;
`,
  },
  {
    name: '045_billing_notifications',
    sql: `
CREATE TABLE IF NOT EXISTS workspace_billing_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES environments(id) ON DELETE CASCADE,
  notification_type VARCHAR(60) NOT NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, dedupe_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_billing_notifications_status_check'
  ) THEN
    ALTER TABLE workspace_billing_notifications
      ADD CONSTRAINT workspace_billing_notifications_status_check
      CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspace_billing_notifications_workspace
  ON workspace_billing_notifications(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_notifications_status
  ON workspace_billing_notifications(status, created_at DESC);
`,
  },
  {
    name: '046_workspace_billing_customer_defaults',
    sql: `
ALTER TABLE workspace_billing_settings
  ADD COLUMN IF NOT EXISTS billing_contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS billing_business_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255);
`,
  },
  {
    name: '047_flashagent',
    sql: `
-- Flashi AI Chat Assistant: platform toggle + chat history table

-- Platform toggle (global kill switch, default off for dark launch)
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS assistant_enabled BOOLEAN NOT NULL DEFAULT false;

-- Chat history scoped per environment + user
CREATE TABLE IF NOT EXISTS flashagent_chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id  UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text            TEXT NOT NULL CHECK (length(text) <= 16000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flashagent_chat_env_user_time
  ON flashagent_chat_messages(environment_id, user_id, created_at);

-- Index for CASCADE delete performance on workspace deletion
CREATE INDEX IF NOT EXISTS idx_flashagent_chat_workspace_id
  ON flashagent_chat_messages(workspace_id);
`,
  },
  {
    name: '048_aer_zero_touch_and_app_feedback',
    sql: `
CREATE TABLE IF NOT EXISTS app_feedback_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  device_amapi_name VARCHAR(255),
  package_name VARCHAR(255) NOT NULL,
  feedback_key VARCHAR(255) NOT NULL,
  severity VARCHAR(50),
  message TEXT,
  data_json JSONB,
  first_reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_update_time TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_device
  ON app_feedback_items(environment_id, device_id, package_name, feedback_key)
  WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_fleet
  ON app_feedback_items(environment_id, package_name, feedback_key)
  WHERE device_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_last ON app_feedback_items(environment_id, last_reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_severity ON app_feedback_items(environment_id, severity);
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_package ON app_feedback_items(environment_id, package_name);
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_status ON app_feedback_items(environment_id, status);

CREATE TABLE IF NOT EXISTS app_feedback_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity_filter JSONB NOT NULL DEFAULT '[]'::jsonb,
  package_filter JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback_key_filter JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_mode VARCHAR(20) NOT NULL DEFAULT 'immediate',
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_feedback_sub_env_user ON app_feedback_subscriptions(environment_id, user_id);

CREATE TABLE IF NOT EXISTS app_feedback_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES app_feedback_subscriptions(id) ON DELETE SET NULL,
  feedback_item_id UUID REFERENCES app_feedback_items(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_app_feedback_delivery_env ON app_feedback_delivery_log(environment_id, created_at DESC);
`,
  },
  {
    name: '049_app_feedback_unique_null_handling',
    sql: `
WITH ranked_null_device_rows AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY environment_id, package_name, feedback_key
      ORDER BY last_reported_at DESC, updated_at DESC, created_at DESC, id DESC
    ) AS rank_num
  FROM app_feedback_items
  WHERE device_id IS NULL
)
DELETE FROM app_feedback_items
WHERE id IN (
  SELECT id
  FROM ranked_null_device_rows
  WHERE rank_num > 1
);

ALTER TABLE app_feedback_items
  DROP CONSTRAINT IF EXISTS app_feedback_items_environment_id_device_id_package_name_feedback_key_key;

DROP INDEX IF EXISTS idx_app_feedback_unique_device;
DROP INDEX IF EXISTS idx_app_feedback_unique_fleet;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_device
  ON app_feedback_items(environment_id, device_id, package_name, feedback_key)
  WHERE device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_fleet
  ON app_feedback_items(environment_id, package_name, feedback_key)
  WHERE device_id IS NULL;
`,
  },
  {
    name: '050_signup_links_purpose',
    sql: `
ALTER TABLE signup_links
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'standard';

ALTER TABLE signup_links
  DROP CONSTRAINT IF EXISTS signup_links_purpose_check;

ALTER TABLE signup_links
  ADD CONSTRAINT signup_links_purpose_check
  CHECK (purpose IN ('standard', 'customer'));

DROP INDEX IF EXISTS idx_signup_links_scope;
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_links_scope
  ON signup_links(scope_type, scope_id, purpose);
`,
  },
  {
    name: '051_align_workspace_scoped_roles',
    sql: `
WITH membership_role_rank AS (
  SELECT
    wm.workspace_id,
    wm.user_id,
    GREATEST(
      CASE wm.role
        WHEN 'owner' THEN 100
        WHEN 'admin' THEN 75
        WHEN 'member' THEN 50
        WHEN 'viewer' THEN 25
        ELSE 0
      END,
      COALESCE(MAX(CASE em.role
        WHEN 'owner' THEN 100
        WHEN 'admin' THEN 75
        WHEN 'member' THEN 50
        WHEN 'viewer' THEN 25
        ELSE 0
      END), 0),
      COALESCE(MAX(CASE gm.role
        WHEN 'owner' THEN 100
        WHEN 'admin' THEN 75
        WHEN 'member' THEN 50
        WHEN 'viewer' THEN 25
        ELSE 0
      END), 0)
    ) AS max_role_rank
  FROM workspace_memberships wm
  LEFT JOIN environments e
    ON e.workspace_id = wm.workspace_id
  LEFT JOIN environment_memberships em
    ON em.environment_id = e.id
   AND em.user_id = wm.user_id
  LEFT JOIN groups g
    ON g.environment_id = e.id
  LEFT JOIN group_memberships gm
    ON gm.group_id = g.id
   AND gm.user_id = wm.user_id
  GROUP BY wm.workspace_id, wm.user_id, wm.role
),
resolved_roles AS (
  SELECT
    workspace_id,
    user_id,
    CASE max_role_rank
      WHEN 100 THEN 'owner'
      WHEN 75 THEN 'admin'
      WHEN 50 THEN 'member'
      WHEN 25 THEN 'viewer'
      ELSE 'viewer'
    END AS resolved_role
  FROM membership_role_rank
)
UPDATE workspace_memberships wm
SET role = rr.resolved_role
FROM resolved_roles rr
WHERE wm.workspace_id = rr.workspace_id
  AND wm.user_id = rr.user_id
  AND wm.role <> rr.resolved_role;
`,
  },
  {
    name: '052_signup_links_slug_unique',
    sql: `
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_links_slug_unique
  ON signup_links(slug)
  WHERE slug IS NOT NULL;
`,
  },
  {
    name: '053_totp_pending_created_at',
    sql: `
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_pending_created_at TIMESTAMPTZ;
`,
  },
];

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Require migration secret for authentication
  const migrationSecret = process.env.MIGRATION_SECRET;
  if (!migrationSecret) {
    return Response.json(
      { error: 'MIGRATION_SECRET environment variable is not configured' },
      { status: 500 }
    );
  }

  const providedSecret = request.headers.get('x-migration-secret') ?? '';
  // Timing-safe comparison (constant-time even on length mismatch)
  const expected = Buffer.from(migrationSecret, 'utf8');
  const provided = Buffer.from(providedSecret, 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return Response.json(
      { error: 'Unauthorized', hint: 'Provide the MIGRATION_SECRET value in the x-migration-secret header.' },
      { status: 401 }
    );
  }

  const connectionString = normalizePostgresConnectionString(
    process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL
  );
  if (!connectionString) {
    return Response.json(
      { error: 'No DATABASE_URL or NETLIFY_DATABASE_URL configured' },
      { status: 500 }
    );
  }

  const client = new pg.Client({
    connectionString,
    ssl: process.env.NODE_ENV === 'development' ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
  });

  try {
    await client.connect();

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Get already-applied migrations
    const applied = await client.query('SELECT name FROM _migrations ORDER BY name');
    const appliedSet = new Set(applied.rows.map((r: { name: string }) => r.name));

    const results: Array<{ name: string; status: string; error?: string }> = [];

    for (const migration of MIGRATIONS) {
      if (appliedSet.has(migration.name)) {
        results.push({ name: migration.name, status: 'skipped (already applied)' });
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO _migrations (name) VALUES ($1)',
          [migration.name]
        );
        await client.query('COMMIT');
        results.push({ name: migration.name, status: 'applied' });
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        const message = err instanceof Error ? err.message : String(err);
        results.push({ name: migration.name, status: 'error', error: message });
        // Stop on first error — don't apply later migrations that may depend on this one
        break;
      }
    }

    const appliedCount = results.filter((r) => r.status === 'applied').length;
    const skippedCount = results.filter((r) => r.status.startsWith('skipped')).length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    return Response.json({
      summary: {
        total: MIGRATIONS.length,
        applied: appliedCount,
        skipped: skippedCount,
        errors: errorCount,
      },
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Connection failed: ${message}` }, { status: 500 });
  } finally {
    await client.end();
  }
}
