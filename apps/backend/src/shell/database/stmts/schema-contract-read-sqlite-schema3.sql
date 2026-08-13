SELECT name, tbl_name AS table_name
FROM sqlite_schema
WHERE type = 'index' AND name NOT GLOB 'sqlite_autoindex_*'
ORDER BY name
