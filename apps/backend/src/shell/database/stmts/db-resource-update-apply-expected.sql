UPDATE db_resource_apply_runs
SET
  status = ?,
  last_error_json = ?,
  backup_retained = COALESCE(?, backup_retained),
  completed_at_sec = CASE
    WHEN ? THEN COALESCE(completed_at_sec, CURRENT_TIMESTAMP)
    ELSE NULL
  END
WHERE id = ? AND status = ?
-- Update an apply run when its status matches.
