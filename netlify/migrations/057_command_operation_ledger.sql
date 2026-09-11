CREATE TABLE command_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  device_amapi_name VARCHAR(255) NOT NULL,
  workflow_execution_id UUID REFERENCES workflow_executions(id) ON DELETE SET NULL,
  source VARCHAR(20) NOT NULL,
  command_type VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL,
  operation_name TEXT,
  operation_created_at TIMESTAMPTZ,
  operation_done BOOLEAN,
  operation_error_code INTEGER,
  operation_error_message TEXT,
  upstream_status INTEGER,
  reconcile_page_token TEXT,
  reconcile_pages_scanned INTEGER NOT NULL DEFAULT 0,
  reconcile_failures INTEGER NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reconciled_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT command_operations_source_check
    CHECK (source IN ('direct', 'workflow', 'bulk', 'geofence')),
  CONSTRAINT command_operations_status_check
    CHECK (status IN ('submitted', 'delivery_uncertain', 'reconciling', 'succeeded', 'failed', 'cancelled', 'unresolved')),
  CONSTRAINT command_operations_pages_check CHECK (reconcile_pages_scanned >= 0),
  CONSTRAINT command_operations_failures_check CHECK (reconcile_failures >= 0)
);

CREATE INDEX idx_command_operations_device_requested
  ON command_operations(device_id, requested_at DESC);

CREATE INDEX idx_command_operations_reconciliation
  ON command_operations(status, updated_at)
  WHERE status IN ('delivery_uncertain', 'reconciling');

CREATE UNIQUE INDEX idx_command_operations_operation_name
  ON command_operations(environment_id, operation_name)
  WHERE operation_name IS NOT NULL;

CREATE UNIQUE INDEX idx_command_reconcile_active_job
  ON job_queue ((payload->>'command_operation_id'))
  WHERE job_type = 'command_reconcile'
    AND status IN ('pending', 'locked', 'processing');

INSERT INTO command_operations (
  workspace_id, environment_id, device_id, device_amapi_name,
  workflow_execution_id, source, command_type, status, upstream_status,
  requested_at
)
SELECT
  e.workspace_id,
  w.environment_id,
  we.device_id,
  d.amapi_name,
  we.id,
  'workflow',
  UPPER(COALESCE(we.result->>'command_type', w.action_config->>'command_type')),
  'delivery_uncertain',
  CASE
    WHEN we.result->>'upstream_status' ~ '^[0-9]+$'
      THEN (we.result->>'upstream_status')::INTEGER
    ELSE NULL
  END,
  we.created_at
FROM workflow_executions we
JOIN workflows w ON w.id = we.workflow_id
JOIN environments e ON e.id = w.environment_id
JOIN devices d ON d.id = we.device_id
WHERE we.status = 'delivery_uncertain'
  AND w.action_type = 'device.command'
  AND COALESCE(we.result->>'command_type', w.action_config->>'command_type') IS NOT NULL;

INSERT INTO job_queue (job_type, environment_id, payload, max_attempts)
SELECT
  'command_reconcile',
  co.environment_id,
  jsonb_build_object('command_operation_id', co.id::text),
  5
FROM command_operations co
WHERE co.status = 'delivery_uncertain'
ON CONFLICT DO NOTHING;
