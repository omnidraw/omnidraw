INSERT INTO media_files (
  id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data
) VALUES (?, ?, ?, ?, ?, length(?), ?)
