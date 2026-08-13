SELECT id, canvas_id, source_hash, digest_sha256, mime_type, data, created_at_sec
FROM media_files
ORDER BY created_at_sec ASC, id ASC
