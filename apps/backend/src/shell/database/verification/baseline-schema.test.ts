import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DATABASE_SCHEMA_VERSION } from '../CONSTANTS';
import {
  TURSO_ON_DISK_EXPERIMENTAL_FEATURES,
} from '../DbServiceTurso/DbServiceTurso';
import { fnSerializeDatabaseSchemaFingerprint } from '../DbServiceTurso/fn.database-schema-fingerprint';
import { Database } from '../DbServiceTurso/turso-native';
import { getEmbeddedMigrationPath, listEmbeddedMigrationFiles } from '../_embedded-migrations';
import { MIGRATION_FILES } from '../migrations/CONSTANTS';
import {
  EXPECTED_APPLICATION_INDEX_COUNT,
  EXPECTED_APPLICATION_TABLE_COUNT,
  EXPECTED_APPLICATION_TABLES,
  EXPECTED_DATABASE_SCHEMA_CONTRACTS,
} from '../schema/expected-schema';

const EXPECTED_TABLE_NAMES = Object.freeze([
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

const FORBIDDEN_TABLE_NAMES = Object.freeze([
  'accounts',
  'organizations',
  'organization_memberships',
  'canvas_members',
  'widget_definitions',
  'widget_definition_revisions',
  'widget_revision_sources',
  'artifact_references',
  'widget_instances',
  'resource_bindings',
  'tool_groups',
  'agent_drafts',
  'agent_previews',
  'agent_preview_revisions',
  'agent_preview_resource_bindings',
  'agent_preview_mount_leases',
  'agent_preview_source_maps',
  'widget_preview_publication_idempotency',
  'function_definitions',
  'function_invocations',
  'function_attempts',
  'invocation_leases',
  'idempotency_records',
  'resource_write_permits',
  'usage_outbox',
] as const);

type TColumnTuple = readonly [
  name: string,
  type: string,
  notNull: number,
  primaryKeyPosition: number,
  generatedKind: number,
  defaultValue: string | null,
];

const column = (
  name: string,
  type: string,
  notNull = 1,
  primaryKeyPosition = 0,
  generatedKind = 0,
  defaultValue: string | null = null,
): TColumnTuple => [name, type, notNull, primaryKeyPosition, generatedKind, defaultValue];

const timestamp = (name: string, nullable = false, defaulted = true): TColumnTuple => (
  column(name, 'TIMESTAMP', nullable ? 0 : 1, 0, 0, defaulted ? 'CURRENT_TIMESTAMP' : null)
);

const EXPECTED_COLUMNS: Readonly<Record<string, readonly TColumnTuple[]>> = Object.freeze({
  canvas_items: [
    column('canvas_id', 'TEXT', 1, 1),
    column('id', 'TEXT', 1, 1),
    column('item_json', 'JSONB'),
    column('item_revision', 'INTEGER', 1, 0, 0, '0'),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
    column('kind', 'TEXT', 1, 0, 2),
    column('parent_id', 'TEXT', 0, 0, 2),
    column('order_key', 'TEXT', 1, 0, 2),
    column('widget_instance_id', 'TEXT', 0, 0, 2),
    column('widget_key', 'TEXT', 0, 0, 2),
  ],
  canvases: [
    column('id', 'TEXT', 1, 1),
    column('name', 'TEXT'),
    column('revision', 'INTEGER', 1, 0, 0, '0'),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
  ],
  chats: [
    column('id', 'TEXT', 1, 1),
    column('canvas_id', 'TEXT', 0),
    column('name', 'TEXT'),
    column('status', 'TEXT'),
    column('workspace_relative_path', 'TEXT'),
    column('history_relative_path', 'TEXT'),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
  ],
  db_resource_apply_runs: [
    column('id', 'TEXT', 1, 1),
    column('resource_id', 'TEXT'),
    column('draft_id', 'TEXT', 0),
    column('source_apply_id', 'TEXT', 0),
    column('status', 'resource_apply_status'),
    column('last_error_json', 'JSONB', 0),
    column('backup_retained', 'BOOLEAN'),
    timestamp('created_at_sec'),
    timestamp('completed_at_sec', true, false),
  ],
  db_resource_backups: [
    column('id', 'TEXT', 1, 1),
    column('resource_id', 'TEXT'),
    column('apply_run_id', 'TEXT'),
    column('relative_path', 'TEXT'),
    column('digest_sha256', 'sha256_hex'),
    column('byte_size', 'INTEGER'),
    column('state', 'TEXT'),
    timestamp('created_at_sec'),
    timestamp('verified_at_sec', false, false),
    timestamp('delete_after_sec', true, false),
  ],
  db_resource_draft_changes: [
    column('draft_id', 'TEXT', 1, 1),
    column('sequence', 'INTEGER', 1, 1),
    column('kind', 'TEXT'),
    column('operation_json', 'JSONB', 0),
    column('sql_text', 'TEXT'),
    timestamp('created_at_sec'),
  ],
  db_resource_drafts: [
    column('id', 'TEXT', 1, 1),
    column('resource_id', 'TEXT'),
    column('name', 'TEXT'),
    column('status', 'resource_draft_status'),
    column('last_error_json', 'JSONB', 0),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
    timestamp('applied_at_sec', true, false),
  ],
  key_values: [
    column('name', 'TEXT', 1, 1),
    column('kind', 'TEXT'),
    column('text_value', 'TEXT', 0),
    column('json_value', 'JSONB', 0),
    column('number_value', 'REAL', 0),
    column('bool_value', 'BOOLEAN', 0),
    column('blob_value', 'BLOB', 0),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
  ],
  media_files: [
    column('id', 'TEXT', 1, 1),
    column('canvas_id', 'TEXT', 0),
    column('source_hash', 'TEXT'),
    column('digest_sha256', 'sha256_hex', 0),
    column('mime_type', 'TEXT'),
    column('byte_size', 'INTEGER'),
    column('data', 'BLOB'),
    timestamp('created_at_sec'),
  ],
  resource_catalog: [
    column('id', 'TEXT', 1, 1),
    column('kind', 'TEXT'),
    column('name', 'TEXT'),
    column('status', 'resource_catalog_status'),
    column('last_error_json', 'JSONB', 0),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
  ],
  resource_encryption_keys: [
    column('id', 'TEXT', 1, 1),
    column('resource_id', 'TEXT'),
    column('purpose', 'TEXT'),
    column('algorithm', 'TEXT'),
    column('key_material', 'BLOB'),
    timestamp('created_at_sec'),
  ],
  resource_placements: [
    column('resource_id', 'TEXT', 1, 1),
    column('cell_id', 'TEXT'),
    column('placement_epoch', 'INTEGER'),
    column('relative_path', 'TEXT'),
    column('status', 'TEXT'),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
  ],
  schema_migrations: [
    column('version', 'INTEGER', 0, 1),
    column('name', 'TEXT'),
    column('checksum_sha256', 'sha256_hex'),
    timestamp('applied_at_sec'),
    column('application_version', 'TEXT'),
  ],
  widget_instance_states: [
    column('canvas_id', 'TEXT', 1, 1),
    column('element_id', 'TEXT', 1, 1),
    column('instance_id', 'TEXT'),
    column('version', 'INTEGER', 1, 0, 0, '1'),
    column('state_json', 'JSONB'),
    timestamp('created_at_sec'),
    timestamp('updated_at_sec'),
  ],
});

type TForeignKey = Readonly<{
  columns: readonly string[];
  referencesTable: string;
  referencesColumns: readonly string[];
  onDelete: 'CASCADE' | 'RESTRICT';
}>;

const EXPECTED_FOREIGN_KEYS: Readonly<Record<string, readonly TForeignKey[]>> = Object.freeze({
  canvas_items: [
    { columns: ['canvas_id'], referencesTable: 'canvases', referencesColumns: ['id'], onDelete: 'CASCADE' },
  ],
  canvases: [],
  chats: [
    { columns: ['canvas_id'], referencesTable: 'canvases', referencesColumns: ['id'], onDelete: 'RESTRICT' },
  ],
  db_resource_apply_runs: [
    { columns: ['resource_id'], referencesTable: 'resource_catalog', referencesColumns: ['id'], onDelete: 'CASCADE' },
    { columns: ['resource_id', 'draft_id'], referencesTable: 'db_resource_drafts', referencesColumns: ['resource_id', 'id'], onDelete: 'RESTRICT' },
    { columns: ['resource_id', 'source_apply_id'], referencesTable: 'db_resource_apply_runs', referencesColumns: ['resource_id', 'id'], onDelete: 'RESTRICT' },
  ],
  db_resource_backups: [
    { columns: ['resource_id'], referencesTable: 'resource_catalog', referencesColumns: ['id'], onDelete: 'RESTRICT' },
    { columns: ['resource_id', 'apply_run_id'], referencesTable: 'db_resource_apply_runs', referencesColumns: ['resource_id', 'id'], onDelete: 'RESTRICT' },
  ],
  db_resource_draft_changes: [
    { columns: ['draft_id'], referencesTable: 'db_resource_drafts', referencesColumns: ['id'], onDelete: 'CASCADE' },
  ],
  db_resource_drafts: [
    { columns: ['resource_id'], referencesTable: 'resource_catalog', referencesColumns: ['id'], onDelete: 'CASCADE' },
  ],
  key_values: [],
  media_files: [
    { columns: ['canvas_id'], referencesTable: 'canvases', referencesColumns: ['id'], onDelete: 'CASCADE' },
  ],
  resource_catalog: [],
  resource_encryption_keys: [
    { columns: ['resource_id'], referencesTable: 'resource_catalog', referencesColumns: ['id'], onDelete: 'CASCADE' },
  ],
  resource_placements: [
    { columns: ['resource_id'], referencesTable: 'resource_catalog', referencesColumns: ['id'], onDelete: 'CASCADE' },
  ],
  schema_migrations: [],
  widget_instance_states: [
    { columns: ['canvas_id', 'element_id'], referencesTable: 'canvas_items', referencesColumns: ['canvas_id', 'id'], onDelete: 'CASCADE' },
  ],
});

const EXPECTED_UNIQUE_KEYS: Readonly<Record<string, readonly (readonly string[])[]>> = Object.freeze({
  canvas_items: [],
  canvases: [['name']],
  chats: [['workspace_relative_path'], ['history_relative_path']],
  db_resource_apply_runs: [['resource_id', 'id']],
  db_resource_backups: [['resource_id', 'apply_run_id'], ['relative_path']],
  db_resource_draft_changes: [],
  db_resource_drafts: [['resource_id', 'id']],
  key_values: [],
  media_files: [],
  resource_catalog: [['name']],
  resource_encryption_keys: [['resource_id']],
  resource_placements: [['relative_path']],
  schema_migrations: [['name']],
  widget_instance_states: [['instance_id']],
});

const EXPECTED_PRIMARY_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  canvas_items: ['canvas_id', 'id'],
  canvases: ['id'],
  chats: ['id'],
  db_resource_apply_runs: ['id'],
  db_resource_backups: ['id'],
  db_resource_draft_changes: ['draft_id', 'sequence'],
  db_resource_drafts: ['id'],
  key_values: ['name'],
  media_files: ['id'],
  resource_catalog: ['id'],
  resource_encryption_keys: ['id'],
  resource_placements: ['resource_id'],
  schema_migrations: ['version'],
  widget_instance_states: ['canvas_id', 'element_id'],
});

type TIndex = Readonly<{
  table: string;
  columns: readonly string[];
  unique: number;
  partial: number;
}>;

const EXPECTED_INDEXES: Readonly<Record<string, TIndex>> = Object.freeze({
  canvas_items_kind_idx: { table: 'canvas_items', columns: ['canvas_id', 'kind', 'id'], unique: 0, partial: 0 },
  canvas_items_parent_order_idx: { table: 'canvas_items', columns: ['canvas_id', 'parent_id', 'order_key', 'id'], unique: 0, partial: 0 },
  canvas_items_widget_instance_idx: { table: 'canvas_items', columns: ['widget_instance_id'], unique: 1, partial: 1 },
  canvas_items_widget_key_idx: { table: 'canvas_items', columns: ['widget_key', 'widget_instance_id', 'id'], unique: 0, partial: 1 },
  chats_canvas_idx: { table: 'chats', columns: ['canvas_id', 'created_at_sec'], unique: 0, partial: 1 },
  db_resource_apply_runs_draft_idx: { table: 'db_resource_apply_runs', columns: ['resource_id', 'draft_id'], unique: 0, partial: 0 },
  db_resource_apply_runs_one_active_idx: { table: 'db_resource_apply_runs', columns: ['resource_id'], unique: 1, partial: 1 },
  db_resource_apply_runs_resource_idx: { table: 'db_resource_apply_runs', columns: ['resource_id', 'status', 'created_at_sec'], unique: 0, partial: 0 },
  db_resource_apply_runs_source_idx: { table: 'db_resource_apply_runs', columns: ['resource_id', 'source_apply_id'], unique: 0, partial: 0 },
  db_resource_backups_retention_idx: { table: 'db_resource_backups', columns: ['state', 'delete_after_sec'], unique: 0, partial: 0 },
  db_resource_drafts_one_active_idx: { table: 'db_resource_drafts', columns: ['resource_id'], unique: 1, partial: 1 },
  db_resource_drafts_resource_idx: { table: 'db_resource_drafts', columns: ['resource_id', 'status', 'created_at_sec'], unique: 0, partial: 0 },
  media_files_canvas_idx: { table: 'media_files', columns: ['canvas_id', 'created_at_sec'], unique: 0, partial: 1 },
  media_files_digest_idx: { table: 'media_files', columns: ['digest_sha256'], unique: 0, partial: 1 },
  media_files_source_hash_idx: { table: 'media_files', columns: ['source_hash'], unique: 0, partial: 0 },
  resource_catalog_kind_idx: { table: 'resource_catalog', columns: ['kind', 'status'], unique: 0, partial: 0 },
  resource_catalog_status_idx: { table: 'resource_catalog', columns: ['status', 'created_at_sec'], unique: 0, partial: 0 },
  resource_placements_cell_idx: { table: 'resource_placements', columns: ['cell_id', 'status'], unique: 0, partial: 0 },
});

const EXPECTED_DOMAINS = Object.freeze([
  {
    name: 'resource_apply_status',
    sql: "CREATE DOMAIN resource_apply_status AS TEXT CHECK (value IN ('preparing', 'applying', 'succeeded', 'failed', 'recovered'))",
  },
  {
    name: 'resource_catalog_status',
    sql: "CREATE DOMAIN resource_catalog_status AS TEXT CHECK (value IN ('created', 'provisioning', 'ready', 'migrating', 'error', 'deleting'))",
  },
  {
    name: 'resource_draft_status',
    sql: "CREATE DOMAIN resource_draft_status AS TEXT CHECK (value IN ('editing', 'applying', 'applied', 'discarded', 'error'))",
  },
  {
    name: 'sha256_hex',
    sql: "CREATE DOMAIN sha256_hex AS TEXT CHECK (length (value) = 64 AND value = lower (value) AND value NOT GLOB '*[^0-9a-f]*')",
  },
] as const);

const EXPECTED_FINGERPRINT_SHA256 = 'd0c52dcf3196b531b024b9d4e1ccc941507a76efc2ca3b9517f69dfc4163c580';
const temporaryRoots: string[] = [];
const databases: Database[] = [];

const identifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const key = (columns: readonly string[]): string => columns.join('\u0000');

async function openBaseline(): Promise<Database> {
  const root = await mkdtemp(path.join(tmpdir(), 'omnidraw-baseline-schema-'));
  temporaryRoots.push(root);
  const database = new Database(path.join(root, 'main.db'), {
    experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
  });
  databases.push(database);
  await database.connect();
  await database.exec('PRAGMA foreign_keys = ON');
  await database.exec('PRAGMA ignore_check_constraints = 0');
  await database.exec(await Bun.file(MIGRATION_FILES[0]!.path).text());
  return database;
}

async function indexColumns(database: Database, indexName: string): Promise<readonly string[]> {
  const rows = await (await database.prepare(`PRAGMA index_info(${identifier(indexName)})`)).all() as Array<{
    name: string;
    seqno: number;
  }>;
  return rows.toSorted((left, right) => left.seqno - right.seqno).map((row) => row.name);
}

async function foreignKeys(database: Database, table: string): Promise<readonly TForeignKey[]> {
  const rows = await (await database.prepare(`PRAGMA foreign_key_list(${identifier(table)})`)).all() as Array<{
    from: string;
    id: number;
    on_delete: TForeignKey['onDelete'];
    seq: number;
    table: string;
    to: string;
  }>;
  const groups = new Map<number, typeof rows>();
  for (const row of rows) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
  return [...groups.values()].map((group) => {
    const ordered = group.toSorted((left, right) => left.seq - right.seq);
    return {
      columns: ordered.map((row) => row.from),
      referencesTable: ordered[0]!.table,
      referencesColumns: ordered.map((row) => row.to),
      onDelete: ordered[0]!.on_delete,
    };
  }).toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('single-user 000 baseline schema', () => {
  test('registers and embeds exactly one rewritten baseline migration', async () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(0);
    expect(MIGRATION_FILES).toHaveLength(1);
    expect(MIGRATION_FILES[0]).toMatchObject({ version: 0, name: '000-initial.sql', type: 'sql' });
    expect(listEmbeddedMigrationFiles()).toEqual(['000-initial.sql']);
    expect(getEmbeddedMigrationPath('000-initial.sql')).toBe(MIGRATION_FILES[0]!.path);
    expect(getEmbeddedMigrationPath('001-widget-revision-sequence.sql')).toBeNull();

    const migrationDirectory = path.dirname(new URL('../migrations/000-initial.sql', import.meta.url).pathname);
    const migrationSqlFiles = (await readdir(migrationDirectory))
      .filter((entry) => entry.endsWith('.sql'))
      .toSorted();
    expect(migrationSqlFiles).toEqual(['000-initial.sql']);

    const sql = await Bun.file(MIGRATION_FILES[0]!.path).text();
    expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK)\b/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+schema_migrations/i);
    expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(sql).not.toMatch(/\b(?:ALTER|DROP)\s+TABLE\b/i);
    expect(sql).not.toMatch(/\b(?:compatib|upgrade|copier|export_receipt|dual_write)\b/i);
  });

  test('has exactly 14 independently pinned STRICT tables and no identity or deleted structure', async () => {
    const database = await openBaseline();
    const tableRows = await (await database.prepare('PRAGMA table_list')).all() as Array<{
      name: string;
      schema: string;
      strict: number;
      type: string;
    }>;
    const applicationTables = tableRows
      .filter((row) => (
        row.schema === 'main'
        && row.type === 'table'
        && !row.name.startsWith('sqlite_')
        && !row.name.startsWith('__turso_internal_')
      ))
      .toSorted((left, right) => left.name.localeCompare(right.name));

    expect(EXPECTED_TABLE_NAMES).toHaveLength(14);
    expect(applicationTables.map((row) => row.name)).toEqual([...EXPECTED_TABLE_NAMES]);
    expect(applicationTables.every((row) => row.strict === 1)).toBe(true);
    expect(EXPECTED_APPLICATION_TABLE_COUNT).toBe(14);
    expect([...EXPECTED_APPLICATION_TABLES]).toEqual([...EXPECTED_TABLE_NAMES]);

    const columns = (await Promise.all(EXPECTED_TABLE_NAMES.map(async (table) => (
      (await (await database.prepare(`PRAGMA table_xinfo(${identifier(table)})`)).all() as Array<{ name: string }>)
        .map((row) => row.name)
    )))).flat();
    expect(FORBIDDEN_TABLE_NAMES).toHaveLength(25);
    expect(EXPECTED_TABLE_NAMES.filter((name) => FORBIDDEN_TABLE_NAMES.includes(name as never))).toEqual([]);
    expect(columns).not.toContain('org_id');
    expect(columns).not.toContain('account_id');
    expect(columns.some((name) => /(?:^|_)(?:owner|role|seat|invite)(?:_|$)/.test(name))).toBe(false);
    expect(columns).not.toContain('access_policy');
    expect(columns.some((name) => name.endsWith('_at_ms'))).toBe(false);
    expect(EXPECTED_TABLE_NAMES).toContain('chats');
    expect(EXPECTED_TABLE_NAMES).not.toContain('agent_chats' as never);
  });

  test('matches every raw declared column type, default, generated kind, unique key, and foreign key', async () => {
    const database = await openBaseline();
    expect(Object.keys(EXPECTED_COLUMNS).toSorted()).toEqual([...EXPECTED_TABLE_NAMES]);
    expect(Object.keys(EXPECTED_FOREIGN_KEYS).toSorted()).toEqual([...EXPECTED_TABLE_NAMES]);
    expect(Object.keys(EXPECTED_UNIQUE_KEYS).toSorted()).toEqual([...EXPECTED_TABLE_NAMES]);
    expect(Object.keys(EXPECTED_PRIMARY_KEYS).toSorted()).toEqual([...EXPECTED_TABLE_NAMES]);

    for (const table of EXPECTED_TABLE_NAMES) {
      const rows = await (await database.prepare(`PRAGMA table_xinfo(${identifier(table)})`)).all() as Array<{
        dflt_value: string | null;
        hidden: number;
        name: string;
        notnull: number;
        pk: number;
        type: string;
      }>;
      expect(rows.map((row): TColumnTuple => [
        row.name,
        row.type,
        row.notnull,
        row.pk,
        row.hidden,
        row.dflt_value,
      ])).toEqual([...EXPECTED_COLUMNS[table]!]);
      expect(rows.every((row) => row.type !== 'ANY')).toBe(true);

      const indexRows = await (await database.prepare(`PRAGMA index_list(${identifier(table)})`)).all() as Array<{
        name: string;
        origin: string;
      }>;
      const uniqueKeys: string[] = [];
      for (const index of indexRows.filter((row) => row.origin === 'u')) {
        uniqueKeys.push(key(await indexColumns(database, index.name)));
      }
      expect(uniqueKeys.toSorted()).toEqual(EXPECTED_UNIQUE_KEYS[table]!.map(key).toSorted());
      const primaryKeyIndex = indexRows.find((row) => row.origin === 'pk');
      const primaryKey = primaryKeyIndex
        ? await indexColumns(database, primaryKeyIndex.name)
        : rows.filter((row) => row.pk > 0).map((row) => row.name);
      expect(primaryKey).toEqual([...EXPECTED_PRIMARY_KEYS[table]!]);
      expect(await foreignKeys(database, table)).toEqual(
        EXPECTED_FOREIGN_KEYS[table]!.toSorted(
          (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
      );
    }

    const canvasItemSql = await (await database.prepare(`
      SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'canvas_items'
    `)).get() as { sql: string };
    expect(canvasItemSql.sql).toContain('$.extensions."omnidraw:widget".instanceId');
    expect(canvasItemSql.sql).toContain('$.extensions."omnidraw:widget".widgetKey');
  });

  test('pins all 18 named indexes and stays below the 25-index ceiling', async () => {
    const database = await openBaseline();
    const explicitIndexes = await (await database.prepare(`
      SELECT name, tbl_name AS table_name
      FROM sqlite_schema
      WHERE type = 'index' AND name NOT GLOB 'sqlite_autoindex_*'
      ORDER BY name
    `)).all() as Array<{ name: string; table_name: string }>;

    expect(Object.keys(EXPECTED_INDEXES)).toHaveLength(18);
    expect(EXPECTED_APPLICATION_INDEX_COUNT).toBe(18);
    expect(explicitIndexes).toHaveLength(18);
    expect(explicitIndexes.length).toBeLessThanOrEqual(25);
    expect(explicitIndexes.map((row) => row.name)).toEqual(Object.keys(EXPECTED_INDEXES).toSorted());

    for (const [name, expected] of Object.entries(EXPECTED_INDEXES)) {
      expect(explicitIndexes.find((row) => row.name === name)).toEqual({
        name,
        table_name: expected.table,
      });
      const index = (await (await database.prepare(`PRAGMA index_list(${identifier(expected.table)})`)).all())
        .find((row) => (row as { name?: unknown }).name === name) as {
          partial: number;
          unique: number;
        } | undefined;
      expect(index).toMatchObject({ partial: expected.partial, unique: expected.unique });
      expect(await indexColumns(database, name)).toEqual(expected.columns);
    }
  });

  test('pins exact reusable domains and the whole-schema fingerprint as startup authority', async () => {
    const database = await openBaseline();
    const [schemaObjects, domains] = await Promise.all([
      (await database.prepare(`
        SELECT type, name, tbl_name AS table_name, sql
        FROM sqlite_schema
        WHERE type IN ('table', 'index', 'view', 'trigger')
          AND name NOT GLOB 'sqlite_*'
        ORDER BY type, name, tbl_name
      `)).all() as Promise<Array<{
        name: string;
        sql: string | null;
        table_name: string;
        type: 'index' | 'table' | 'trigger' | 'view';
      }>>,
      (await database.prepare(`
        SELECT name, sql FROM __turso_internal_types ORDER BY name
      `)).all() as Promise<Array<{ name: string; sql: string }>>,
    ]);
    expect(domains).toEqual([...EXPECTED_DOMAINS]);

    const fingerprint = new Bun.CryptoHasher('sha256')
      .update(fnSerializeDatabaseSchemaFingerprint([
        ...schemaObjects.map((row) => ({
          name: row.name,
          sql: row.sql,
          tableName: row.table_name,
          type: row.type,
        })),
        ...domains.map((row) => ({
          name: row.name,
          sql: row.sql,
          tableName: '__turso_internal_types',
          type: 'domain' as const,
        })),
      ]))
      .digest('hex');
    expect(fingerprint).toBe(EXPECTED_FINGERPRINT_SHA256);
    expect(EXPECTED_DATABASE_SCHEMA_CONTRACTS).toHaveLength(1);
    expect(EXPECTED_DATABASE_SCHEMA_CONTRACTS[0]).toMatchObject({
      version: 0,
      fingerprintSha256: EXPECTED_FINGERPRINT_SHA256,
    });
    expect([...EXPECTED_DATABASE_SCHEMA_CONTRACTS[0]!.domains]).toEqual([...EXPECTED_DOMAINS]);
    expect(Object.keys(EXPECTED_DATABASE_SCHEMA_CONTRACTS[0]!.indexes).toSorted())
      .toEqual(Object.keys(EXPECTED_INDEXES).toSorted());
    expect(Object.keys(EXPECTED_DATABASE_SCHEMA_CONTRACTS[0]!.tables).toSorted())
      .toEqual([...EXPECTED_TABLE_NAMES]);

    const nonTableObjects = schemaObjects.filter((row) => row.type === 'view' || row.type === 'trigger');
    expect(nonTableObjects).toEqual([]);
  });
});
