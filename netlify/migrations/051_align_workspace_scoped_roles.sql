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
