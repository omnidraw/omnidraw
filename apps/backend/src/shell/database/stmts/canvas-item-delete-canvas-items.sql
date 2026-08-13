DELETE FROM canvas_items
WHERE
  canvas_id = ?
  AND id = ?
  AND item_revision = ?
RETURNING id
