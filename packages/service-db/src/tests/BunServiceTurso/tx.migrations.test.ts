import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { connect, Database } from "@tursodatabase/database";
import { listMigrationFiles } from "../../../src/DbServiceTurso/list-migration-files";
import { txRunMigrations } from "../../../src/DbServiceTurso/tx.migrations";
import { listEmbeddedMigrationFiles } from "../../../src/_embedded-migrations";
import { runAgentStorageMigration } from '../../../src/DbServiceTurso/migration-files/014-migrate-agent-storage';
import type { TMigration } from '../../../src/DbServiceTurso/migration-types';
import path from "node:path"
import * as fs from "node:fs/promises";
import { tmpdir } from 'node:os';

const temporaryRoots: string[] = [];

async function migrationPortal(dataDir: string, database: Database) {
  return { db: database, dataDir, fs, path, platform: process.platform } as const;
}

async function inMemoryDb() {
  // @ts-expect-error custom_types not typed yet
  return connect(":memory:", { experimental: ["custom_types"] });
}

async function expectSqlConstraintFailure(action: () => Promise<unknown>) {
  let error: unknown;

  try {
    await action();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(Error);
}

describe("tx.migrations", () => {
  let db!: Database;

  beforeEach(async () => {
    db = await inMemoryDb();
    await db.exec("PRAGMA foreign_keys = ON");
  });

  afterEach(async () => {
    await db.close();
    await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  test("test tables are present", async () => {
    await txRunMigrations({ db, Bun, path }, {});

    const stmt = await db.prepare("select name from sqlite_master where type = 'table' order by name");
    const tables = await stmt.all();
    const tNames = tables.map((table) => table.name);
    expect(tNames).toContain("automerge_repo_data");
    expect(tNames).toContain("accounts");
    expect(tNames).toContain("canvas");
    expect(tNames).toContain("canvas_members");
    expect(tNames).toContain("media_files");
    expect(tNames).toContain("actor_definitions");
    expect(tNames).toContain("actor_instances");
    expect(tNames).toContain("actor_connections");
    expect(tNames).toContain("kv");
    expect(tNames).toContain("tool_groups");
    expect(tNames).toContain("actor_resources");
    expect(tNames).toContain("actor_resource_bindings");
    expect(tNames).toContain("actor_resource_key_values");
    expect(tNames).toContain("db_resource_drafts");
    expect(tNames).toContain("db_resource_draft_changes");
    expect(tNames).toContain("db_resource_apply_runs");
    expect(tNames).toContain("db_resource_apply_instance_results");
    expect(tNames).not.toContain("db_resource_schemas");
    expect(tNames).not.toContain("db_resource_schema_migrations");
    expect(tNames).not.toContain("db_resource_configurations");
    expect(tNames).not.toContain("db_resource_migration_blocks");
    expect(tNames).toContain("migrations");

    const migrationStmt = await db.prepare("select name, hash_hex, applied_at from migrations order by name");
    const migrations = await migrationStmt.all();
    const migrationFiles = listMigrationFiles();
    expect(migrations).toHaveLength(migrationFiles.length);
    expect(migrations.map((migration) => migration.name)).toEqual(
      migrationFiles.map((file) => file.name).sort(),
    );
    for (const migration of migrations) {
      expect(migration.hash_hex).toEqual(expect.any(String));
      expect(migration.hash_hex).not.toBe("");
      expect(migration.applied_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  test("source migration registration matches every discovered SQL file in order", async () => {
    const migrationDirectory = new URL("../../../src/DbServiceTurso/migration-files/", import.meta.url).pathname;
    const discovered = (await fs.readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const registered = listMigrationFiles().filter((file) => file.type === 'sql').map((file) => file.name);

    expect(registered).toEqual(discovered);
    expect(listEmbeddedMigrationFiles()).toEqual(discovered);
    expect(listMigrationFiles().map((migration) => migration.name).slice(-3)).toEqual([
      '013-add-db-resource-restore-source.sql',
      '014-migrate-agent-storage.ts',
      '015-add-actor-resource-name-keys.sql',
    ]);
  });

  test('repairs the former unreleased name-key migration record without rerunning its SQL', async () => {
    const migrations = listMigrationFiles();
    const prior = migrations.filter((migration): migration is Extract<TMigration, { type: 'sql' }> => (
      migration.type === 'sql' && migration.name < '014'
    ));
    await db.exec(`CREATE TABLE migrations (
      name TEXT NOT NULL,
      hash_hex TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    const insert = await db.prepare('INSERT INTO migrations (name, hash_hex) VALUES (?, ?)');
    for (const migration of prior) {
      const sql = await Bun.file(migration.path).text();
      await db.exec(sql);
      await insert.run(migration.name, Bun.hash(sql).toString(16));
    }
    const renamed = migrations.find((migration): migration is Extract<TMigration, { type: 'sql' }> => (
      migration.type === 'sql' && migration.name === '015-add-actor-resource-name-keys.sql'
    ));
    expect(renamed).toBeDefined();
    const renamedSql = await Bun.file(renamed!.path).text();
    await db.exec(renamedSql);
    await insert.run('014-add-actor-resource-name-keys.sql', Bun.hash(renamedSql).toString(16));

    await txRunMigrations({ db, Bun, path }, {});

    const records = await (await db.prepare("SELECT name FROM migrations WHERE name LIKE '%actor-resource-name-keys.sql' ORDER BY name")).all();
    expect(records).toEqual([{ name: '015-add-actor-resource-name-keys.sql' }]);
    const columns = await (await db.prepare('PRAGMA table_info(actor_resources)')).all();
    expect(columns.filter((column) => column.name === 'name_key')).toHaveLength(1);
  });

  test('migrates the released v0.4.7 history and concatenated workspace without changing Pi identity', async () => {
    const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'vc-migration-014-release-'));
    temporaryRoots.push(dataDir);
    const chatId = '4464085d-66d8-4baf-bbab-2c8574e4bd2f';
    const widgetId = '7f5a8541-65e7-48ec-85c4-440e5c007d88';
    const agentRoot = path.join(dataDir, 'pi', 'agent');
    const oldHistory = path.join(agentRoot, 'sessions', chatId);
    const oldWorkspace = path.join(agentRoot, 'widget-cwd', `${widgetId}${chatId}`);
    await fs.mkdir(oldHistory, { recursive: true });
    await fs.mkdir(oldWorkspace, { recursive: true });
    await fs.writeFile(path.join(oldHistory, 'latest.jsonl'), `${JSON.stringify({ type: 'session', id: 'pi-owned-id', cwd: oldWorkspace })}\n${JSON.stringify({ type: 'message', text: 'keep' })}\n`);
    await fs.writeFile(path.join(oldHistory, 'older.jsonl'), `${JSON.stringify({ type: 'session', id: 'older-pi-id', cwd: oldWorkspace })}\n`);
    await fs.writeFile(path.join(oldWorkspace, 'bash-note.txt'), 'preserved');

    expect(await runAgentStorageMigration(await migrationPortal(dataDir, db))).toEqual({ warnings: [] });
    const chatRoot = path.join(agentRoot, 'chats', 'legacy', chatId);
    const workspace = path.join(chatRoot, 'workspace');
    expect(await fs.readFile(path.join(workspace, 'bash-note.txt'), 'utf8')).toBe('preserved');
    const header = JSON.parse((await fs.readFile(path.join(chatRoot, 'history', 'latest.jsonl'), 'utf8')).split('\n')[0]!);
    expect(header).toEqual({ type: 'session', id: 'pi-owned-id', cwd: workspace });
    expect(await fs.readFile(path.join(chatRoot, 'history', 'older.jsonl'), 'utf8')).toContain('older-pi-id');
    expect(JSON.parse(await fs.readFile(path.join(chatRoot, 'chat.json'), 'utf8'))).toEqual({ version: 1, sessionId: chatId, legacy: true });
    await expect(fs.lstat(path.join(agentRoot, 'sessions'))).rejects.toThrow();
    await expect(fs.lstat(path.join(agentRoot, 'widget-cwd'))).rejects.toThrow();

    expect(await runAgentStorageMigration(await migrationPortal(dataDir, db))).toEqual({ warnings: [] });
  });

  test('moves development roots, recreates owned mounts, and preserves unknown and colliding entries', async () => {
    const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'vc-migration-014-dev-'));
    temporaryRoots.push(dataDir);
    const agentRoot = path.join(dataDir, 'pi', 'agent');
    const oldDraft = path.join(agentRoot, 'widget-drafts', 'Weather');
    const oldWorkspace = path.join(agentRoot, 'chat-cwd', 'chat-a');
    await fs.mkdir(oldDraft, { recursive: true });
    await fs.mkdir(path.join(oldWorkspace, 'widgets'), { recursive: true });
    await fs.writeFile(path.join(oldDraft, 'vibecanvas.json'), '{}');
    await fs.writeFile(path.join(agentRoot, 'widget-drafts', 'manual.txt'), 'unknown');
    await fs.writeFile(path.join(oldWorkspace, 'notes.txt'), 'keep me');
    await fs.symlink(path.relative(path.join(oldWorkspace, 'widgets'), oldDraft), path.join(oldWorkspace, 'widgets', 'Weather'), 'dir');
    const outside = path.join(dataDir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'untouched');
    await fs.symlink(outside, path.join(oldWorkspace, 'widgets', 'Escape'), 'dir');
    await fs.writeFile(path.join(agentRoot, 'chat-cwd', '.DS_Store'), 'unknown');
    const collisionSource = path.join(agentRoot, 'widget-cwd', 'Published');
    const collisionTarget = path.join(agentRoot, 'widgets', 'published', 'Published');
    await fs.mkdir(collisionSource, { recursive: true });
    await fs.mkdir(collisionTarget, { recursive: true });
    await fs.writeFile(path.join(collisionSource, 'source.txt'), 'source');
    await fs.writeFile(path.join(collisionTarget, 'target.txt'), 'target');

    const result = await runAgentStorageMigration(await migrationPortal(dataDir, db));
    const workspace = path.join(agentRoot, 'chats', 'legacy', 'chat-a', 'workspace');
    const migratedDraft = path.join(agentRoot, 'widgets', 'drafts', 'Weather');
    expect(await fs.readFile(path.join(workspace, 'notes.txt'), 'utf8')).toBe('keep me');
    expect(await fs.realpath(path.join(workspace, 'widgets', 'Weather'))).toBe(await fs.realpath(migratedDraft));
    expect(await fs.realpath(path.join(workspace, 'widgets', 'Escape'))).toBe(await fs.realpath(outside));
    expect(await fs.readFile(path.join(outside, 'private.txt'), 'utf8')).toBe('untouched');
    expect(await fs.readFile(path.join(agentRoot, 'chat-cwd', '.DS_Store'), 'utf8')).toBe('unknown');
    expect(await fs.readFile(path.join(collisionSource, 'source.txt'), 'utf8')).toBe('source');
    expect(await fs.readFile(path.join(collisionTarget, 'target.txt'), 'utf8')).toBe('target');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('PRESERVED_UNKNOWN_WIDGET_ENTRY'),
      expect.stringContaining('DESTINATION_COLLISION'),
      expect.stringContaining('UNOWNED_MOUNT'),
    ]));
  });

  test('handles transcript-only, workspace-only, and empty legacy chats', async () => {
    const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'vc-migration-014-partial-'));
    temporaryRoots.push(dataDir);
    const agentRoot = path.join(dataDir, 'pi', 'agent');
    await fs.mkdir(path.join(agentRoot, 'sessions', 'transcript-only'), { recursive: true });
    await fs.writeFile(path.join(agentRoot, 'sessions', 'transcript-only', 'one.jsonl'), `${JSON.stringify({ type: 'session', id: 'pi-one', cwd: '/old' })}\n`);
    await fs.mkdir(path.join(agentRoot, 'sessions', 'empty-chat'), { recursive: true });
    await fs.mkdir(path.join(agentRoot, 'chat-cwd', 'workspace-only'), { recursive: true });
    await fs.writeFile(path.join(agentRoot, 'chat-cwd', 'workspace-only', 'note.txt'), 'workspace');

    await runAgentStorageMigration(await migrationPortal(dataDir, db));
    expect(await fs.readFile(path.join(agentRoot, 'chats', 'legacy', 'transcript-only', 'history', 'one.jsonl'), 'utf8')).toContain('pi-one');
    expect(await fs.readFile(path.join(agentRoot, 'chats', 'legacy', 'workspace-only', 'workspace', 'note.txt'), 'utf8')).toBe('workspace');
    expect(JSON.parse(await fs.readFile(path.join(agentRoot, 'chats', 'legacy', 'empty-chat', 'chat.json'), 'utf8'))).toMatchObject({ sessionId: 'empty-chat' });
  });

  test('records the TypeScript migration only after filesystem success and retries cleanly', async () => {
    const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'vc-migration-014-retry-'));
    temporaryRoots.push(dataDir);
    const prior = listMigrationFiles().filter((migration): migration is Extract<TMigration, { type: 'sql' }> => migration.type === 'sql' && migration.name < '014');
    for (const migration of prior) await db.exec(await Bun.file(migration.path).text());
    await db.exec('CREATE TABLE migrations (name TEXT NOT NULL, hash_hex TEXT NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    const insert = await db.prepare("INSERT INTO migrations (name, hash_hex) VALUES (?, 'prior')");
    for (const migration of prior) await insert.run(migration.name);
    const source = path.join(dataDir, 'pi', 'agent', 'sessions', 'chat-a');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'history.jsonl'), `${JSON.stringify({ type: 'session', id: 'pi-id', cwd: '/old' })}\n`);
    let failed = false;
    const failingFs = {
      ...fs,
      rename: async (from: any, to: any) => {
        if (!failed) { failed = true; throw Object.assign(new Error('transient rename failure'), { code: 'EIO' }); }
        return fs.rename(from, to);
      },
    };

    await expect(txRunMigrations({ db, Bun, path, dataDir, fs: failingFs, platform: process.platform }, {})).rejects.toThrow('transient');
    expect(await (await db.prepare("SELECT name FROM migrations WHERE name = '014-migrate-agent-storage.ts'")).get()).toBeUndefined();

    await txRunMigrations({ db, Bun, path, dataDir, fs, platform: process.platform }, {});
    expect(await (await db.prepare("SELECT name FROM migrations WHERE name = '014-migrate-agent-storage.ts'")).get()).toEqual({ name: '014-migrate-agent-storage.ts' });
    expect(await fs.readFile(path.join(dataDir, 'pi', 'agent', 'chats', 'legacy', 'chat-a', 'history', 'history.jsonl'), 'utf8')).toContain('pi-id');
  });

  test("migrations 012 and 013 replace legacy metadata and add restore provenance", async () => {
    const migrationFiles = listMigrationFiles();
    const legacyFiles = migrationFiles.slice(0, 12);
    for (const file of legacyFiles) {
      if (file.type !== 'sql') throw new Error('Expected a SQL migration.');
      await db.exec(await Bun.file(file.path).text());
    }
    await db.exec(`
      CREATE TABLE migrations (
        name TEXT NOT NULL,
        hash_hex TEXT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const recordMigration = await db.prepare("INSERT INTO migrations (name, hash_hex) VALUES (?, 'legacy')");
    for (const file of legacyFiles) {
      await recordMigration.run(file.name);
    }

    await db.exec(`
      INSERT INTO canvas (id, name, automerge_url)
      VALUES ('canvas', 'Canvas', 'automerge:upgrade');
      INSERT INTO actor_definitions (name, slug, manifest_path)
      VALUES ('Widget', 'widget', 'widgets/widget/vibecanvas.json');
      INSERT INTO actor_instances (
        id, canvas_id, element_id, actor_definition_name, display_name,
        status, machine_state, machine_context
      ) VALUES ('instance', 'canvas', 'element', 'Widget', 'Widget', 'stopped', 'ready', '{}');
      INSERT INTO actor_resources (id, kind, name, status)
      VALUES ('resource', 'db', 'Database', 'ready');
      INSERT INTO actor_resource_bindings (
        actor_definition_name, slot_name, resource_id, allow_read, allow_write
      ) VALUES ('Widget', 'database', 'resource', true, true);
      INSERT INTO db_resource_schemas (id, name, status)
      VALUES ('schema', 'Legacy schema', 'published');
      INSERT INTO db_resource_configurations (resource_id, schema_id, applied_version, target_version)
      VALUES ('resource', 'schema', 0, 0);
      INSERT INTO db_resource_migration_blocks (
        resource_id, actor_instance_id, reason, restart_when_compatible,
        expected_schema_id, expected_version, actual_schema_id, actual_version
      ) VALUES ('resource', 'instance', 'schemaMismatch', true, 'schema', 0, 'other', 0);
    `);

    await txRunMigrations({ db, Bun, path }, {});

    expect(await (await db.prepare("SELECT id, kind, name FROM actor_resources WHERE id = 'resource'")).get()).toEqual({
      id: "resource",
      kind: "db",
      name: "Database",
    });
    expect(await (await db.prepare("SELECT resource_id FROM actor_resource_bindings WHERE slot_name = 'database'")).get()).toEqual({
      resource_id: "resource",
    });
    expect(await (await db.prepare("SELECT id FROM actor_instances WHERE id = 'instance'")).get()).toEqual({ id: "instance" });
    const tables = await (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")).all();
    const names = tables.map((table) => table.name);
    expect(names).toContain("db_resource_drafts");
    expect(names).not.toContain("db_resource_configurations");
    expect(names).not.toContain("db_resource_migration_blocks");
    const applyColumns = await (await db.prepare("PRAGMA table_info(db_resource_apply_runs)")).all() as { name: string }[];
    expect(applyColumns.map((column) => column.name)).toContain("source_apply_id");
  });

  test("actor and db resource tables enforce domains and strict entry constraints", async () => {
    await txRunMigrations({ db, Bun, path }, {});

    const actorResourceColumns = await (await db.prepare("pragma table_info(actor_resources)")).all() as { name: string }[];
    expect(actorResourceColumns.map((column) => column.name)).not.toContain("metadata");
    const insertResource = await db.prepare("insert into actor_resources (id, kind, name, status) values (?, ?, ?, ?)");
    await insertResource.run("kv-ok", "kv", "KV", "ready");
    await expectSqlConstraintFailure(() => insertResource.run("kind-bad", "store", "Bad", "ready"));
    await expectSqlConstraintFailure(() => insertResource.run("status-bad", "kv", "Bad", "online"));

    const insertEntry = await db.prepare("insert into actor_resource_key_values (resource_id, key, value, revision) values (?, ?, ?, ?)");
    await insertEntry.run("kv-ok", "valid", "null", 1);
    await expectSqlConstraintFailure(() => insertEntry.run("kv-ok", "   ", "null", 1));
    await expectSqlConstraintFailure(() => insertEntry.run("kv-ok", "negative", "null", 0));
    await expectSqlConstraintFailure(() => insertEntry.run("kv-ok", "invalid-json", "not-json", 1));

    await insertResource.run("db-ok", "db", "DB", "ready");
    const insertDraft = await db.prepare("insert into db_resource_drafts (id, resource_id, name, status) values (?, ?, ?, ?)");
    await insertDraft.run("draft-ok", "db-ok", "Draft", "editing");
    await expectSqlConstraintFailure(() => insertDraft.run("draft-bad", "db-ok", "Draft", "published"));

    const insertChange = await db.prepare("insert into db_resource_draft_changes (draft_id, sequence, kind, operation, sql) values (?, ?, ?, ?, ?)");
    await insertChange.run("draft-ok", 1, "structure", '{"type":"createTable"}', "CREATE TABLE notes (id TEXT)");
    await expectSqlConstraintFailure(() => insertChange.run("draft-ok", 2, "migration", null, "SELECT 1"));
    await expectSqlConstraintFailure(() => insertChange.run("draft-ok", 2, "sql", "not-json", "SELECT 1"));
  });

  test("tool groups are independent and enforce non-empty names", async () => {
    await txRunMigrations({ db, Bun, path }, {});

    const insertGroup = await db.prepare("insert into tool_groups (name, json) values (?, ?)");
    await insertGroup.run("Productivity", '{"lucidIcon":"LayoutGrid"}');
    await insertGroup.run("Unstyled", null);

    const groups = await (await db.prepare("select name, json from tool_groups order by name")).all();
    expect(groups).toEqual([
      { name: "Productivity", json: '{"lucidIcon":"LayoutGrid"}' },
      { name: "Unstyled", json: null },
    ]);

    await expectSqlConstraintFailure(() => insertGroup.run("   ", null));
  });

  test("accounts table", async () => {
    await txRunMigrations({ db, Bun, path }, {});

    const insertAccount = await db.prepare("insert into accounts (id, display_name) values (?, ?)");
    await insertAccount.run("account-1", "Test Account");

    const selectAccount = await db.prepare("select id, kind, display_name, role, is_autogenerated, created_at, updated_at from accounts where id = ?");
    const account = await selectAccount.get("account-1");

    expect(account).toEqual({
      id: "account-1",
      kind: "user",
      display_name: "Test Account",
      role: "member",
      is_autogenerated: 1,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(account.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(account.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    await Bun.sleep(1100); // at least 1 second after the update trigger should have fired

    const updateAccount = await db.prepare("update accounts set display_name = ? where id = ?");
    await updateAccount.run("Renamed Account", "account-1");

    const updatedAccount = await selectAccount.get("account-1");
    expect(updatedAccount.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(updatedAccount.updated_at).not.toBe(account.updated_at);
    expect(updatedAccount.created_at).toBe(account.created_at);
  });

  test("canvas tables", async () => {
    await txRunMigrations({ db, Bun, path }, {});

    const insertAccount = await db.prepare("insert into accounts (id, display_name) values (?, ?)");
    await insertAccount.run("account-1", "Test Account");

    const insertCanvas = await db.prepare("insert into canvas (id, name, automerge_url) values (?, ?, ?)");
    await insertCanvas.run("canvas-1", "Test Canvas", "automerge:abc");

    const selectCanvas = await db.prepare("select id, name, automerge_url, created_at from canvas where id = ?");
    const canvas = await selectCanvas.get("canvas-1");

    expect(canvas).toEqual({
      id: "canvas-1",
      name: "Test Canvas",
      automerge_url: "automerge:abc",
      created_at: expect.any(String),
    });
    expect(canvas.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const insertCanvasMember = await db.prepare("insert into canvas_members (canvas_id, account_id, role) values (?, ?, ?)");
    await insertCanvasMember.run("canvas-1", "account-1", "editor");

    const selectCanvasMember = await db.prepare("select canvas_id, account_id, role, created_at, updated_at from canvas_members where canvas_id = ? and account_id = ?");
    const member = await selectCanvasMember.get("canvas-1", "account-1");

    expect(member).toEqual({
      canvas_id: "canvas-1",
      account_id: "account-1",
      role: "editor",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(member.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(member.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("actor tables accept connected data and enforce constraints", async () => {
    await txRunMigrations({ db, Bun, path }, {});

    const insertCanvas = await db.prepare("insert into canvas (id, name, automerge_url) values (?, ?, ?)");
    await insertCanvas.run("canvas-actor", "Actor Canvas", "automerge:actor");

    const insertDefinition = await db.prepare("insert into actor_definitions (name, slug, manifest_path) values (?, ?, ?)");
    await insertDefinition.run("Counter", "counter", "actors/counter/vibecanvas.json");

    await expectSqlConstraintFailure(() => insertDefinition.run("Counter Copy", "counter", "actors/counter-copy/vibecanvas.json"));

    const insertInstance = await db.prepare("insert into actor_instances (id, canvas_id, element_id, actor_definition_name, display_name, status, machine_state, machine_context) values (?, ?, ?, ?, ?, ?, ?, ?)");
    await insertInstance.run("actor-1", "canvas-actor", "element-1", "Counter", "Counter A", "created", "idle", '{"count":0}');
    await insertInstance.run("actor-2", "canvas-actor", "element-2", "Counter", "Counter B", "running", "idle", '{"count":10}');

    const selectInstance = await db.prepare("select id, canvas_id, actor_definition_name, display_name, status, machine_context from actor_instances where id = ?");
    const instance = await selectInstance.get("actor-1");
    expect(instance).toEqual({
      id: "actor-1",
      canvas_id: "canvas-actor",
      actor_definition_name: "Counter",
      display_name: "Counter A",
      status: "created",
      machine_context: '{"count":0}',
    });

    const insertInvalidInstance = await db.prepare("insert into actor_instances (id, canvas_id, element_id, actor_definition_name, display_name, status, machine_state) values (?, ?, ?, ?, ?, ?, ?)");
    await expectSqlConstraintFailure(() => insertInvalidInstance.run("actor-bad", "canvas-actor", "element-bad", "Counter", "Broken", "not-a-status", "idle"));

    const insertConnection = await db.prepare("insert into actor_connections (id, canvas_id, source_actor_instance_id, target_actor_instance_id, label, msg_name_whitelist, style) values (?, ?, ?, ?, ?, ?, ?)");
    await insertConnection.run("connection-1", "canvas-actor", "actor-1", "actor-2", "A to B", '["increment"]', '{"stroke":"blue"}');

    const selectConnection = await db.prepare("select id, enabled, label, msg_name_whitelist, style from actor_connections where id = ?");
    const connection = await selectConnection.get("connection-1");
    expect(connection).toEqual({
      id: "connection-1",
      enabled: 1,
      label: "A to B",
      msg_name_whitelist: '["increment"]',
      style: '{"stroke":"blue"}',
    });

    await expectSqlConstraintFailure(() => insertConnection.run("connection-bad", "canvas-actor", "missing-source", "actor-2", null, null, "{}"));
  });

  test("media files table stores image bytes as blobs", async () => {
    await txRunMigrations({ db, Bun, path }, {});

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const insertFile = await db.prepare("insert into media_files (id, hash, mime_type, data) values (?, ?, ?, ?)");
    await insertFile.run("media-1", "hash-1", "image/png", bytes);

    const selectFile = await db.prepare("select id, hash, mime_type, data, typeof(data) as data_type, created_at from media_files where id = ?");
    const file = await selectFile.get("media-1");

    expect(file).toEqual({
      id: "media-1",
      hash: "hash-1",
      mime_type: "image/png",
      data: bytes,
      data_type: "blob",
      created_at: expect.any(String),
    });
  });
});
