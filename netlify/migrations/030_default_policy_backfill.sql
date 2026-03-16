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
