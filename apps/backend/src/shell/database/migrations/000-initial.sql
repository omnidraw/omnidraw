CREATE DOMAIN sha256_hex AS TEXT CHECK (
  length(value) = 64
  AND value = lower(value)
  AND value NOT GLOB '*[^0-9a-f]*'
);

CREATE DOMAIN resource_catalog_status AS TEXT CHECK (
  value IN ('created', 'provisioning', 'ready', 'migrating', 'error', 'deleting')
);

CREATE DOMAIN resource_draft_status AS TEXT CHECK (
  value IN ('editing', 'applying', 'applied', 'discarded', 'error')
);

CREATE DOMAIN resource_apply_status AS TEXT CHECK (
  value IN ('preparing', 'applying', 'succeeded', 'failed', 'recovered')
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version >= 0),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 200),
  checksum_sha256 sha256_hex NOT NULL,
  applied_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  application_version TEXT NOT NULL CHECK (length(trim(application_version)) BETWEEN 1 AND 100),
  CHECK (
    length(CAST(applied_at_sec AS TEXT)) = 19
    AND CAST(applied_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(applied_at_sec) = CAST(applied_at_sec AS TEXT)
  )
) STRICT;

CREATE TABLE canvases (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 200),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(updated_at_sec AS TEXT)) = 19
    AND CAST(updated_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(updated_at_sec) = CAST(updated_at_sec AS TEXT)
  ),
  CHECK (updated_at_sec >= created_at_sec)
) STRICT;

CREATE TABLE canvas_items (
  canvas_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(id) > 0),
  item_json JSONB NOT NULL,
  item_revision INTEGER NOT NULL DEFAULT 0 CHECK (item_revision >= 0),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  kind TEXT GENERATED ALWAYS AS (
    json_extract(item_json, '$.kind')
  ) VIRTUAL NOT NULL,
  parent_id TEXT GENERATED ALWAYS AS (
    json_extract(item_json, '$.parentId')
  ) VIRTUAL,
  order_key TEXT GENERATED ALWAYS AS (
    json_extract(item_json, '$.orderKey')
  ) VIRTUAL NOT NULL,
  widget_instance_id TEXT GENERATED ALWAYS AS (
    CASE
      WHEN json_extract(
        item_json,
        '$.extensions."omnidraw:widget".type'
      ) = 'widget-instance'
      THEN json_extract(
        item_json,
        '$.extensions."omnidraw:widget".instanceId'
      )
      ELSE NULL
    END
  ) VIRTUAL,
  widget_key TEXT GENERATED ALWAYS AS (
    CASE
      WHEN json_extract(
        item_json,
        '$.extensions."omnidraw:widget".type'
      ) = 'widget-instance'
      THEN json_extract(
        item_json,
        '$.extensions."omnidraw:widget".widgetKey'
      )
      ELSE NULL
    END
  ) VIRTUAL,

  PRIMARY KEY (canvas_id, id),
  FOREIGN KEY (canvas_id)
    REFERENCES canvases (id) ON DELETE CASCADE,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(updated_at_sec AS TEXT)) = 19
    AND CAST(updated_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(updated_at_sec) = CAST(updated_at_sec AS TEXT)
  ),
  CHECK (updated_at_sec >= created_at_sec),
  CHECK (json_type(item_json, '$') = 'object'),
  CHECK (
    json_type(item_json, '$.id') IS 'text'
    AND json_extract(item_json, '$.id') = id
  ),
  CHECK (
    json_type(item_json, '$.kind') IS 'text'
    AND length(trim(kind)) > 0
  ),
  CHECK (
    json_type(item_json, '$.parentId') IS NOT NULL
    AND json_type(item_json, '$.parentId') IN ('null', 'text')
    AND (
      json_type(item_json, '$.parentId') = 'null'
      OR length(parent_id) > 0
    )
  ),
  CHECK (
    json_type(item_json, '$.orderKey') IS 'text'
    AND length(order_key) > 0
  ),
  CHECK (
    json_extract(
      item_json,
      '$.extensions."omnidraw:widget".type'
    ) IS NOT 'widget-instance'
    OR (
      widget_instance_id IS NOT NULL
      AND widget_key IS NOT NULL
      AND json_type(
        item_json,
        '$.extensions."omnidraw:widget".instanceId'
      ) = 'text'
      AND json_type(
        item_json,
        '$.extensions."omnidraw:widget".widgetKey'
      ) = 'text'
      AND length(trim(widget_instance_id)) > 0
      AND length(trim(widget_key)) BETWEEN 1 AND 100
      AND widget_key = lower(widget_key)
      AND widget_key NOT GLOB '*[^a-z0-9-]*'
      AND widget_key NOT LIKE '-%'
      AND widget_key NOT LIKE '%-'
      AND widget_key NOT LIKE '%--%'
    )
  )
) STRICT;

CREATE TABLE resource_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('kv', 'secretStore', 'db')),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status resource_catalog_status NOT NULL,
  last_error_json JSONB CHECK (
    last_error_json IS NULL OR json_type(last_error_json, '$') = 'object'
  ),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(updated_at_sec AS TEXT)) = 19
    AND CAST(updated_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(updated_at_sec) = CAST(updated_at_sec AS TEXT)
  ),
  CHECK (updated_at_sec >= created_at_sec)
) STRICT;

CREATE TABLE resource_placements (
  resource_id TEXT PRIMARY KEY NOT NULL,
  cell_id TEXT NOT NULL CHECK (length(trim(cell_id)) BETWEEN 1 AND 200),
  placement_epoch INTEGER NOT NULL CHECK (placement_epoch >= 1),
  relative_path TEXT NOT NULL UNIQUE CHECK (
    length(relative_path) BETWEEN 1 AND 1024
    AND relative_path = trim(relative_path)
    AND substr(relative_path, 1, 1) <> '/'
    AND relative_path NOT GLOB '[A-Za-z]:*'
    AND instr(relative_path, '\') = 0
    AND relative_path <> '.'
    AND relative_path <> '..'
    AND relative_path NOT LIKE './%'
    AND relative_path NOT LIKE '../%'
    AND relative_path NOT LIKE '%/./%'
    AND relative_path NOT LIKE '%/../%'
    AND relative_path NOT LIKE '%/.'
    AND relative_path NOT LIKE '%/..'
    AND relative_path NOT LIKE '%//%'
  ),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'active', 'moving', 'error')),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resource_id) REFERENCES resource_catalog (id) ON DELETE CASCADE,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(updated_at_sec AS TEXT)) = 19
    AND CAST(updated_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(updated_at_sec) = CAST(updated_at_sec AS TEXT)
  ),
  CHECK (updated_at_sec >= created_at_sec)
) STRICT;

CREATE TABLE resource_encryption_keys (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose = 'resource-data'),
  algorithm TEXT NOT NULL CHECK (algorithm = 'aegis-256'),
  key_material BLOB NOT NULL CHECK (length(key_material) = 32),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resource_id) REFERENCES resource_catalog (id) ON DELETE CASCADE,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  )
) STRICT;

CREATE TABLE db_resource_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status resource_draft_status NOT NULL,
  last_error_json JSONB CHECK (
    last_error_json IS NULL OR json_type(last_error_json, '$') = 'object'
  ),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at_sec TIMESTAMP,
  UNIQUE (resource_id, id),
  FOREIGN KEY (resource_id) REFERENCES resource_catalog (id) ON DELETE CASCADE,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(updated_at_sec AS TEXT)) = 19
    AND CAST(updated_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(updated_at_sec) = CAST(updated_at_sec AS TEXT)
  ),
  CHECK (
    applied_at_sec IS NULL
    OR (
      length(CAST(applied_at_sec AS TEXT)) = 19
      AND CAST(applied_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      AND datetime(applied_at_sec) = CAST(applied_at_sec AS TEXT)
    )
  ),
  CHECK (updated_at_sec >= created_at_sec),
  CHECK (applied_at_sec IS NULL OR applied_at_sec >= created_at_sec),
  CHECK (
    (status = 'applied' AND applied_at_sec IS NOT NULL)
    OR (status <> 'applied' AND applied_at_sec IS NULL)
  )
) STRICT;

CREATE TABLE db_resource_draft_changes (
  draft_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('structure', 'sql')),
  operation_json JSONB CHECK (
    operation_json IS NULL OR json_type(operation_json, '$') = 'object'
  ),
  sql_text TEXT NOT NULL CHECK (length(trim(sql_text)) BETWEEN 1 AND 1000000),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (draft_id, sequence),
  FOREIGN KEY (draft_id) REFERENCES db_resource_drafts (id) ON DELETE CASCADE,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    (kind = 'structure' AND operation_json IS NOT NULL)
    OR (
      kind = 'sql'
      AND (
        operation_json IS NULL
        OR COALESCE(
          json_type(operation_json, '$.type') = 'text'
          AND json_extract(operation_json, '$.type') = 'boundSql'
          AND json_type(operation_json, '$.parameters') = 'array',
          0
        )
      )
    )
  )
) STRICT;

CREATE TABLE db_resource_apply_runs (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL,
  draft_id TEXT,
  source_apply_id TEXT,
  status resource_apply_status NOT NULL,
  last_error_json JSONB CHECK (
    last_error_json IS NULL OR json_type(last_error_json, '$') = 'object'
  ),
  backup_retained BOOLEAN NOT NULL,
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at_sec TIMESTAMP,
  UNIQUE (resource_id, id),
  FOREIGN KEY (resource_id) REFERENCES resource_catalog (id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id, draft_id)
    REFERENCES db_resource_drafts (resource_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (resource_id, source_apply_id)
    REFERENCES db_resource_apply_runs (resource_id, id) ON DELETE RESTRICT,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    completed_at_sec IS NULL
    OR (
      length(CAST(completed_at_sec AS TEXT)) = 19
      AND CAST(completed_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      AND datetime(completed_at_sec) = CAST(completed_at_sec AS TEXT)
    )
  ),
  CHECK (completed_at_sec IS NULL OR completed_at_sec >= created_at_sec),
  CHECK (draft_id IS NULL OR source_apply_id IS NULL),
  CHECK (
    (status IN ('succeeded', 'failed', 'recovered') AND completed_at_sec IS NOT NULL)
    OR (status IN ('preparing', 'applying') AND completed_at_sec IS NULL)
  )
) STRICT;

CREATE TABLE db_resource_backups (
  id TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL,
  apply_run_id TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE CHECK (
    length(relative_path) BETWEEN 1 AND 1024
    AND relative_path = trim(relative_path)
    AND substr(relative_path, 1, 1) <> '/'
    AND relative_path NOT GLOB '[A-Za-z]:*'
    AND instr(relative_path, '\') = 0
    AND relative_path <> '.'
    AND relative_path <> '..'
    AND relative_path NOT LIKE './%'
    AND relative_path NOT LIKE '../%'
    AND relative_path NOT LIKE '%/./%'
    AND relative_path NOT LIKE '%/../%'
    AND relative_path NOT LIKE '%/.'
    AND relative_path NOT LIKE '%/..'
    AND relative_path NOT LIKE '%//%'
  ),
  digest_sha256 sha256_hex NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  state TEXT NOT NULL CHECK (state IN ('retained', 'deleting', 'deleted')),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at_sec TIMESTAMP NOT NULL,
  delete_after_sec TIMESTAMP,
  UNIQUE (resource_id, apply_run_id),
  FOREIGN KEY (resource_id) REFERENCES resource_catalog (id) ON DELETE RESTRICT,
  FOREIGN KEY (resource_id, apply_run_id)
    REFERENCES db_resource_apply_runs (resource_id, id) ON DELETE RESTRICT,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(verified_at_sec AS TEXT)) = 19
    AND CAST(verified_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(verified_at_sec) = CAST(verified_at_sec AS TEXT)
  ),
  CHECK (
    delete_after_sec IS NULL
    OR (
      length(CAST(delete_after_sec AS TEXT)) = 19
      AND CAST(delete_after_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      AND datetime(delete_after_sec) = CAST(delete_after_sec AS TEXT)
    )
  ),
  CHECK (verified_at_sec >= created_at_sec),
  CHECK (delete_after_sec IS NULL OR delete_after_sec >= verified_at_sec),
  CHECK ((state = 'retained' AND delete_after_sec IS NOT NULL) OR state <> 'retained')
) STRICT;

CREATE TABLE key_values (
  name TEXT PRIMARY KEY NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'json', 'number', 'bool', 'blob')),
  text_value TEXT,
  json_value JSONB,
  number_value REAL,
  bool_value BOOLEAN,
  blob_value BLOB,
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(updated_at_sec AS TEXT)) = 19
    AND CAST(updated_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(updated_at_sec) = CAST(updated_at_sec AS TEXT)
  ),
  CHECK (updated_at_sec >= created_at_sec),
  CHECK (
    (kind = 'text' AND text_value IS NOT NULL AND json_value IS NULL AND number_value IS NULL AND bool_value IS NULL AND blob_value IS NULL)
    OR (kind = 'json' AND text_value IS NULL AND json_value IS NOT NULL AND number_value IS NULL AND bool_value IS NULL AND blob_value IS NULL)
    OR (kind = 'number' AND text_value IS NULL AND json_value IS NULL AND number_value IS NOT NULL AND bool_value IS NULL AND blob_value IS NULL)
    OR (kind = 'bool' AND text_value IS NULL AND json_value IS NULL AND number_value IS NULL AND bool_value IS NOT NULL AND blob_value IS NULL)
    OR (kind = 'blob' AND text_value IS NULL AND json_value IS NULL AND number_value IS NULL AND bool_value IS NULL AND blob_value IS NOT NULL)
  )
) STRICT;

CREATE TABLE media_files (
  id TEXT PRIMARY KEY NOT NULL,
  canvas_id TEXT,
  source_hash TEXT NOT NULL CHECK (
    length(source_hash) BETWEEN 1 AND 200 AND source_hash = trim(source_hash)
  ),
  digest_sha256 sha256_hex,
  mime_type TEXT NOT NULL CHECK (
    length(mime_type) BETWEEN 3 AND 200
    AND mime_type = lower(trim(mime_type))
    AND instr(mime_type, '/') > 1
  ),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  data BLOB NOT NULL CHECK (length(data) = byte_size),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (canvas_id) REFERENCES canvases (id) ON DELETE CASCADE,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  )
) STRICT;

CREATE TABLE chats (
  id TEXT PRIMARY KEY NOT NULL,
  canvas_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'error')),
  workspace_relative_path TEXT NOT NULL UNIQUE CHECK (
    length(workspace_relative_path) BETWEEN 1 AND 1024
    AND workspace_relative_path = trim(workspace_relative_path)
    AND substr(workspace_relative_path, 1, 1) <> '/'
    AND workspace_relative_path NOT GLOB '[A-Za-z]:*'
    AND instr(workspace_relative_path, '\') = 0
    AND workspace_relative_path <> '.'
    AND workspace_relative_path <> '..'
    AND workspace_relative_path NOT LIKE './%'
    AND workspace_relative_path NOT LIKE '../%'
    AND workspace_relative_path NOT LIKE '%/./%'
    AND workspace_relative_path NOT LIKE '%/../%'
    AND workspace_relative_path NOT LIKE '%/.'
    AND workspace_relative_path NOT LIKE '%/..'
    AND workspace_relative_path NOT LIKE '%//%'
  ),
  history_relative_path TEXT NOT NULL UNIQUE CHECK (
    length(history_relative_path) BETWEEN 1 AND 1024
    AND history_relative_path = trim(history_relative_path)
    AND substr(history_relative_path, 1, 1) <> '/'
    AND history_relative_path NOT GLOB '[A-Za-z]:*'
    AND instr(history_relative_path, '\') = 0
    AND history_relative_path <> '.'
    AND history_relative_path <> '..'
    AND history_relative_path NOT LIKE './%'
    AND history_relative_path NOT LIKE '../%'
    AND history_relative_path NOT LIKE '%/./%'
    AND history_relative_path NOT LIKE '%/../%'
    AND history_relative_path NOT LIKE '%/.'
    AND history_relative_path NOT LIKE '%/..'
    AND history_relative_path NOT LIKE '%//%'
  ),
  created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (canvas_id) REFERENCES canvases (id) ON DELETE RESTRICT,
  CHECK (
    length(CAST(created_at_sec AS TEXT)) = 19
    AND CAST(created_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(created_at_sec) = CAST(created_at_sec AS TEXT)
  ),
  CHECK (
    length(CAST(updated_at_sec AS TEXT)) = 19
    AND CAST(updated_at_sec AS TEXT) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND datetime(updated_at_sec) = CAST(updated_at_sec AS TEXT)
  ),
  CHECK (updated_at_sec >= created_at_sec)
) STRICT;

CREATE INDEX canvas_items_kind_idx
  ON canvas_items (canvas_id, kind, id);

CREATE INDEX canvas_items_parent_order_idx
  ON canvas_items (canvas_id, parent_id, order_key, id);

CREATE UNIQUE INDEX canvas_items_widget_instance_idx
  ON canvas_items (widget_instance_id)
  WHERE widget_instance_id IS NOT NULL;

CREATE INDEX canvas_items_widget_key_idx
  ON canvas_items (widget_key, widget_instance_id, id)
  WHERE widget_key IS NOT NULL;

CREATE INDEX resource_catalog_status_idx
  ON resource_catalog (status, created_at_sec);

CREATE INDEX resource_catalog_kind_idx
  ON resource_catalog (kind, status);

CREATE INDEX resource_placements_cell_idx
  ON resource_placements (cell_id, status);

CREATE INDEX db_resource_drafts_resource_idx
  ON db_resource_drafts (resource_id, status, created_at_sec);

CREATE UNIQUE INDEX db_resource_drafts_one_active_idx
  ON db_resource_drafts (resource_id)
  WHERE status IN ('editing', 'applying');

CREATE INDEX db_resource_apply_runs_resource_idx
  ON db_resource_apply_runs (resource_id, status, created_at_sec);

CREATE INDEX db_resource_apply_runs_draft_idx
  ON db_resource_apply_runs (resource_id, draft_id);

CREATE INDEX db_resource_apply_runs_source_idx
  ON db_resource_apply_runs (resource_id, source_apply_id);

CREATE UNIQUE INDEX db_resource_apply_runs_one_active_idx
  ON db_resource_apply_runs (resource_id)
  WHERE status IN ('preparing', 'applying');

CREATE INDEX db_resource_backups_retention_idx
  ON db_resource_backups (state, delete_after_sec);

CREATE INDEX media_files_canvas_idx
  ON media_files (canvas_id, created_at_sec)
  WHERE canvas_id IS NOT NULL;

CREATE INDEX media_files_source_hash_idx
  ON media_files (source_hash);

CREATE INDEX media_files_digest_idx
  ON media_files (digest_sha256)
  WHERE digest_sha256 IS NOT NULL;

CREATE INDEX chats_canvas_idx
  ON chats (canvas_id, created_at_sec)
  WHERE canvas_id IS NOT NULL;
