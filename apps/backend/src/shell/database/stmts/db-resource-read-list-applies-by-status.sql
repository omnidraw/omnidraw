SELECT *
FROM db_resource_apply_runs
WHERE resource_id = ? AND status = ?
ORDER BY created_at_sec DESC, id DESC
LIMIT ?
