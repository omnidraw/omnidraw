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
  AND widget_key = ?
  AND (
    widget_instance_id > ?
    OR (widget_instance_id = ? AND id > ?)
  )
ORDER BY widget_instance_id ASC, id ASC
LIMIT ?
