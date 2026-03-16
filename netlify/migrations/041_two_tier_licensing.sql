CREATE TABLE IF NOT EXISTS workspace_licensing_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  free_enabled BOOLEAN NOT NULL DEFAULT true,
  free_seat_limit INTEGER NOT NULL DEFAULT 10,
  billing_method VARCHAR(20) NOT NULL DEFAULT 'stripe',
  customer_owner_enabled BOOLEAN NOT NULL DEFAULT false,
  grace_day_block INTEGER NOT NULL DEFAULT 10,
  grace_day_disable INTEGER NOT NULL DEFAULT 30,
  grace_day_wipe INTEGER NOT NULL DEFAULT 45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_licensing_settings_billing_method_check'
  ) THEN
    ALTER TABLE workspace_licensing_settings
      ADD CONSTRAINT workspace_licensing_settings_billing_method_check
      CHECK (billing_method IN ('stripe', 'invoice', 'disabled'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS license_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source VARCHAR(40) NOT NULL,
  seat_count INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  external_ref VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_grants_status_check'
  ) THEN
    ALTER TABLE license_grants
      ADD CONSTRAINT license_grants_status_check
      CHECK (status IN ('active', 'expired', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_license_grants_workspace
  ON license_grants(workspace_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_grants_workspace_status
  ON license_grants(workspace_id, status, starts_at DESC);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  due_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  source VARCHAR(50),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_invoices_status_check'
  ) THEN
    ALTER TABLE billing_invoices
      ADD CONSTRAINT billing_invoices_status_check
      CHECK (status IN ('pending', 'paid', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_invoices_workspace
  ON billing_invoices(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status
  ON billing_invoices(status, due_at);

CREATE TABLE IF NOT EXISTS billing_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_amount_cents INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoice_items_invoice
  ON billing_invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS workspace_billing_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'disabled',
  stripe_secret_key_enc TEXT,
  stripe_webhook_secret_enc TEXT,
  stripe_publishable_key VARCHAR(255),
  default_currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  default_pricing_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_billing_settings_mode_check'
  ) THEN
    ALTER TABLE workspace_billing_settings
      ADD CONSTRAINT workspace_billing_settings_mode_check
      CHECK (mode IN ('disabled', 'stripe'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspace_pricing_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  seat_price_cents INTEGER NOT NULL,
  duration_months INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_pricing_workspace
  ON workspace_pricing_catalog(workspace_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255),
  email VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  pricing_id UUID REFERENCES workspace_pricing_catalog(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(environment_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_customers_status_check'
  ) THEN
    ALTER TABLE workspace_customers
      ADD CONSTRAINT workspace_customers_status_check
      CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspace_customers_workspace
  ON workspace_customers(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS environment_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  seat_count INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  external_ref VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_entitlements_status_check'
  ) THEN
    ALTER TABLE environment_entitlements
      ADD CONSTRAINT environment_entitlements_status_check
      CHECK (status IN ('active', 'expired', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_environment_entitlements_env
  ON environment_entitlements(environment_id, status, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_environment_entitlements_workspace
  ON environment_entitlements(workspace_id, status, starts_at DESC);

CREATE TABLE IF NOT EXISTS workspace_billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source VARCHAR(30) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source, event_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_events_workspace
  ON workspace_billing_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS license_overage_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  phase VARCHAR(20) NOT NULL DEFAULT 'warn',
  overage_peak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_overage_cases_phase_check'
  ) THEN
    ALTER TABLE license_overage_cases
      ADD CONSTRAINT license_overage_cases_phase_check
      CHECK (phase IN ('warn', 'block', 'disable', 'wipe', 'resolved'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_license_overage_cases_env_open
  ON license_overage_cases(environment_id, started_at DESC)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS license_enforcement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES license_overage_cases(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  reason TEXT,
  executed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_enforcement_actions_action_check'
  ) THEN
    ALTER TABLE license_enforcement_actions
      ADD CONSTRAINT license_enforcement_actions_action_check
      CHECK (action IN ('disable', 'enable', 'wipe'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_enforcement_actions_status_check'
  ) THEN
    ALTER TABLE license_enforcement_actions
      ADD CONSTRAINT license_enforcement_actions_status_check
      CHECK (status IN ('queued', 'completed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_license_enforcement_actions_case
  ON license_enforcement_actions(case_id, action, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_license_enforcement_actions_dedupe
  ON license_enforcement_actions(case_id, device_id, action);
