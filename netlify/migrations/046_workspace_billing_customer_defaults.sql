ALTER TABLE workspace_billing_settings
  ADD COLUMN IF NOT EXISTS billing_contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS billing_business_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255);
