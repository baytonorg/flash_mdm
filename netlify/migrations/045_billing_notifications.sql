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
