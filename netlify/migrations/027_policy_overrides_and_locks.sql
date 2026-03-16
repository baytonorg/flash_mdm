-- ── 2A. Lock fields on policy_assignments ────────────────────────────────
-- Locks control editability of inherited policy config (not assignment).
-- A child group can always assign a different policy even when locked.
ALTER TABLE policy_assignments
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_sections TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS locked_by UUID,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- ── 2B. Group policy overrides ──────────────────────────────────────────
-- Sparse override configs for groups that inherit a policy but want to
-- customise unlocked sections. Deep-merged during derivative generation.
CREATE TABLE IF NOT EXISTS group_policy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  override_config JSONB NOT NULL DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, policy_id)
);
CREATE INDEX IF NOT EXISTS idx_group_policy_overrides_group ON group_policy_overrides(group_id);
CREATE INDEX IF NOT EXISTS idx_group_policy_overrides_policy ON group_policy_overrides(policy_id);

-- ── 2C. Device policy overrides ─────────────────────────────────────────
-- Sparse override configs for individual devices. Merged last (highest
-- priority) during derivative generation. Individually toggleable/reversible.
CREATE TABLE IF NOT EXISTS device_policy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  override_config JSONB NOT NULL DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, policy_id)
);
CREATE INDEX IF NOT EXISTS idx_device_policy_overrides_device ON device_policy_overrides(device_id);
CREATE INDEX IF NOT EXISTS idx_device_policy_overrides_policy ON device_policy_overrides(policy_id);
