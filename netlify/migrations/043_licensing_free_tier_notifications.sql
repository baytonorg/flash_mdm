ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS default_free_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS default_free_seat_limit INTEGER NOT NULL DEFAULT 10;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS licensing_enabled BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_default_free_seat_limit_check'
  ) THEN
    ALTER TABLE platform_settings
      ADD CONSTRAINT platform_settings_default_free_seat_limit_check
      CHECK (default_free_seat_limit >= 0 AND default_free_seat_limit <= 1000000);
  END IF;
END $$;

ALTER TABLE workspace_licensing_settings
  ADD COLUMN IF NOT EXISTS inherit_platform_free_tier BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE workspace_licensing_settings
  ADD COLUMN IF NOT EXISTS licensing_enabled BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_licensing_settings_free_seat_limit_max_check'
  ) THEN
    ALTER TABLE workspace_licensing_settings
      ADD CONSTRAINT workspace_licensing_settings_free_seat_limit_max_check
      CHECK (free_seat_limit <= 1000000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS license_overage_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES license_overage_cases(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  notification_key VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(case_id, notification_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_overage_notifications_status_check'
  ) THEN
    ALTER TABLE license_overage_notifications
      ADD CONSTRAINT license_overage_notifications_status_check
      CHECK (status IN ('queued', 'sent', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_license_overage_notifications_workspace
  ON license_overage_notifications(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_license_overage_notifications_status
  ON license_overage_notifications(status, created_at DESC);
