import { afterEach, describe, expect, test } from "bun:test";
import { connect, type Database } from "@tursodatabase/database";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EXPECTED_AGENT_AUTHORING_APPLICATION_TABLE_COUNT as EXPECTED_APPLICATION_TABLE_COUNT,
  EXPECTED_AGENT_AUTHORING_APPLICATION_TABLES as EXPECTED_APPLICATION_TABLES,
  EXPECTED_AGENT_AUTHORING_INDEXES as EXPECTED_INDEXES,
  EXPECTED_AGENT_AUTHORING_SCHEMA as EXPECTED_CURRENT_SCHEMA,
  EXPECTED_AGENT_AUTHORING_SCHEMA as EXPECTED_SCHEMA,
  type TExpectedForeignKey,
  type TExpectedTable,
} from "../schema/expected-schema";
import { fnDatabaseColumnBaseType } from "../DbServiceTurso/fn.database-column-type";

const temporaryRoots: string[] = [];
const databases: Database[] = [];

async function openBaseline() {
  const root = await mkdtemp(path.join(tmpdir(), "vibecanvas-baseline-schema-"));
  const db = await connect(path.join(root, "main.db"), {
    experimental: ["custom_types"] as never,
  });
  temporaryRoots.push(root);
  databases.push(db);
  await db.exec("PRAGMA foreign_keys = ON");
  await db.exec("PRAGMA ignore_check_constraints = 0");
  const sql = await Bun.file(new URL("../migrations/000-initial.sql", import.meta.url)).text();
  const apply = db.transaction(async () => db.exec(sql));
  await apply();
  return db;
}

async function openCurrentSchema() {
  const db = await openBaseline();
  const sql = await Bun.file(
    new URL("../migrations/001-widget-revision-sequence.sql", import.meta.url),
  ).text();
  const apply = db.transaction(async () => db.exec(sql));
  await apply();
  return db;
}

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const columnSet = (columns: readonly string[]) => columns.join("\u0000");

function canonicalForeignKey(foreignKey: TExpectedForeignKey) {
  return JSON.stringify({
    columns: foreignKey.columns,
    referencesTable: foreignKey.referencesTable,
    referencesColumns: foreignKey.referencesColumns,
    onDelete: foreignKey.onDelete,
  });
}

async function actualForeignKeys(db: Database, table: string) {
  const rows = (await (await db.prepare(`PRAGMA foreign_key_list(${identifier(table)})`)).all()) as Array<{
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
  const groups = new Map<number, typeof rows>();
  for (const row of rows) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
  return [...groups.values()].map((group) => {
    const ordered = group.toSorted((left, right) => left.seq - right.seq);
    return canonicalForeignKey({
      columns: ordered.map((row) => row.from),
      referencesTable: ordered[0]!.table,
      referencesColumns: ordered.map((row) => row.to),
      onDelete: ordered[0]!.on_delete as TExpectedForeignKey["onDelete"],
    });
  }).toSorted();
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("000-initial.sql", () => {
  test("does not constrain identifiers to UUID syntax", async () => {
    const migrationNames = [
      "000-initial.sql",
      "001-widget-revision-sequence.sql",
      "002-function-runtime.sql",
      "003-widget-instance-projection.sql",
      "004-agent-authoring.sql",
    ];
    for (const migrationName of migrationNames) {
      const sql = await Bun.file(new URL(`../migrations/${migrationName}`, import.meta.url)).text();
      expect(sql).not.toMatch(/length\([^)]+\) = 36/);
      expect(sql).not.toMatch(/substr\([^)]+, (?:9|14|19|24), 1\) = '-'/);
    }
  });

  test("applies atomically with foreign-key enforcement on the pinned runtime", async () => {
    const db = await openBaseline();
    expect(await (await db.prepare("PRAGMA foreign_keys")).get()).toEqual({ foreign_keys: 1 });
    expect(await (await db.prepare("PRAGMA integrity_check")).get()).toEqual({ integrity_check: "ok" });
    expect(await (await db.prepare("PRAGMA quick_check")).get()).toEqual({ quick_check: "ok" });
  });

  test("matches the complete checked-in table, column, key, FK, and index manifest", async () => {
    const db = await openBaseline();
    expect(Object.keys(EXPECTED_SCHEMA).toSorted()).toEqual([...EXPECTED_APPLICATION_TABLES].toSorted());
    expect(EXPECTED_APPLICATION_TABLE_COUNT).toBe(34);

    const tableList = (await (await db.prepare("PRAGMA table_list")).all()) as Array<{
      name: string;
      schema: string;
      strict: number;
      type: string;
      wr: number;
    }>;
    const applicationTables = tableList
      .filter((row) => (
        row.schema === "main"
        && row.type === "table"
        && !row.name.startsWith("sqlite_")
        && !row.name.startsWith("__turso_internal_")
      ))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    expect(applicationTables.map((row) => row.name)).toEqual([...EXPECTED_APPLICATION_TABLES].toSorted());
    expect(applicationTables).toHaveLength(EXPECTED_APPLICATION_TABLE_COUNT);
    expect(applicationTables.every((row) => row.strict === 1 && row.wr === 0)).toBe(true);

    for (const table of EXPECTED_APPLICATION_TABLES) {
      const expected: TExpectedTable = EXPECTED_SCHEMA[table];
      const columns = (await (await db.prepare(`PRAGMA table_info(${identifier(table)})`)).all()) as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      expect(columns.map((value) => ({
        name: value.name,
        type: fnDatabaseColumnBaseType(value.type),
        notNull: value.notnull === 1,
        primaryKey: value.pk > 0,
      }))).toEqual(expected.columns.map((value) => ({
        name: value.name,
        type: value.type,
        notNull: value.notNull,
        primaryKey: value.primaryKeyPosition > 0,
      })));
      expect(columns.every((value) => value.type !== "ANY")).toBe(true);

      const indexList = (await (await db.prepare(`PRAGMA index_list(${identifier(table)})`)).all()) as Array<{
        name: string;
        origin: string;
        partial: number;
        unique: number;
      }>;
      const primaryKeyIndex = indexList.find((value) => value.origin === "pk");
      const actualPrimaryKey = primaryKeyIndex
        ? ((await (await db.prepare(`PRAGMA index_info(${identifier(primaryKeyIndex.name)})`)).all()) as Array<{
            name: string;
            seqno: number;
          }>).toSorted((left, right) => left.seqno - right.seqno).map((value) => value.name)
        : columns.filter((value) => value.pk > 0).map((value) => value.name);
      expect(actualPrimaryKey).toEqual([...expected.primaryKey]);
      const actualUnique: string[] = [];
      for (const index of indexList.filter((value) => value.origin === "u")) {
        const indexColumns = (await (await db.prepare(`PRAGMA index_info(${identifier(index.name)})`)).all()) as Array<{
          name: string;
          seqno: number;
        }>;
        actualUnique.push(columnSet(indexColumns.toSorted((left, right) => left.seqno - right.seqno).map((value) => value.name)));
      }
      expect(actualUnique.toSorted()).toEqual(expected.unique.map(columnSet).toSorted());
      expect(await actualForeignKeys(db, table)).toEqual(expected.foreignKeys.map(canonicalForeignKey).toSorted());
      if (expected.requiredSqlFragments !== undefined) {
        const schema = await (await db.prepare(`
          SELECT sql
          FROM sqlite_schema
          WHERE type = 'table' AND name = ?
        `)).get(table) as { sql: string } | undefined;
        const normalizedSql = schema?.sql.replace(/\s+/g, "") ?? "";
        for (const fragment of expected.requiredSqlFragments) {
          expect(normalizedSql).toContain(fragment.replace(/\s+/g, ""));
        }
      }
    }

    const explicitIndexes = (await (await db.prepare(`
      SELECT name, tbl_name AS table_name
      FROM sqlite_schema
      WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
      ORDER BY name
    `)).all()) as Array<{ name: string; table_name: string }>;
    expect(explicitIndexes.map((index) => index.name)).toEqual(Object.keys(EXPECTED_INDEXES).toSorted());
    for (const [name, expected] of Object.entries(EXPECTED_INDEXES)) {
      const indexList = (await (await db.prepare(`PRAGMA index_list(${identifier(expected.table)})`)).all()) as Array<{
        name: string;
        partial: number;
        unique: number;
      }>;
      expect(indexList.find((index) => index.name === name)).toMatchObject({
        partial: expected.partial ? 1 : 0,
        unique: expected.unique ? 1 : 0,
      });
      const columns = (await (await db.prepare(`PRAGMA index_info(${identifier(name)})`)).all()) as Array<{
        name: string;
        seqno: number;
      }>;
      expect(columns.toSorted((left, right) => left.seqno - right.seqno).map((value) => value.name))
        .toEqual(expected.columns);
    }
  });

  test("unreleased ledger placeholders leave the consolidated baseline unchanged", async () => {
    const db = await openCurrentSchema();
    const expected = EXPECTED_CURRENT_SCHEMA.widget_definitions;
    const columns = (await (await db.prepare("PRAGMA table_info(widget_definitions)")).all()) as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(columns.map((value) => ({
      name: value.name,
      type: fnDatabaseColumnBaseType(value.type),
      notNull: value.notnull === 1,
      primaryKey: value.pk > 0,
    }))).toEqual(expected.columns.map((value) => ({
      name: value.name,
      type: value.type,
      notNull: value.notNull,
      primaryKey: value.primaryKeyPosition > 0,
    })));

    const schema = await (await db.prepare(`
      SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'widget_definitions'
    `)).get() as { sql: string } | undefined;
    const normalizedSql = schema?.sql.replace(/\s+/g, "") ?? "";
    for (const fragment of expected.requiredSqlFragments ?? []) {
      expect(normalizedSql).toContain(fragment.replace(/\s+/g, ""));
    }
  });

  test("contains only the deterministic OSS identity seed and leaves the ledger runner-owned", async () => {
    const db = await openBaseline();
    expect(await (await db.prepare("SELECT * FROM organizations")).all()).toEqual([{
      id: "00000000-0000-4000-8000-000000000001",
      slug: "local",
      name: "Local",
      status: "active",
      created_at_ms: 0,
      updated_at_ms: 0,
    }]);
    expect(await (await db.prepare("SELECT * FROM accounts")).all()).toEqual([{
      id: "00000000-0000-4000-8000-000000000002",
      kind: "user",
      display_name: "Local Owner",
      status: "active",
      is_autogenerated: 1,
      created_at_ms: 0,
      updated_at_ms: 0,
    }]);
    expect(await (await db.prepare("SELECT * FROM organization_memberships")).all()).toEqual([{
      org_id: "00000000-0000-4000-8000-000000000001",
      account_id: "00000000-0000-4000-8000-000000000002",
      role: "owner",
      status: "active",
      is_billable_seat: 1,
      created_at_ms: 0,
      updated_at_ms: 0,
    }]);
    expect(await (await db.prepare("SELECT * FROM schema_migrations")).all()).toEqual([]);
  });

  test("gives every customer table a non-null tenant FK and every child FK a supporting index", async () => {
    const db = await openBaseline();
    const globalTables = new Set(["accounts", "organizations", "schema_migrations"]);

    for (const table of EXPECTED_APPLICATION_TABLES) {
      const columns = (await (await db.prepare(`PRAGMA table_info(${identifier(table)})`)).all()) as Array<{
        name: string;
        notnull: number;
      }>;
      const foreignKeyRows = (await (await db.prepare(`PRAGMA foreign_key_list(${identifier(table)})`)).all()) as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
      }>;
      if (!globalTables.has(table)) {
        expect(columns.find((value) => value.name === "org_id")).toMatchObject({ notnull: 1 });
        expect(foreignKeyRows.some((value) => value.from === "org_id" && value.table === "organizations"))
          .toBe(true);
      }

      const indexList = (await (await db.prepare(`PRAGMA index_list(${identifier(table)})`)).all()) as Array<{
        name: string;
      }>;
      const indexColumns: string[][] = [];
      for (const index of indexList) {
        const rows = (await (await db.prepare(`PRAGMA index_info(${identifier(index.name)})`)).all()) as Array<{
          name: string;
          seqno: number;
        }>;
        indexColumns.push(rows.toSorted((left, right) => left.seqno - right.seqno).map((value) => value.name));
      }
      const groups = new Map<number, typeof foreignKeyRows>();
      for (const row of foreignKeyRows) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
      for (const group of groups.values()) {
        const childColumns = group.toSorted((left, right) => left.seq - right.seq).map((value) => value.from);
        expect(indexColumns.some((candidate) =>
          childColumns.every((value, position) => candidate[position] === value)
        )).toBe(true);
      }
    }
  });

  test("uses built-in scalar types and only semantic reusable domains", async () => {
    const sql = await Bun.file(new URL("../migrations/000-initial.sql", import.meta.url)).text();
    expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(sql).not.toMatch(/\bANY\b/i);
    expect(sql).toMatch(/\bCREATE\s+DOMAIN\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TYPE\b/i);
    expect(sql).not.toMatch(/\bWITHOUT\s+ROWID\b/i);
    expect(sql).toMatch(/\bboolean\b/i);
    expect(sql).toMatch(/\bJSON\b/);
    expect(sql).not.toMatch(/\b(entity_id|json_document|json_object_value|json_array_value)\b/);
    expect(sql).not.toMatch(/\b(nonnegative_integer|positive_integer|trimmed_text_\d+|timestamp_ms)\b/);
    expect(sql).toMatch(/\bfunction_invocation_status\b/);
    expect(sql).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK)\b/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+schema_migrations/i);
  });
});
