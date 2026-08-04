export type TExpectedColumn = {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKeyPosition: number;
  readonly generated: 'none' | 'virtual' | 'stored';
};

export type TExpectedForeignKey = {
  readonly columns: readonly string[];
  readonly referencesTable: string;
  readonly referencesColumns: readonly string[];
  readonly onDelete: 'CASCADE' | 'RESTRICT';
};

export type TExpectedTable = {
  readonly columns: readonly TExpectedColumn[];
  readonly primaryKey: readonly string[];
  readonly unique: readonly (readonly string[])[];
  readonly foreignKeys: readonly TExpectedForeignKey[];
  readonly requiredSqlFragments?: readonly string[];
};

export type TExpectedIndex = {
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly partial: boolean;
};

export type TExpectedSchema = Readonly<Record<string, TExpectedTable>>;
export type TExpectedIndexManifest = Readonly<Record<string, TExpectedIndex>>;

export type TExpectedSchemaObjectManifest = Readonly<{
  views: readonly string[];
  triggers: readonly string[];
}>;

export type TExpectedDomain = Readonly<{
  name: string;
  sql: string;
}>;

export type TExpectedDatabaseSchemaContract = Readonly<{
  fingerprintSha256: string;
  domains: readonly TExpectedDomain[];
  indexes: TExpectedIndexManifest;
  objects: TExpectedSchemaObjectManifest;
  tables: TExpectedSchema;
  version: number;
}>;

export const EXPECTED_APPLICATION_TABLES = Object.freeze([
  'canvas_items',
  'canvases',
  'chats',
  'db_resource_apply_runs',
  'db_resource_backups',
  'db_resource_draft_changes',
  'db_resource_drafts',
  'key_values',
  'media_files',
  'resource_catalog',
  'resource_encryption_keys',
  'resource_placements',
  'schema_migrations',
  'widget_instance_states',
] as const);

export const EXPECTED_APPLICATION_TABLE_COUNT = EXPECTED_APPLICATION_TABLES.length;
export const EXPECTED_APPLICATION_INDEX_COUNT = 18;

export const EXPECTED_APPLICATION_SCHEMA_OBJECTS = Object.freeze({
  views: Object.freeze([]),
  triggers: Object.freeze([]),
}) satisfies TExpectedSchemaObjectManifest;

export const EXPECTED_DOMAINS = Object.freeze([
  Object.freeze({
    name: 'resource_apply_status',
    sql: "CREATE DOMAIN resource_apply_status AS TEXT CHECK (value IN ('preparing', 'applying', 'succeeded', 'failed', 'recovered'))",
  }),
  Object.freeze({
    name: 'resource_catalog_status',
    sql: "CREATE DOMAIN resource_catalog_status AS TEXT CHECK (value IN ('created', 'provisioning', 'ready', 'migrating', 'error', 'deleting'))",
  }),
  Object.freeze({
    name: 'resource_draft_status',
    sql: "CREATE DOMAIN resource_draft_status AS TEXT CHECK (value IN ('editing', 'applying', 'applied', 'discarded', 'error'))",
  }),
  Object.freeze({
    name: 'sha256_hex',
    sql: "CREATE DOMAIN sha256_hex AS TEXT CHECK (length (value) = 64 AND value = lower (value) AND value NOT GLOB '*[^0-9a-f]*')",
  }),
] satisfies readonly TExpectedDomain[]);

const column = (
  name: string,
  type: string,
  notNull: boolean,
  primaryKeyPosition = 0,
  generated: TExpectedColumn['generated'] = 'none',
): TExpectedColumn => ({ name, type, notNull, primaryKeyPosition, generated });

const required = (name: string, type = 'TEXT', primaryKeyPosition = 0) => (
  column(name, type, true, primaryKeyPosition)
);
const optional = (name: string, type = 'TEXT') => column(name, type, false);

export const EXPECTED_BASELINE_SCHEMA = Object.freeze({
  canvas_items: {
    columns: [
      required('canvas_id', 'TEXT', 1),
      required('id', 'TEXT', 2),
      required('item_json', 'JSONB'),
      required('item_revision', 'INTEGER'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
      column('kind', 'TEXT', true, 0, 'virtual'),
      column('parent_id', 'TEXT', false, 0, 'virtual'),
      column('order_key', 'TEXT', true, 0, 'virtual'),
      column('widget_instance_id', 'TEXT', false, 0, 'virtual'),
      column('widget_key', 'TEXT', false, 0, 'virtual'),
    ],
    primaryKey: ['canvas_id', 'id'],
    unique: [],
    foreignKeys: [
      {
        columns: ['canvas_id'],
        referencesTable: 'canvases',
        referencesColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ],
    requiredSqlFragments: [
      'item_json JSONB NOT NULL',
      'created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'updated_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'kind TEXT AS',
      'parent_id TEXT AS',
      'order_key TEXT AS',
      'widget_instance_id TEXT AS',
      'widget_key TEXT AS',
    ],
  },
  canvases: {
    columns: [
      required('id', 'TEXT', 1),
      required('name'),
      required('revision', 'INTEGER'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [['name']],
    foreignKeys: [],
  },
  chats: {
    columns: [
      required('id', 'TEXT', 1),
      optional('canvas_id'),
      required('name'),
      required('status'),
      required('workspace_relative_path'),
      required('history_relative_path'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [['workspace_relative_path'], ['history_relative_path']],
    foreignKeys: [
      {
        columns: ['canvas_id'],
        referencesTable: 'canvases',
        referencesColumns: ['id'],
        onDelete: 'RESTRICT',
      },
    ],
  },
  db_resource_apply_runs: {
    columns: [
      required('id', 'TEXT', 1),
      required('resource_id'),
      optional('draft_id'),
      optional('source_apply_id'),
      required('status', 'resource_apply_status'),
      optional('last_error_json', 'JSONB'),
      required('backup_retained', 'BOOLEAN'),
      required('created_at_sec', 'TIMESTAMP'),
      optional('completed_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [['resource_id', 'id']],
    foreignKeys: [
      {
        columns: ['resource_id', 'source_apply_id'],
        referencesTable: 'db_resource_apply_runs',
        referencesColumns: ['resource_id', 'id'],
        onDelete: 'RESTRICT',
      },
      {
        columns: ['resource_id', 'draft_id'],
        referencesTable: 'db_resource_drafts',
        referencesColumns: ['resource_id', 'id'],
        onDelete: 'RESTRICT',
      },
      {
        columns: ['resource_id'],
        referencesTable: 'resource_catalog',
        referencesColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },
  db_resource_backups: {
    columns: [
      required('id', 'TEXT', 1),
      required('resource_id'),
      required('apply_run_id'),
      required('relative_path'),
      required('digest_sha256', 'sha256_hex'),
      required('byte_size', 'INTEGER'),
      required('state'),
      required('created_at_sec', 'TIMESTAMP'),
      required('verified_at_sec', 'TIMESTAMP'),
      optional('delete_after_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [['resource_id', 'apply_run_id'], ['relative_path']],
    foreignKeys: [
      {
        columns: ['resource_id', 'apply_run_id'],
        referencesTable: 'db_resource_apply_runs',
        referencesColumns: ['resource_id', 'id'],
        onDelete: 'RESTRICT',
      },
      {
        columns: ['resource_id'],
        referencesTable: 'resource_catalog',
        referencesColumns: ['id'],
        onDelete: 'RESTRICT',
      },
    ],
  },
  db_resource_draft_changes: {
    columns: [
      required('draft_id', 'TEXT', 1),
      required('sequence', 'INTEGER', 2),
      required('kind'),
      optional('operation_json', 'JSONB'),
      required('sql_text'),
      required('created_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['draft_id', 'sequence'],
    unique: [],
    foreignKeys: [
      {
        columns: ['draft_id'],
        referencesTable: 'db_resource_drafts',
        referencesColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },
  db_resource_drafts: {
    columns: [
      required('id', 'TEXT', 1),
      required('resource_id'),
      required('name'),
      required('status', 'resource_draft_status'),
      optional('last_error_json', 'JSONB'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
      optional('applied_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [['resource_id', 'id']],
    foreignKeys: [
      {
        columns: ['resource_id'],
        referencesTable: 'resource_catalog',
        referencesColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },
  key_values: {
    columns: [
      required('name', 'TEXT', 1),
      required('kind'),
      optional('text_value'),
      optional('json_value', 'JSONB'),
      optional('number_value', 'REAL'),
      optional('bool_value', 'BOOLEAN'),
      optional('blob_value', 'BLOB'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['name'],
    unique: [],
    foreignKeys: [],
  },
  media_files: {
    columns: [
      required('id', 'TEXT', 1),
      optional('canvas_id'),
      required('source_hash'),
      optional('digest_sha256', 'sha256_hex'),
      required('mime_type'),
      required('byte_size', 'INTEGER'),
      required('data', 'BLOB'),
      required('created_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [],
    foreignKeys: [
      {
        columns: ['canvas_id'],
        referencesTable: 'canvases',
        referencesColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },
  resource_catalog: {
    columns: [
      required('id', 'TEXT', 1),
      required('kind'),
      required('name'),
      required('status', 'resource_catalog_status'),
      optional('last_error_json', 'JSONB'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [['name']],
    foreignKeys: [],
  },
  resource_encryption_keys: {
    columns: [
      required('id', 'TEXT', 1),
      required('resource_id'),
      required('purpose'),
      required('algorithm'),
      required('key_material', 'BLOB'),
      required('created_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['id'],
    unique: [['resource_id']],
    foreignKeys: [
      {
        columns: ['resource_id'],
        referencesTable: 'resource_catalog',
        referencesColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },
  resource_placements: {
    columns: [
      required('resource_id', 'TEXT', 1),
      required('cell_id'),
      required('placement_epoch', 'INTEGER'),
      required('relative_path'),
      required('status'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['resource_id'],
    unique: [['relative_path']],
    foreignKeys: [
      {
        columns: ['resource_id'],
        referencesTable: 'resource_catalog',
        referencesColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },
  schema_migrations: {
    columns: [
      column('version', 'INTEGER', false, 1),
      required('name'),
      required('checksum_sha256', 'sha256_hex'),
      required('applied_at_sec', 'TIMESTAMP'),
      required('application_version'),
    ],
    primaryKey: ['version'],
    unique: [['name']],
    foreignKeys: [],
  },
  widget_instance_states: {
    columns: [
      required('canvas_id', 'TEXT', 1),
      required('element_id', 'TEXT', 2),
      required('instance_id'),
      required('version', 'INTEGER'),
      required('state_json', 'JSONB'),
      required('created_at_sec', 'TIMESTAMP'),
      required('updated_at_sec', 'TIMESTAMP'),
    ],
    primaryKey: ['canvas_id', 'element_id'],
    unique: [['instance_id']],
    foreignKeys: [
      {
        columns: ['canvas_id', 'element_id'],
        referencesTable: 'canvas_items',
        referencesColumns: ['canvas_id', 'id'],
        onDelete: 'CASCADE',
      },
    ],
  },
} satisfies TExpectedSchema);

export const EXPECTED_INDEXES = Object.freeze({
  canvas_items_kind_idx: {
    table: 'canvas_items', columns: ['canvas_id', 'kind', 'id'], unique: false, partial: false,
  },
  canvas_items_parent_order_idx: {
    table: 'canvas_items', columns: ['canvas_id', 'parent_id', 'order_key', 'id'], unique: false, partial: false,
  },
  canvas_items_widget_instance_idx: {
    table: 'canvas_items', columns: ['widget_instance_id'], unique: true, partial: true,
  },
  canvas_items_widget_key_idx: {
    table: 'canvas_items', columns: ['widget_key', 'widget_instance_id', 'id'], unique: false, partial: true,
  },
  chats_canvas_idx: {
    table: 'chats', columns: ['canvas_id', 'created_at_sec'], unique: false, partial: true,
  },
  db_resource_apply_runs_draft_idx: {
    table: 'db_resource_apply_runs', columns: ['resource_id', 'draft_id'], unique: false, partial: false,
  },
  db_resource_apply_runs_one_active_idx: {
    table: 'db_resource_apply_runs', columns: ['resource_id'], unique: true, partial: true,
  },
  db_resource_apply_runs_resource_idx: {
    table: 'db_resource_apply_runs', columns: ['resource_id', 'status', 'created_at_sec'], unique: false, partial: false,
  },
  db_resource_apply_runs_source_idx: {
    table: 'db_resource_apply_runs', columns: ['resource_id', 'source_apply_id'], unique: false, partial: false,
  },
  db_resource_backups_retention_idx: {
    table: 'db_resource_backups', columns: ['state', 'delete_after_sec'], unique: false, partial: false,
  },
  db_resource_drafts_one_active_idx: {
    table: 'db_resource_drafts', columns: ['resource_id'], unique: true, partial: true,
  },
  db_resource_drafts_resource_idx: {
    table: 'db_resource_drafts', columns: ['resource_id', 'status', 'created_at_sec'], unique: false, partial: false,
  },
  media_files_canvas_idx: {
    table: 'media_files', columns: ['canvas_id', 'created_at_sec'], unique: false, partial: true,
  },
  media_files_digest_idx: {
    table: 'media_files', columns: ['digest_sha256'], unique: false, partial: true,
  },
  media_files_source_hash_idx: {
    table: 'media_files', columns: ['source_hash'], unique: false, partial: false,
  },
  resource_catalog_kind_idx: {
    table: 'resource_catalog', columns: ['kind', 'status'], unique: false, partial: false,
  },
  resource_catalog_status_idx: {
    table: 'resource_catalog', columns: ['status', 'created_at_sec'], unique: false, partial: false,
  },
  resource_placements_cell_idx: {
    table: 'resource_placements', columns: ['cell_id', 'status'], unique: false, partial: false,
  },
} satisfies TExpectedIndexManifest);

export const EXPECTED_DATABASE_SCHEMA_CONTRACTS = Object.freeze([
  Object.freeze({
    fingerprintSha256: 'd0c52dcf3196b531b024b9d4e1ccc941507a76efc2ca3b9517f69dfc4163c580',
    domains: EXPECTED_DOMAINS,
    indexes: EXPECTED_INDEXES,
    objects: EXPECTED_APPLICATION_SCHEMA_OBJECTS,
    tables: EXPECTED_BASELINE_SCHEMA,
    version: 0,
  }),
] satisfies readonly TExpectedDatabaseSchemaContract[]);
