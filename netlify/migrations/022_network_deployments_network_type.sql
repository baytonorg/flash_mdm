ALTER TABLE network_deployments ADD COLUMN IF NOT EXISTS network_type VARCHAR(10) NOT NULL DEFAULT 'wifi';
UPDATE network_deployments SET network_type = 'apn' WHERE onc_profile::text LIKE '%apnPolicy%' AND network_type = 'wifi';
