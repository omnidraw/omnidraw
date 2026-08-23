SELECT type, name, tbl_name AS table_name, sql
FROM sqlite_schema
WHERE type IN ('table', 'index', 'view', 'trigger')
  AND name NOT GLOB 'sqlite_*'
ORDER BY type, name, tbl_name
-- List user-owned schema objects.
