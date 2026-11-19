import { WORKFLOW_INTERVAL_MINUTES } from '../../../shared/workflow-schedule.js';

// Check JSONB before node-postgres converts a high-precision numeric to a JS
// number. A stored fraction can otherwise round to a permitted integer.
// The expression uses only the fixed workflow column and trusted preset list.
export const PERSISTED_WORKFLOW_INTERVAL_VALID = `CASE
  WHEN trigger_config IS NULL OR jsonb_typeof(trigger_config) <> 'object' THEN false
  WHEN NOT (trigger_config ? 'interval_minutes') THEN true
  ELSE jsonb_typeof(trigger_config->'interval_minutes') = 'number'
    AND trigger_config->'interval_minutes' IN (${WORKFLOW_INTERVAL_MINUTES.map(value => `'${value}'::jsonb`).join(', ')})
END`;
