INSERT INTO db_resource_apply_runs (
  id, resource_id, draft_id, source_apply_id, status,
  last_error_json, backup_retained, completed_at_sec
) VALUES (
  ?, ?, ?, ?, ?, NULL, false,
  CASE WHEN ? IN ('succeeded', 'failed', 'recovered') THEN CURRENT_TIMESTAMP ELSE NULL END
)
