-- 047_flashagent.sql
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
