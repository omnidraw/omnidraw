SELECT type, name
FROM sqlite_schema
WHERE type IN ('table', 'view', 'trigger')
  AND name NOT GLOB 'sqlite_*'
ORDER BY type, name
