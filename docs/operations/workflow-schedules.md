# Inspect scheduled workflow configuration

Create/update and enable actions accept 15, 30, 60, 360, 720 and 1440 minute
intervals. An omitted configuration or interval keeps the documented hourly
default. Explicit null or malformed configuration and other interval values are
invalid. The cron worker refuses invalid persisted schedules without rewriting
them, changing their enabled flag or enqueuing their actions.

Use this read-only inventory against the deployment's PostgreSQL database. It
includes disabled workflows and returns only configuration classes and counts.
It does not run the scheduled handler, enable a workflow or expose action payloads.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH schedules AS (
  SELECT enabled,
    CASE
      WHEN trigger_config IS NULL THEN 'invalid_null_configuration'
      WHEN jsonb_typeof(trigger_config) <> 'object' THEN 'invalid_configuration_type'
      WHEN NOT (trigger_config ? 'interval_minutes') THEN 'default_hourly'
      WHEN jsonb_typeof(trigger_config->'interval_minutes') <> 'number' THEN 'invalid_interval_type'
      WHEN trigger_config->'interval_minutes' IN (
        '15'::jsonb, '30'::jsonb, '60'::jsonb,
        '360'::jsonb, '720'::jsonb, '1440'::jsonb
      ) THEN 'valid_preset'
      ELSE 'invalid_interval_value'
    END AS configuration
  FROM workflows
  WHERE trigger_type = 'scheduled'
)
SELECT enabled, configuration, count(*)
FROM schedules
GROUP BY enabled, configuration
ORDER BY enabled, configuration;
ROLLBACK;
```

Investigate any invalid count before deliberately editing that workflow. An
invalid enabled row makes cron report HTTP 500 and a nonzero `stats.errors`, while
valid peers still proceed. Disable or delete remains possible through the ordinary
authorised controls. Correcting or enabling a workflow can change its external or
managed-device effects and requires its normal acceptance and authority.
