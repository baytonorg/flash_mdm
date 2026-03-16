WITH ranked_null_device_rows AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY environment_id, package_name, feedback_key
      ORDER BY last_reported_at DESC, updated_at DESC, created_at DESC, id DESC
    ) AS rank_num
  FROM app_feedback_items
  WHERE device_id IS NULL
)
DELETE FROM app_feedback_items
WHERE id IN (
  SELECT id
  FROM ranked_null_device_rows
  WHERE rank_num > 1
);

ALTER TABLE app_feedback_items
  DROP CONSTRAINT IF EXISTS app_feedback_items_environment_id_device_id_package_name_feedback_key_key;

DROP INDEX IF EXISTS idx_app_feedback_unique_device;
DROP INDEX IF EXISTS idx_app_feedback_unique_fleet;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_device
  ON app_feedback_items(environment_id, device_id, package_name, feedback_key)
  WHERE device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_unique_fleet
  ON app_feedback_items(environment_id, package_name, feedback_key)
  WHERE device_id IS NULL;
