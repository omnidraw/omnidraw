INSERT INTO db_resource_backups (
  id, resource_id, apply_run_id, relative_path, digest_sha256,
  byte_size, state, verified_at_sec, delete_after_sec
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
