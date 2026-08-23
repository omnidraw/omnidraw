UPDATE db_resource_drafts
SET
  status = ?,
  last_error_json = ?,
  applied_at_sec = ?,
  updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ? AND status IN (__EXPECTED_STATUSES__)
