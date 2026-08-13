INSERT INTO key_values (
  name, kind, text_value, json_value, number_value, bool_value, blob_value
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (name) DO UPDATE SET
  kind = excluded.kind,
  text_value = excluded.text_value,
  json_value = excluded.json_value,
  number_value = excluded.number_value,
  bool_value = excluded.bool_value,
  blob_value = excluded.blob_value,
  updated_at_sec = CURRENT_TIMESTAMP
-- Insert or replace a key-value entry.
