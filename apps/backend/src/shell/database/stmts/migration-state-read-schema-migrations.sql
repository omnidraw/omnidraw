SELECT version, name, checksum_sha256, applied_at_sec, application_version
FROM schema_migrations
ORDER BY version
