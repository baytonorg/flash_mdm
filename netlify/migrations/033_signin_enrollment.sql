-- Sign-in URL enrollment configuration per environment
CREATE TABLE IF NOT EXISTS signin_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  default_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  allow_personal_usage VARCHAR(50) NOT NULL DEFAULT 'PERSONAL_USAGE_ALLOWED',
  token_tag VARCHAR(255),
  amapi_signin_enrollment_token TEXT,
  amapi_qr_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(environment_id)
);

-- Short-lived email verification codes for sign-in enrollment
CREATE TABLE IF NOT EXISTS signin_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  provisioning_info TEXT,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signin_verifications_lookup
  ON signin_verifications(environment_id, email, expires_at);
