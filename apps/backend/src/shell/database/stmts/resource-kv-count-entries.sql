SELECT COUNT(*) AS count
FROM resource_entries
WHERE (? IS NULL OR substr(key, 1, length(?)) = ?)
  AND (? IS NULL OR instr(key, ?) > 0)
