ALTER TABLE signup_links
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'standard';

ALTER TABLE signup_links
  DROP CONSTRAINT IF EXISTS signup_links_purpose_check;

ALTER TABLE signup_links
  ADD CONSTRAINT signup_links_purpose_check
  CHECK (purpose IN ('standard', 'customer'));

DROP INDEX IF EXISTS idx_signup_links_scope;
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_links_scope
  ON signup_links(scope_type, scope_id, purpose);
