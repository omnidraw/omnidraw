UPDATE canvases
SET
  revision = revision + 1,
  updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ? AND revision = ?
RETURNING revision
