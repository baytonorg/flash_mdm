CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id),
  policy_id UUID REFERENCES policies(id),
  amapi_name VARCHAR(255) NOT NULL UNIQUE,
  serial_number VARCHAR(255),
  imei VARCHAR(50),
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  os_version VARCHAR(50),
  security_patch_level VARCHAR(20),
  state VARCHAR(50),
  ownership VARCHAR(50),
  management_mode VARCHAR(50),
  policy_compliant BOOLEAN,
  applied_policy_version BIGINT,
  enrollment_time TIMESTAMPTZ,
  last_status_report_at TIMESTAMPTZ,
  last_policy_sync_at TIMESTAMPTZ,
  previous_device_names TEXT[],
  snapshot JSONB,
  license_id UUID,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_devices_env ON devices(environment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_devices_group ON devices(group_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_devices_serial ON devices(serial_number);
CREATE INDEX idx_devices_state ON devices(state);
CREATE INDEX idx_devices_amapi ON devices(amapi_name);

CREATE TABLE device_status_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  report JSONB NOT NULL,
  received_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_dsr_device ON device_status_reports(device_id, received_at DESC);

CREATE TABLE device_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  package_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  version_name VARCHAR(100),
  version_code INTEGER,
  state VARCHAR(50),
  source VARCHAR(50),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, package_name)
);

CREATE TABLE device_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  source VARCHAR(50),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_devloc ON device_locations(device_id, recorded_at DESC);
