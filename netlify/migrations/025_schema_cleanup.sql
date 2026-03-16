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
