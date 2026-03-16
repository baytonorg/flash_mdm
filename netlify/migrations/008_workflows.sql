CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  trigger_type VARCHAR(50) NOT NULL,
  trigger_config JSONB DEFAULT '{}',
  conditions JSONB DEFAULT '[]',
  action_type VARCHAR(50) NOT NULL,
  action_config JSONB DEFAULT '{}',
  scope_type VARCHAR(20) DEFAULT 'environment',
  scope_id UUID,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_workflows_env ON workflows(environment_id);

CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id),
  trigger_data JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_wf_exec_workflow ON workflow_executions(workflow_id, created_at DESC);
