# Data model reference

This page documents selected tables derived from `netlify/migrations/*.sql` (canonical: `netlify/functions/migrate.ts`) and is intended as a high-level map of notable tables.
It does not replace reading the migrations for full column definitions, constraints, and data semantics.

## `audit_log`

### Columns added by later migrations

- `actor_type VARCHAR(20) NOT NULL DEFAULT 'user'` — CHECK in (`'user'`, `'system'`, `'api_key'`) _(from 036)_
- `visibility_scope VARCHAR(20) NOT NULL DEFAULT 'standard'` — CHECK in (`'standard'`, `'privileged'`) _(from 036)_
- `api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL` _(from 038)_

### Indexes (snippets)

- `idx_audit_ws` on (workspace_id, created_at DESC)
- `idx_audit_env` on (environment_id, created_at DESC)
- `idx_audit_user` on (user_id, created_at DESC)
- `idx_audit_device` on (device_id, created_at DESC)
- `idx_audit_api_key` on (api_key_id, created_at DESC)
- `idx_audit_env_visibility_created` on (environment_id, visibility_scope, created_at DESC)

## `billing_invoice_items`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `invoice_id UUID NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE`
- `description TEXT NOT NULL`
- `quantity INTEGER NOT NULL DEFAULT 1`
- `unit_amount_cents INTEGER NOT NULL DEFAULT 0`
- `period_start TIMESTAMPTZ`
- `period_end TIMESTAMPTZ`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `CHECK (quantity > 0 AND unit_amount_cents >= 0)` _(from 042_licensing_hardening.sql)_

## `billing_invoices`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `invoice_type VARCHAR(50) NOT NULL`
- `status VARCHAR(20) NOT NULL DEFAULT 'pending'`
- `subtotal_cents INTEGER NOT NULL DEFAULT 0`
- `currency VARCHAR(3) NOT NULL DEFAULT 'usd'`
- `due_at TIMESTAMPTZ`
- `paid_at TIMESTAMPTZ`
- `source VARCHAR(50)`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_by UUID REFERENCES users(id) ON DELETE SET NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Indexes (snippets)

- `idx_billing_invoices_workspace` on (workspace_id, created_at DESC)

## `environment_entitlements`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE`
- `source VARCHAR(50) NOT NULL`
- `seat_count INTEGER NOT NULL`
- `starts_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `ends_at TIMESTAMPTZ`
- `status VARCHAR(20) NOT NULL DEFAULT 'active'`
- `external_ref VARCHAR(255)`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Indexes (snippets)

- `idx_environment_entitlements_env` on (environment_id, status, starts_at DESC)

### Constraints (snippets)

- `CHECK (seat_count > 0)` _(from 042_licensing_hardening.sql)_

## `license_enforcement_actions`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `case_id UUID NOT NULL REFERENCES license_overage_cases(id) ON DELETE CASCADE`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE`
- `device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE`
- `action VARCHAR(20) NOT NULL`
- `status VARCHAR(20) NOT NULL DEFAULT 'queued'`
- `reason TEXT`
- `executed_at TIMESTAMPTZ`
- `error TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Indexes (snippets)

- `idx_license_enforcement_actions_dedupe` UNIQUE on (case_id, device_id, action)

## `license_grants`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `source VARCHAR(40) NOT NULL`
- `seat_count INTEGER NOT NULL`
- `starts_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `ends_at TIMESTAMPTZ`
- `status VARCHAR(20) NOT NULL DEFAULT 'active'`
- `external_ref VARCHAR(255)`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_by UUID REFERENCES users(id) ON DELETE SET NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `CHECK (seat_count > 0)` _(from 042_licensing_hardening.sql)_

### Indexes (snippets)

- `idx_license_grants_workspace` on (workspace_id, starts_at DESC)
- `idx_license_grants_workspace_source_external_ref` UNIQUE on (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL

## `license_overage_cases`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE`
- `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `resolved_at TIMESTAMPTZ`
- `phase VARCHAR(20) NOT NULL DEFAULT 'warn'`
- `overage_peak INTEGER NOT NULL DEFAULT 0`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Indexes (snippets)

- `idx_license_overage_cases_env_open` on (environment_id, started_at DESC) WHERE resolved_at IS NULL
- `idx_license_overage_cases_single_open` UNIQUE on (environment_id) WHERE resolved_at IS NULL

## `license_overage_notifications`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `case_id UUID NOT NULL REFERENCES license_overage_cases(id) ON DELETE CASCADE`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE`
- `notification_key VARCHAR(80) NOT NULL`
- `status VARCHAR(20) NOT NULL DEFAULT 'queued'`
- `payload JSONB NOT NULL DEFAULT '{}'`
- `sent_at TIMESTAMPTZ`
- `error TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `UNIQUE(case_id, notification_key)` _(from 043_licensing_free_tier_notifications.sql)_
- `CHECK (status IN ('queued', 'sent', 'failed'))` _(from 043)_

### Indexes (snippets)

- `idx_license_overage_notifications_workspace` on (workspace_id, created_at DESC)
- `idx_license_overage_notifications_status` on (status, created_at DESC)

## `platform_settings`

### Columns (as seen in migrations)

- `id SMALLINT PRIMARY KEY CHECK (id = 1)`
- `invite_only_registration BOOLEAN NOT NULL DEFAULT false`
- `default_free_enabled BOOLEAN NOT NULL DEFAULT true` _(from 043)_
- `default_free_seat_limit INTEGER NOT NULL DEFAULT 10` _(from 043)_ — CHECK (`>= 0 AND <= 1000000`)
- `licensing_enabled BOOLEAN NOT NULL DEFAULT true` _(from 043)_
- `updated_by UUID REFERENCES users(id) ON DELETE SET NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

## `sessions`

### Indexes (snippets)

- `idx_sessions_user` on (user_id)
- `idx_sessions_expires` on (expires_at)
- `idx_sessions_token_hash` on (token_hash)
- `idx_sessions_impersonated_by` on (impersonated_by)
- `idx_sessions_impersonator_session` on (impersonator_session_id)
- `idx_sessions_impersonation_mode` on (impersonation_mode)

## `workspace_billing_events`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `source VARCHAR(30) NOT NULL`
- `event_id VARCHAR(255) NOT NULL`
- `event_type VARCHAR(100) NOT NULL`
- `payload JSONB NOT NULL DEFAULT '{}'`
- `processed_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `UNIQUE(source, event_id)` _(from 041_two_tier_licensing.sql)_

## `workspace_billing_notifications`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `environment_id UUID REFERENCES environments(id) ON DELETE CASCADE`
- `notification_type VARCHAR(60) NOT NULL`
- `dedupe_key VARCHAR(255) NOT NULL`
- `status VARCHAR(20) NOT NULL DEFAULT 'queued'`
- `recipients JSONB NOT NULL DEFAULT '[]'::jsonb`
- `payload JSONB NOT NULL DEFAULT '{}'::jsonb`
- `sent_at TIMESTAMPTZ`
- `error TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `UNIQUE(workspace_id, dedupe_key)` _(from 045_billing_notifications.sql)_
- `CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))` _(from 045)_

### Indexes (snippets)

- `idx_workspace_billing_notifications_workspace` on (workspace_id, created_at DESC)
- `idx_workspace_billing_notifications_status` on (status, created_at DESC)

## `workspace_billing_settings`

### Columns (as seen in migrations)

- `workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE`
- `mode VARCHAR(20) NOT NULL DEFAULT 'disabled'`
- `stripe_secret_key_enc TEXT`
- `stripe_webhook_secret_enc TEXT`
- `stripe_publishable_key VARCHAR(255)`
- `default_currency VARCHAR(3) NOT NULL DEFAULT 'usd'`
- `default_pricing_id UUID REFERENCES workspace_pricing_catalog(id) ON DELETE SET NULL` _(FK from 042)_
- `created_by UUID REFERENCES users(id) ON DELETE SET NULL`
- `updated_by UUID REFERENCES users(id) ON DELETE SET NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

## `workspace_customers`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE`
- `name VARCHAR(255)`
- `email VARCHAR(255)`
- `stripe_customer_id VARCHAR(255)`
- `pricing_id UUID REFERENCES workspace_pricing_catalog(id) ON DELETE SET NULL`
- `status VARCHAR(20) NOT NULL DEFAULT 'active'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `UNIQUE(environment_id)` _(from 041_two_tier_licensing.sql)_

## `workspace_licensing_settings`

### Columns (as seen in migrations)

- `workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE`
- `free_enabled BOOLEAN NOT NULL DEFAULT true`
- `free_seat_limit INTEGER NOT NULL DEFAULT 10`
- `billing_method VARCHAR(20) NOT NULL DEFAULT 'stripe'`
- `customer_owner_enabled BOOLEAN NOT NULL DEFAULT false`
- `grace_day_block INTEGER NOT NULL DEFAULT 10`
- `grace_day_disable INTEGER NOT NULL DEFAULT 30`
- `grace_day_wipe INTEGER NOT NULL DEFAULT 45`
- `inherit_platform_free_tier BOOLEAN NOT NULL DEFAULT true` _(from 043)_
- `licensing_enabled BOOLEAN NOT NULL DEFAULT true` _(from 043)_
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `CHECK (grace_day_block >= 0 AND grace_day_block < grace_day_disable AND grace_day_disable < grace_day_wipe)` _(from 042)_
- `CHECK (free_seat_limit >= 0)` _(from 042)_
- `CHECK (free_seat_limit <= 1000000)` _(from 043)_

## `workspace_pricing_catalog`

### Columns (as seen in migrations)

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `name VARCHAR(255) NOT NULL`
- `seat_price_cents INTEGER NOT NULL`
- `duration_months INTEGER NOT NULL`
- `active BOOLEAN NOT NULL DEFAULT true`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### Constraints (snippets)

- `CHECK (seat_price_cents >= 0 AND duration_months > 0)` _(from 042_licensing_hardening.sql)_
