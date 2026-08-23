UPDATE db_resource_apply_runs
SET status = ?, last_error_json = ?, backup_retained = ?, completed_at_sec = ?
WHERE id = ? AND status IN (__EXPECTED_STATUSES__)
