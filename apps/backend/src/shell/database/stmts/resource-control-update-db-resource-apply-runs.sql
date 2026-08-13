UPDATE db_resource_apply_runs
SET source_apply_id = NULL
WHERE resource_id = ? AND source_apply_id IS NOT NULL
