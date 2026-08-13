INSERT INTO widget_instance_states (
  canvas_id,
  element_id,
  instance_id,
  version,
  state_json
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (canvas_id, element_id) DO UPDATE SET
  instance_id = excluded.instance_id,
  version = excluded.version,
  state_json = excluded.state_json,
  created_at_sec = CURRENT_TIMESTAMP,
  updated_at_sec = CURRENT_TIMESTAMP
WHERE widget_instance_states.instance_id <> excluded.instance_id
