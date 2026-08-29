ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS issuer_name TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE certificates
  ALTER COLUMN cert_type SET DEFAULT 'server_ca',
  ALTER COLUMN scope_type SET DEFAULT 'environment';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'certificates_server_ca_only_check'
  ) THEN
    ALTER TABLE certificates
      ADD CONSTRAINT certificates_server_ca_only_check
      CHECK (validated_at IS NULL OR cert_type = 'server_ca');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'certificates_environment_scope_check'
  ) THEN
    ALTER TABLE certificates
      ADD CONSTRAINT certificates_environment_scope_check
      CHECK (validated_at IS NULL OR (scope_type = 'environment' AND scope_id = environment_id));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_certs_env_active
  ON certificates(environment_id, created_at)
  WHERE deleted_at IS NULL AND validated_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_certs_env_active_fingerprint_unique
  ON certificates(environment_id, fingerprint_sha256)
  WHERE deleted_at IS NULL AND validated_at IS NOT NULL;
