SELECT id, name, revision, created_at_sec, updated_at_sec
FROM canvases
WHERE name = ?
-- Read a canvas by its unique name.
