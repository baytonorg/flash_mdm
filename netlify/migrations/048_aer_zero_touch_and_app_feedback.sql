CREATE TABLE IF NOT EXISTS app_feedback_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  device_amapi_name VARCHAR(255),
  package_name VARCHAR(255) NOT NULL,
  feedback_key VARCHAR(255) NOT NULL,
  severity VARCHAR(50),
  message TEXT,
  data_json JSONB,
  first_reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_update_time TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_device
  ON app_feedback_items(environment_id, device_id, package_name, feedback_key)
  WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_fleet
  ON app_feedback_items(environment_id, package_name, feedback_key)
  WHERE device_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_last ON app_feedback_items(environment_id, last_reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_severity ON app_feedback_items(environment_id, severity);
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_package ON app_feedback_items(environment_id, package_name);
CREATE INDEX IF NOT EXISTS idx_app_feedback_env_status ON app_feedback_items(environment_id, status);

CREATE TABLE IF NOT EXISTS app_feedback_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity_filter JSONB NOT NULL DEFAULT '[]'::jsonb,
  package_filter JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback_key_filter JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_mode VARCHAR(20) NOT NULL DEFAULT 'immediate',
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_feedback_sub_env_user ON app_feedback_subscriptions(environment_id, user_id);

CREATE TABLE IF NOT EXISTS app_feedback_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES app_feedback_subscriptions(id) ON DELETE SET NULL,
  feedback_item_id UUID REFERENCES app_feedback_items(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_app_feedback_delivery_env ON app_feedback_delivery_log(environment_id, created_at DESC);
