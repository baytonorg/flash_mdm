DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_licensing_settings_grace_order_check'
  ) THEN
    ALTER TABLE workspace_licensing_settings
      ADD CONSTRAINT workspace_licensing_settings_grace_order_check
      CHECK (
        grace_day_block >= 0
        AND grace_day_block < grace_day_disable
        AND grace_day_disable < grace_day_wipe
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_licensing_settings_free_seat_limit_check'
  ) THEN
    ALTER TABLE workspace_licensing_settings
      ADD CONSTRAINT workspace_licensing_settings_free_seat_limit_check
      CHECK (free_seat_limit >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'license_grants_seat_count_check'
  ) THEN
    ALTER TABLE license_grants
      ADD CONSTRAINT license_grants_seat_count_check
      CHECK (seat_count > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_entitlements_seat_count_check'
  ) THEN
    ALTER TABLE environment_entitlements
      ADD CONSTRAINT environment_entitlements_seat_count_check
      CHECK (seat_count > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_pricing_catalog_amount_check'
  ) THEN
    ALTER TABLE workspace_pricing_catalog
      ADD CONSTRAINT workspace_pricing_catalog_amount_check
      CHECK (seat_price_cents >= 0 AND duration_months > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_invoice_items_amount_check'
  ) THEN
    ALTER TABLE billing_invoice_items
      ADD CONSTRAINT billing_invoice_items_amount_check
      CHECK (quantity > 0 AND unit_amount_cents >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_billing_settings_default_pricing_fk'
  ) THEN
    ALTER TABLE workspace_billing_settings
      ADD CONSTRAINT workspace_billing_settings_default_pricing_fk
      FOREIGN KEY (default_pricing_id) REFERENCES workspace_pricing_catalog(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_license_grants_workspace_source_external_ref
  ON license_grants(workspace_id, source, external_ref)
  WHERE external_ref IS NOT NULL;

WITH ranked_open_cases AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY environment_id
           ORDER BY started_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM license_overage_cases
  WHERE resolved_at IS NULL
)
UPDATE license_overage_cases c
SET resolved_at = now(),
    phase = 'resolved',
    updated_at = now()
FROM ranked_open_cases r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_license_overage_cases_single_open
  ON license_overage_cases(environment_id)
  WHERE resolved_at IS NULL;
