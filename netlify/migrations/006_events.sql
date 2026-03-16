CREATE TABLE pubsub_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id),
  message_id VARCHAR(255) NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  device_amapi_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(environment_id, message_id)
);
CREATE INDEX idx_pubsub_status ON pubsub_events(status, created_at);

CREATE TABLE job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(100) NOT NULL,
  environment_id UUID REFERENCES environments(id),
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255),
  scheduled_for TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_jobs_pending ON job_queue(status, scheduled_for) WHERE status = 'pending';
