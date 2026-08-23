SELECT
  canvas_id,
  id,
  item_json,
  item_revision,
  created_at_sec,
  updated_at_sec,
  kind,
  parent_id,
  order_key,
  widget_instance_id,
  widget_key
FROM canvas_items
WHERE canvas_id = ?
  AND parent_id IS NULL
  AND (
    order_key > ?
    OR (order_key = ? AND id > ?)
  )
ORDER BY order_key ASC, id ASC
LIMIT ?
