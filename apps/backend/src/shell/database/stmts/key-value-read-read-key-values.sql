SELECT name, kind, text_value, json_value, number_value, bool_value, blob_value
FROM key_values
WHERE name = ?
