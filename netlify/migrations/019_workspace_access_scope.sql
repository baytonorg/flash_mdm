ALTER TABLE workspace_memberships
  ADD COLUMN IF NOT EXISTS access_scope VARCHAR(20) NOT NULL DEFAULT 'workspace';

UPDATE workspace_memberships
SET access_scope = 'workspace'
WHERE access_scope IS NULL OR access_scope = '';
