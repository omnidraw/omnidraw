import { afterEach, describe, expect, test } from "bun:test";
import { connect, type Database } from "@tursodatabase/database";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoots: string[] = [];
const databases: Database[] = [];

async function openTemporaryDatabase() {
  const root = await mkdtemp(path.join(tmpdir(), "vibecanvas-turso-feature-probe-"));
  const db = await connect(path.join(root, "probe.db"), {
    experimental: ["custom_types", "generated_columns"] as never,
  });
  temporaryRoots.push(root);
  databases.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("pinned @tursodatabase/database feature probe", () => {
  test("supports every SQL feature used by the managed-service baseline", async () => {
    const db = await openTemporaryDatabase();

    await db.exec("PRAGMA foreign_keys = ON");
    await db.exec("PRAGMA ignore_check_constraints = 0");
    await db.exec("PRAGMA synchronous = FULL");
    await db.exec("PRAGMA busy_timeout = 5000");
    await db.exec(`
      CREATE DOMAIN probe_order_status AS text CHECK (
        value IN ('queued', 'processing', 'completed', 'failed', 'cancelled')
      );

      CREATE TABLE probe_parents (
        org_id TEXT NOT NULL,
        id TEXT NOT NULL,
        payload_json JSON NOT NULL CHECK (json_type(payload_json) = 'object'),
        status probe_order_status NOT NULL,
        enabled boolean NOT NULL,
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        PRIMARY KEY (org_id, id),
        UNIQUE (org_id, payload_json)
      ) STRICT;

      CREATE TABLE probe_children (
        org_id TEXT NOT NULL,
        id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'closed')),
        PRIMARY KEY (org_id, id),
        FOREIGN KEY (org_id, parent_id)
          REFERENCES probe_parents (org_id, id)
          ON DELETE CASCADE
      ) STRICT;

      CREATE UNIQUE INDEX probe_one_active_child
        ON probe_children (org_id, parent_id)
        WHERE state = 'active';

      CREATE TABLE probe_jsonb_items (
        id TEXT PRIMARY KEY NOT NULL,
        item_json JSONB NOT NULL,
        kind TEXT GENERATED ALWAYS AS (
          json_extract(item_json, '$.kind')
        ) VIRTUAL NOT NULL
      ) STRICT;

      CREATE INDEX probe_jsonb_kind
        ON probe_jsonb_items (kind, id);
    `);

    const insertParent = await db.prepare(
      `INSERT INTO probe_parents
        (org_id, id, payload_json, status, enabled, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertChild = await db.prepare(
      "INSERT INTO probe_children (org_id, id, parent_id, state) VALUES (?, ?, ?, ?)",
    );
    await insertParent.run("org-a", "parent-a", "{}", "queued", 1, 1_753_113_600_123);
    await insertChild.run("org-a", "child-a", "parent-a", "active");
    await (await db.prepare(`
      INSERT INTO probe_jsonb_items (id, item_json)
      VALUES (?, ?)
    `)).run("item-a", '{"kind":"rect"}');

    await expect(insertChild.run("org-a", "child-b", "parent-a", "active")).rejects.toThrow();
    await expect(insertChild.run("org-b", "child-c", "parent-a", "closed")).rejects.toThrow();
    await expect(insertParent.run("org-a", "parent-json", "[]", "queued", 1, 1)).rejects.toThrow();
    await expect(insertParent.run("org-a", "parent-status", '{"case":"status"}', "unknown", 1, 1)).rejects.toThrow();
    await expect(insertParent.run("org-a", "parent-bool", '{"case":"bool"}', "queued", 2, 1)).rejects.toThrow();
    await expect(insertParent.run("org-a", "parent-time", '{"case":"time"}', "queued", 1, -1)).rejects.toThrow();
    await expect((await db.prepare(`
      INSERT INTO probe_jsonb_items (id, item_json)
      VALUES (?, jsonb(?))
    `)).run("item-pre-encoded", '{"kind":"rect"}')).rejects.toThrow();

    const transaction = db.transaction(async () => {
      await insertParent.run("org-a", "rolled-back", '{"ok":true}', "processing", 1, 2);
      throw new Error("intentional rollback");
    });
    await expect(transaction()).rejects.toThrow("intentional rollback");
    expect(
      await (await db.prepare("SELECT count(*) AS count FROM probe_parents WHERE id = 'rolled-back'")).get(),
    ).toEqual({ count: 0 });

    expect(await (await db.prepare("PRAGMA foreign_keys")).get()).toEqual({ foreign_keys: 1 });
    expect(await (await db.prepare("PRAGMA ignore_check_constraints")).get()).toEqual({
      ignore_check_constraints: 0,
    });
    expect(await (await db.prepare("PRAGMA synchronous")).get()).toEqual({ synchronous: 2 });
    expect(await (await db.prepare("PRAGMA busy_timeout")).get()).toEqual({ busy_timeout: 5000 });

    const tables = await (await db.prepare("PRAGMA table_list")).all();
    expect(tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "probe_parents", strict: 1 }),
        expect.objectContaining({ name: "probe_children", strict: 1 }),
      ]),
    );
    expect(await (await db.prepare("PRAGMA table_info(probe_children)")).all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "org_id", notnull: 1, type: "TEXT" })]),
    );
    expect(await (await db.prepare("PRAGMA table_xinfo(probe_jsonb_items)")).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "item_json", hidden: 0, notnull: 1, type: "JSONB" }),
        expect.objectContaining({ name: "kind", hidden: 2, notnull: 1, type: "TEXT" }),
      ]),
    );
    expect(await (await db.prepare(`
      SELECT id, kind, item_json, typeof(item_json) AS decoded_type
      FROM probe_jsonb_items
      WHERE kind = 'rect'
    `)).get()).toEqual({
      id: "item-a",
      kind: "rect",
      item_json: '{"kind":"rect"}',
      decoded_type: "text",
    });
    expect(await (await db.prepare("PRAGMA foreign_key_list(probe_children)")).all()).toHaveLength(2);
    expect(await (await db.prepare("PRAGMA index_list(probe_children)")).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "probe_one_active_child", partial: 1, unique: 1 }),
      ]),
    );
    expect(await (await db.prepare("PRAGMA index_info(probe_one_active_child)")).all()).toEqual([
      expect.objectContaining({ name: "org_id" }),
      expect.objectContaining({ name: "parent_id" }),
    ]);
  });
});
