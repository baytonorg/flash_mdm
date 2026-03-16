CREATE TABLE enrollment_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id),
  policy_id UUID REFERENCES policies(id),
  name VARCHAR(255) NOT NULL,
  amapi_name VARCHAR(255),
  amapi_value TEXT,
  qr_data TEXT,
  one_time_use BOOLEAN DEFAULT false,
  allow_personal_usage VARCHAR(50),
  signin_url VARCHAR(512),
  extras JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_enrollment_env ON enrollment_tokens(environment_id);
