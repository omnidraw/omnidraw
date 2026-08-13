UPDATE widget_instance_states
SET
  version = version + 1,
  state_json = ?,
  updated_at_sec = CURRENT_TIMESTAMP
WHERE canvas_id = ?
  AND element_id = ?
  AND instance_id = ?
  AND version = ?
RETURNING version, state_json
