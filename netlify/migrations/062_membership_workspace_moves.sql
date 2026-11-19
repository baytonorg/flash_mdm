-- Keep the installed triggers and replace their functions on existing databases.
CREATE OR REPLACE FUNCTION lock_membership_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- All seat writers take conflicting locks in workspace UUID order. Foreign
  -- keys on unrelated child rows may already hold KEY SHARE on either parent.
  PERFORM w.id FROM workspaces w
    WHERE w.id IN (OLD.workspace_id, NEW.workspace_id)
    ORDER BY w.id FOR NO KEY UPDATE;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION check_membership_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  workspace UUID;
  owner_seat UUID;
BEGIN
  -- At deferred check time a moved seat affects both surviving workspaces.
  FOR workspace IN SELECT w.id FROM workspaces w
    WHERE w.id IN (OLD.workspace_id, NEW.workspace_id) ORDER BY w.id
  LOOP
    SELECT m.id INTO owner_seat FROM workspace_memberships m
      WHERE m.workspace_id = workspace AND m.role = 'owner' AND m.access_scope = 'workspace'
      ORDER BY m.id LIMIT 1;
    IF owner_seat IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A surviving workspace requires a workspace-wide owner',
        CONSTRAINT = 'workspace_surviving_owner';
    END IF;
    -- A fixed transaction snapshot can still see an owner changed by a writer
    -- that committed before we acquired the workspace lock. Verify the tuple
    -- version or let PostgreSQL reject the stale transaction. Avoid waiting for
    -- a seat writer that could itself be waiting on our workspace lock.
    IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
      PERFORM id FROM workspace_memberships WHERE id = owner_seat FOR SHARE NOWAIT;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
