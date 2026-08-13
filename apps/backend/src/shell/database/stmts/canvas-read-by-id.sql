SELECT id, name, revision, created_at_sec, updated_at_sec
FROM canvases
WHERE id = ?
-- Read a canvas by identifier.
