-- Creator provenance must not be a dependency of a resource-owned service key.
-- NULL preserves legacy single-scope offers without rewriting token records.
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS environment_ids JSONB;
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS group_ids JSONB;
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_created_by_user_id_fkey;
ALTER TABLE api_keys ALTER COLUMN created_by_user_id DROP NOT NULL;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Chat belongs to the authenticated principal, never to the key creator.
ALTER TABLE flashagent_chat_messages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE flashagent_chat_messages ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE;
ALTER TABLE flashagent_chat_messages ADD CONSTRAINT flashagent_chat_principal_check
  CHECK ((user_id IS NOT NULL) <> (api_key_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_flashagent_chat_env_key_time
  ON flashagent_chat_messages(environment_id, api_key_id, created_at);

-- Serialise every seat writer, including bootstrap and legacy entry points.
CREATE OR REPLACE FUNCTION lock_membership_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM workspaces WHERE id = COALESCE(NEW.workspace_id, OLD.workspace_id) FOR UPDATE;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER membership_workspace_lock BEFORE INSERT OR UPDATE OR DELETE ON workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION lock_membership_workspace();

-- Deferred: a transfer/bootstrap can establish its final owner in one transaction.
-- Scope deletion has no transfer requirement because the workspace no longer exists.
CREATE OR REPLACE FUNCTION check_membership_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID := COALESCE(NEW.workspace_id, OLD.workspace_id);
BEGIN
  IF EXISTS (SELECT 1 FROM workspaces WHERE id = target)
    AND NOT EXISTS (SELECT 1 FROM workspace_memberships WHERE workspace_id = target AND role = 'owner' AND access_scope = 'workspace')
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A surviving workspace requires a workspace-wide owner', CONSTRAINT = 'workspace_surviving_owner';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER membership_workspace_owner AFTER INSERT OR UPDATE OR DELETE ON workspace_memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_membership_workspace_owner();
