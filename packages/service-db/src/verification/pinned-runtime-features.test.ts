import { afterEach, describe, expect, test } from "bun:test";
import { connect, type Database } from "@tursodatabase/database";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoots: string[] = [];
const databases: Database[] = [];

async function openTemporaryDatabase() {
  const root = await mkdtemp(path.join(tmpdir(), "vibecanvas-turso-feature-probe-"));
  const db = await connect(path.join(root, "probe.db"));
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
      CREATE TABLE probe_parents (
        org_id TEXT NOT NULL,
        id TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
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
    `);

    const insertParent = await db.prepare(
      "INSERT INTO probe_parents (org_id, id, payload_json) VALUES (?, ?, ?)",
    );
    const insertChild = await db.prepare(
      "INSERT INTO probe_children (org_id, id, parent_id, state) VALUES (?, ?, ?, ?)",
    );
    await insertParent.run("org-a", "parent-a", "{}");
    await insertChild.run("org-a", "child-a", "parent-a", "active");

    await expect(insertChild.run("org-a", "child-b", "parent-a", "active")).rejects.toThrow();
    await expect(insertChild.run("org-b", "child-c", "parent-a", "closed")).rejects.toThrow();
    await expect(insertParent.run("org-a", "parent-json", "[]")).rejects.toThrow();

    const transaction = db.transaction(async () => {
      await insertParent.run("org-a", "rolled-back", '{"ok":true}');
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
