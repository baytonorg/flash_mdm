-- Preserve stricter legacy write branches when introducing one assignment floor.
-- Only existing matrix overrides missing policy.assign are changed. Credential
-- records and absent environment overrides are never touched.
UPDATE workspaces
SET settings = jsonb_set(
  jsonb_set(settings, '{rbac,permission_matrix,policy}',
    CASE WHEN jsonb_typeof(settings #> '{rbac,permission_matrix,policy}') = 'object'
      THEN settings #> '{rbac,permission_matrix,policy}' ELSE '{}'::jsonb END
    || jsonb_build_object('assign', CASE
      WHEN settings #>> '{rbac,permission_matrix,policy,write}' = 'owner'
        OR settings #>> '{rbac,permission_matrix,group,write}' = 'owner'
      THEN 'owner' ELSE 'admin' END)),
  '{rbac,assignment_permission_migration}', '60'::jsonb)
WHERE jsonb_typeof(settings #> '{rbac,permission_matrix}') = 'object'
  AND NOT COALESCE((settings #> '{rbac,permission_matrix,policy}') ? 'assign', false);

UPDATE environments AS e
SET enterprise_features = jsonb_set(
  jsonb_set(e.enterprise_features, '{rbac,permission_matrix,policy}',
    CASE WHEN jsonb_typeof(e.enterprise_features #> '{rbac,permission_matrix,policy}') = 'object'
      THEN e.enterprise_features #> '{rbac,permission_matrix,policy}' ELSE '{}'::jsonb END
    || jsonb_build_object('assign', CASE
      WHEN e.enterprise_features #>> '{rbac,permission_matrix,policy,write}' = 'owner'
        OR w.settings #>> '{rbac,permission_matrix,policy,assign}' = 'owner'
        OR w.settings #>> '{rbac,permission_matrix,group,write}' = 'owner'
      THEN 'owner' ELSE 'admin' END)),
  '{rbac,assignment_permission_migration}', '60'::jsonb)
FROM workspaces AS w
WHERE w.id = e.workspace_id
  AND jsonb_typeof(e.enterprise_features #> '{rbac,permission_matrix}') = 'object'
  AND NOT COALESCE((e.enterprise_features #> '{rbac,permission_matrix,policy}') ? 'assign', false);
