INSERT INTO resource_entries (key, value)
VALUES (?, ?)
ON CONFLICT (key) DO UPDATE SET
  value = excluded.value,
  revision = resource_entries.revision + 1
