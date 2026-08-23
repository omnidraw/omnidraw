UPDATE resource_catalog
SET status = ?, last_error_json = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ? AND status IN (__EXPECTED_STATUSES__)
