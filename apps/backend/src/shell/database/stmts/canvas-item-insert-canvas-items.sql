INSERT INTO canvas_items (
  canvas_id,
  id,
  item_json,
  item_revision
)
VALUES (?, ?, ?, 1)
ON CONFLICT (canvas_id, id) DO NOTHING
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
