SELECT name, type, sql
FROM sqlite_schema
WHERE type IN ('table', 'view')
  AND lower(name) NOT GLOB 'sqlite_*'
  AND lower(name) NOT GLOB '_omnidraw_*'
  AND lower(name) NOT GLOB 'libsql_*'
  AND lower(name) NOT GLOB '_turso_*'
  AND lower(name) NOT GLOB '_litestream_*'
ORDER BY type, name
LIMIT ?
