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
