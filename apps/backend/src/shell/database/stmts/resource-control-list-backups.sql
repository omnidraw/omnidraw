SELECT * FROM db_resource_backups
WHERE resource_id = ?
ORDER BY created_at_sec DESC, id DESC
-- List all backups for a resource.
