INSERT INTO resource_encryption_keys (
  id, resource_id, purpose, algorithm, key_material
)
SELECT ?, id, ?, ?, unhex(?)
FROM resource_catalog
WHERE id = ? AND kind = 'secretStore'
ON CONFLICT (resource_id) DO NOTHING
-- Insert a secret-store encryption key when absent.
