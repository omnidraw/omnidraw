SELECT id, resource_id, purpose, algorithm,
  lower(hex(key_material)) AS key_hex, created_at_sec
FROM resource_encryption_keys
WHERE resource_id = ?
