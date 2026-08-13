INSERT INTO resource_entries (key, value)
VALUES (?, ?)
ON CONFLICT (key) DO NOTHING
