UPDATE canvas_items
SET
  item_json = ?,
  item_revision = item_revision + 1,
  updated_at_sec = CURRENT_TIMESTAMP
WHERE
  canvas_id = ?
  AND id = ?
  AND item_revision = ?
RETURNING
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
