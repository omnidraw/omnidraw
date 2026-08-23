SELECT * FROM db_resource_backups
WHERE resource_id = ? AND apply_run_id = ?
-- Read a resource backup for one apply run.
