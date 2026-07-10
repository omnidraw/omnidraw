-- Minimal Turso native repro for UPDATE ... RETURNING with an AFTER UPDATE
-- self-trigger and a medium JSON payload in a later row.
--
-- Detached from Vibecanvas actors/widgets: table and columns are generic.
--
-- Verified against the Vibecanvas 0.4.2 Coolify image:
-- sha256:06f296d4b688fe9f5396c3858499edc39cbb5fe302cdf227dafa9f696881b8cf
--
-- Expected failure on the final UPDATE:
-- thread '<unnamed>' panicked at core/storage/pager.rs:380:9:
-- cell_get: idx out of bounds | idx=1, ncells=1

DROP TABLE IF EXISTS repro_rows;

CREATE TABLE repro_rows (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  payload JSON DEFAULT '{}' NOT NULL,
  created_at TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
  updated_at TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;

CREATE TRIGGER repro_rows_updated_at_after_update
AFTER UPDATE ON repro_rows
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE repro_rows
  SET updated_at = datetime('now')
  WHERE id = OLD.id;
END;

INSERT INTO repro_rows (id, status, payload, created_at)
VALUES
  ('a', 'running', '{"kind":"small"}', datetime('now', '+0 seconds')),
  ('b', 'running', '{"kind":"target"}', datetime('now', '+1 seconds')),
  (
    'c',
    'running',
    '{"kind":"medium","html":"' || replace(hex(zeroblob(8000)), '00', 'x') || '"}',
    datetime('now', '+2 seconds')
  );

SELECT id, length(payload) AS payload_len
FROM repro_rows
ORDER BY created_at, id;

-- Failing statement.
--
-- It updates row "b". Row "c" only needs to exist later in the table with a
-- medium JSON payload that produces the bad Turso page layout.
UPDATE repro_rows
SET status = 'running'
WHERE id = 'b'
RETURNING id;
