-- Capsule 0.10 native API-group descriptors coexist with immutable 0.9.4
-- descriptors. The managed runner disables foreign keys while these two
-- parent tables are rebuilt and verifies the complete schema before commit.

CREATE TEMP TABLE a102_widget_definition_revisions_data
AS SELECT * FROM widget_definition_revisions;

DROP TABLE widget_definition_revisions;

CREATE TABLE widget_definition_revisions (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  ui_artifact_id TEXT NOT NULL,
  ui_artifact_kind TEXT NOT NULL DEFAULT 'ui' CHECK (ui_artifact_kind = 'ui'),
  server_artifact_id TEXT,
  server_artifact_kind TEXT CHECK (
    (server_artifact_id IS NULL AND server_artifact_kind IS NULL)
    OR (server_artifact_id IS NOT NULL AND server_artifact_kind = 'server')
  ),
  manifest_json JSON NOT NULL CHECK (json_type(manifest_json) = 'object'),
  contract_digest_sha256 sha256_hex NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  function_descriptors_json JSON NOT NULL
    DEFAULT '{"format":"omnidraw.server-functions.v1","functions":[]}'
    CHECK (
      json_type(function_descriptors_json) = 'object'
      AND json_extract(function_descriptors_json, '$.format') = 'omnidraw.server-functions.v1'
      AND json_type(function_descriptors_json, '$.functions') = 'array'
    ),
  function_descriptors_digest_sha256 sha256_hex NOT NULL
    DEFAULT '2ffcc4002f0abc5490138a0da6fcce85b1ee82bc9e56f0000fb552953839f40b',
  ui_runtime_json JSON NOT NULL CHECK (
    json_type(ui_runtime_json) = 'object'
    AND (
      (
        json_extract(ui_runtime_json, '$.format') = 'omnidraw.capsule-runtime.v1'
        AND json_type(ui_runtime_json, '$.target') = 'object'
        AND json_type(ui_runtime_json, '$.apiContract') IS NULL
      )
      OR (
        json_extract(ui_runtime_json, '$.format') = 'omnidraw.capsule-runtime.v2'
        AND json_type(ui_runtime_json, '$.target') IS NULL
        AND json_type(ui_runtime_json, '$.apiContract') = 'object'
        AND json_extract(ui_runtime_json, '$.apiContract.format') = 'capsule-api-groups-v1'
        AND json_type(ui_runtime_json, '$.apiContract.groups') = 'array'
        AND length(json_extract(ui_runtime_json, '$.apiContract.bundleDigest')) = 71
        AND substr(json_extract(ui_runtime_json, '$.apiContract.bundleDigest'), 1, 7) = 'sha256:'
      )
    )
    AND json_type(ui_runtime_json, '$.budgets') = 'object'
    AND json_type(ui_runtime_json, '$.capabilityRequests') = 'array'
    AND json_type(ui_runtime_json, '$.channels') IN ('null', 'object')
    AND json_extract(ui_runtime_json, '$.parkability.parkable') = 0
    AND json_type(ui_runtime_json, '$.signatureKeyIds') = 'array'
    AND json_array_length(ui_runtime_json, '$.signatureKeyIds') BETWEEN 1 AND 32
    AND json_remove(
      ui_runtime_json,
      '$.format',
      '$.capsuleArtifactHash',
      '$.target',
      '$.apiContract',
      '$.budgets',
      '$.capabilityRequests',
      '$.channels',
      '$.parkability',
      '$.signatureKeyIds'
    ) = '{}'
  ),
  capsule_artifact_hash TEXT NOT NULL CHECK (
    length(capsule_artifact_hash) = 71
    AND substr(capsule_artifact_hash, 1, 7) = 'sha256:'
    AND substr(capsule_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
    AND json_extract(ui_runtime_json, '$.capsuleArtifactHash') = capsule_artifact_hash
  ),
  capability_contract_digest_sha256 sha256_hex NOT NULL,
  channel_contract_digest_sha256 sha256_hex NOT NULL,
  capsule_build_identity_json JSON NOT NULL CHECK (
    json_type(capsule_build_identity_json) = 'object'
    AND json_extract(capsule_build_identity_json, '$.packageName') = '@omnidraw/capsule'
    AND length(json_extract(capsule_build_identity_json, '$.packageVersion')) BETWEEN 1 AND 100
    AND length(json_extract(capsule_build_identity_json, '$.buildApiVersion')) BETWEEN 1 AND 100
    AND length(json_extract(capsule_build_identity_json, '$.packageDigest')) = 71
    AND length(json_extract(capsule_build_identity_json, '$.runtimeBuildDigest')) = 71
    AND substr(json_extract(capsule_build_identity_json, '$.packageDigest'), 1, 7) = 'sha256:'
    AND substr(json_extract(capsule_build_identity_json, '$.runtimeBuildDigest'), 1, 7) = 'sha256:'
    AND json_remove(
      capsule_build_identity_json,
      '$.packageName',
      '$.packageVersion',
      '$.packageDigest',
      '$.buildApiVersion',
      '$.runtimeBuildDigest'
    ) = '{}'
  ),
  build_policy_id TEXT NOT NULL CHECK (length(trim(build_policy_id)) BETWEEN 1 AND 200),
  server_runtime_abi TEXT CHECK (
    (server_artifact_id IS NULL AND server_runtime_abi IS NULL)
    OR (server_artifact_id IS NOT NULL AND length(trim(server_runtime_abi)) BETWEEN 1 AND 100)
  ),
  construction_contract_digest_sha256 sha256_hex NOT NULL
    DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  distribution_provenance_json JSON NOT NULL
    DEFAULT '{"kind":"external-distribution","producer":{"name":"unavailable","version":"0","digest":"sha256:0000000000000000000000000000000000000000000000000000000000000000"},"sourceRevision":"0000000000000000000000000000000000000000000000000000000000000000","dependencyLockDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000","buildConfigurationDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}'
  CHECK (
    json_type(distribution_provenance_json) = 'object'
    AND json_extract(distribution_provenance_json, '$.kind') = 'external-distribution'
    AND json_type(distribution_provenance_json, '$.producer') = 'object'
    AND length(json_extract(distribution_provenance_json, '$.producer.name')) BETWEEN 1 AND 300
    AND length(json_extract(distribution_provenance_json, '$.producer.version')) BETWEEN 1 AND 300
    AND length(json_extract(distribution_provenance_json, '$.producer.digest')) = 71
    AND substr(json_extract(distribution_provenance_json, '$.producer.digest'), 1, 7) = 'sha256:'
    AND length(json_extract(distribution_provenance_json, '$.sourceRevision')) = 64
    AND length(json_extract(distribution_provenance_json, '$.dependencyLockDigest')) = 71
    AND substr(json_extract(distribution_provenance_json, '$.dependencyLockDigest'), 1, 7) = 'sha256:'
    AND length(json_extract(distribution_provenance_json, '$.buildConfigurationDigest')) = 71
    AND substr(json_extract(distribution_provenance_json, '$.buildConfigurationDigest'), 1, 7) = 'sha256:'
  ),
  contract_format_version INTEGER NOT NULL DEFAULT 4
    CHECK (contract_format_version IN (3, 4)),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, definition_id, id),
  UNIQUE (org_id, definition_id, revision_number),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, definition_id) REFERENCES widget_definitions (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, ui_artifact_id, ui_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, server_artifact_id, server_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  CHECK (server_artifact_id IS NULL OR server_artifact_id <> ui_artifact_id)
) STRICT;

INSERT INTO widget_definition_revisions
SELECT * FROM a102_widget_definition_revisions_data;

DROP TABLE a102_widget_definition_revisions_data;

CREATE TEMP TABLE a102_agent_preview_revisions_data
AS SELECT * FROM agent_preview_revisions;

DROP TABLE agent_preview_revisions;

CREATE TABLE agent_preview_revisions (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 300),
  preview_id TEXT NOT NULL CHECK (length(trim(preview_id)) BETWEEN 1 AND 300),
  draft_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  draft_revision_sha256 sha256_hex NOT NULL,
  committed_mutation_id TEXT NOT NULL CHECK (
    length(trim(committed_mutation_id)) BETWEEN 1 AND 1024
  ),
  source_snapshot_id TEXT NOT NULL CHECK (length(trim(source_snapshot_id)) BETWEEN 1 AND 300),
  source_digest_sha256 sha256_hex NOT NULL,
  source_artifact_id TEXT NOT NULL,
  source_artifact_kind TEXT NOT NULL DEFAULT 'source' CHECK (source_artifact_kind = 'source'),
  source_artifact_digest_sha256 sha256_hex NOT NULL,
  manifest_json JSON NOT NULL CHECK (json_type(manifest_json) = 'object'),
  function_descriptors_json JSON NOT NULL CHECK (
    json_type(function_descriptors_json) = 'object'
    AND json_extract(function_descriptors_json, '$.format') = 'omnidraw.server-functions.v1'
    AND json_type(function_descriptors_json, '$.functions') = 'array'
  ),
  function_descriptors_digest_sha256 sha256_hex NOT NULL,
  capability_contract_digest_sha256 sha256_hex NOT NULL,
  channel_contract_digest_sha256 sha256_hex NOT NULL,
  construction_contract_digest_sha256 sha256_hex NOT NULL,
  preview_contract_digest_sha256 sha256_hex NOT NULL,
  builder_identity TEXT NOT NULL CHECK (length(trim(builder_identity)) BETWEEN 1 AND 300),
  capsule_build_identity_json JSON NOT NULL CHECK (
    json_type(capsule_build_identity_json) = 'object'
  ),
  build_policy_id TEXT NOT NULL CHECK (length(trim(build_policy_id)) BETWEEN 1 AND 300),
  distribution_provenance_json JSON NOT NULL CHECK (
    json_type(distribution_provenance_json) = 'object'
    AND json_extract(distribution_provenance_json, '$.kind') = 'external-distribution'
  ),
  unsigned_ui_artifact_id TEXT NOT NULL,
  unsigned_ui_artifact_kind TEXT NOT NULL DEFAULT 'unsigned_ui'
    CHECK (unsigned_ui_artifact_kind = 'unsigned_ui'),
  unsigned_ui_artifact_digest_sha256 sha256_hex NOT NULL,
  ui_artifact_id TEXT NOT NULL,
  ui_artifact_kind TEXT NOT NULL DEFAULT 'ui' CHECK (ui_artifact_kind = 'ui'),
  ui_artifact_digest_sha256 sha256_hex NOT NULL,
  ui_runtime_json JSON NOT NULL CHECK (
    json_type(ui_runtime_json) = 'object'
    AND json_extract(ui_runtime_json, '$.format') IN (
      'omnidraw.capsule-runtime.v1',
      'omnidraw.capsule-runtime.v2'
    )
  ),
  capsule_artifact_hash TEXT NOT NULL CHECK (
    length(capsule_artifact_hash) = 71
    AND substr(capsule_artifact_hash, 1, 7) = 'sha256:'
    AND substr(capsule_artifact_hash, 8) = lower(substr(capsule_artifact_hash, 8))
    AND substr(capsule_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  server_artifact_id TEXT,
  server_artifact_kind TEXT CHECK (
    (server_artifact_id IS NULL AND server_artifact_kind IS NULL)
    OR (server_artifact_id IS NOT NULL AND server_artifact_kind = 'server')
  ),
  server_artifact_digest_sha256 sha256_hex,
  server_runtime_abi TEXT CHECK (
    server_runtime_abi IS NULL OR length(trim(server_runtime_abi)) BETWEEN 1 AND 100
  ),
  binding_revision INTEGER NOT NULL CHECK (binding_revision >= 0),
  binding_plan_digest_sha256 sha256_hex NOT NULL,
  build_sequence INTEGER NOT NULL CHECK (build_sequence >= 1),
  diagnostics_json JSON NOT NULL CHECK (
    json_type(diagnostics_json) = 'array'
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, preview_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, preview_id) REFERENCES agent_previews (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, draft_id) REFERENCES agent_drafts (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, source_artifact_id, source_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, unsigned_ui_artifact_id, unsigned_ui_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, ui_artifact_id, ui_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, server_artifact_id, server_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  CHECK (draft_revision_sha256 = source_digest_sha256),
  CHECK (
    (server_artifact_id IS NULL AND server_artifact_kind IS NULL
      AND server_artifact_digest_sha256 IS NULL AND server_runtime_abi IS NULL)
    OR (server_artifact_id IS NOT NULL AND server_artifact_kind = 'server'
      AND server_artifact_digest_sha256 IS NOT NULL AND server_runtime_abi IS NOT NULL)
  ),
  CHECK (
    source_artifact_id <> unsigned_ui_artifact_id
    AND source_artifact_id <> ui_artifact_id
    AND unsigned_ui_artifact_id <> ui_artifact_id
    AND (server_artifact_id IS NULL OR (
      server_artifact_id <> source_artifact_id
      AND server_artifact_id <> unsigned_ui_artifact_id
      AND server_artifact_id <> ui_artifact_id
    ))
  )
) STRICT;

INSERT INTO agent_preview_revisions
SELECT * FROM a102_agent_preview_revisions_data;

DROP TABLE a102_agent_preview_revisions_data;

CREATE INDEX widget_definition_revisions_lookup_idx
  ON widget_definition_revisions (org_id, definition_id, revision_number);
CREATE INDEX widget_definition_revisions_ui_artifact_idx
  ON widget_definition_revisions (org_id, ui_artifact_id, ui_artifact_kind);
CREATE INDEX widget_definition_revisions_server_artifact_idx
  ON widget_definition_revisions (org_id, server_artifact_id, server_artifact_kind);
CREATE INDEX widget_definition_revisions_capsule_artifact_idx
  ON widget_definition_revisions (org_id, capsule_artifact_hash);

CREATE INDEX agent_preview_revisions_preview_idx
  ON agent_preview_revisions (org_id, preview_id, build_sequence, created_at_ms);
CREATE INDEX agent_preview_revisions_draft_idx
  ON agent_preview_revisions (org_id, draft_id, definition_id, created_at_ms);
CREATE INDEX agent_preview_revisions_definition_idx
  ON agent_preview_revisions (org_id, definition_id, created_at_ms);
CREATE INDEX agent_preview_revisions_source_artifact_idx
  ON agent_preview_revisions (org_id, source_artifact_id, source_artifact_kind);
CREATE INDEX agent_preview_revisions_unsigned_ui_artifact_idx
  ON agent_preview_revisions (
    org_id, unsigned_ui_artifact_id, unsigned_ui_artifact_kind
  );
CREATE INDEX agent_preview_revisions_ui_artifact_idx
  ON agent_preview_revisions (org_id, ui_artifact_id, ui_artifact_kind);
CREATE INDEX agent_preview_revisions_server_artifact_idx
  ON agent_preview_revisions (org_id, server_artifact_id, server_artifact_kind);
