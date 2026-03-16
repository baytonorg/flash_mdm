CREATE TABLE geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_meters DOUBLE PRECISION NOT NULL,
  polygon JSONB,
  scope_type VARCHAR(20) NOT NULL,
  scope_id UUID,
  action_on_enter JSONB DEFAULT '{}',
  action_on_exit JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_geofences_env ON geofences(environment_id);

CREATE TABLE device_geofence_state (
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  inside BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  PRIMARY KEY (device_id, geofence_id)
);
