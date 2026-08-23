INSERT INTO schema_migrations (
  version,
  name,
  checksum_sha256,
  application_version
) VALUES (?, ?, ?, ?)
-- Record an applied schema migration.
