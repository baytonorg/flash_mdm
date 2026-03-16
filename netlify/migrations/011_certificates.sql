CREATE TABLE certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cert_type VARCHAR(50),
  fingerprint_sha256 VARCHAR(95),
  blob_key VARCHAR(512) NOT NULL,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID,
  not_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_certs_env ON certificates(environment_id);
