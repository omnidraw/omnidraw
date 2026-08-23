SELECT name, sql
FROM sqlite_schema
WHERE type = 'trigger' AND tbl_name = ?
ORDER BY name
