SELECT version, state_json
FROM widget_instance_states
WHERE canvas_id = ?
  AND element_id = ?
  AND instance_id = ?
