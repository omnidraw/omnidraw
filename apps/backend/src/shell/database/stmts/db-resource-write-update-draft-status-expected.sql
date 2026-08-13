UPDATE db_resource_drafts
SET
  status = ?,
  last_error_json = ?,
  updated_at_sec = CURRENT_TIMESTAMP,
  applied_at_sec = CASE WHEN ? = 'applied' THEN CURRENT_TIMESTAMP ELSE NULL END
WHERE id = ? AND status = ?
