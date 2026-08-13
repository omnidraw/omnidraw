SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name
