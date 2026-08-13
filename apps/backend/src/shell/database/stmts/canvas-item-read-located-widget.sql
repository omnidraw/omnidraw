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
WHERE widget_instance_id = ?
