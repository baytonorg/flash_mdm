-- ── Deployment Jobs ──────────────────────────────────────────────────────
-- Tracks batch deployments of policy derivatives to devices.
-- Supports progress tracking, cancellation, and rollback.
CREATE TABLE IF NOT EXISTS deployment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  total_devices INTEGER NOT NULL DEFAULT 0,
  completed_devices INTEGER NOT NULL DEFAULT 0,
  failed_devices INTEGER NOT NULL DEFAULT 0,
  skipped_devices INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  error_log JSONB DEFAULT '[]',
  rollback_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_jobs_env ON deployment_jobs(environment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_jobs_policy ON deployment_jobs(policy_id);
CREATE INDEX IF NOT EXISTS idx_deployment_jobs_status ON deployment_jobs(status);
