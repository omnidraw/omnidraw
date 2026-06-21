import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { connect, Database } from "@tursodatabase/database";
import path from "node:path";
import { txRunMigrations } from "../../../src/DbServiceTurso/tx.migrations";
import { fxActorListInstances } from "../../../src/DbServiceTurso/fx.actor";

async function inMemoryDb() {
  // @ts-expect-error custom_types not typed yet
  return connect(":memory:", { experimental: ["custom_types", "triggers", "index_method"] });
}

async function seedActorRows(db: Database) {
  await db.exec("PRAGMA foreign_keys = ON");
  await txRunMigrations({ db, Bun, path }, {});

  const insertCanvas = await db.prepare("insert into canvas (id, name, automerge_url) values (?, ?, ?)");
  await insertCanvas.run("canvas-actor", "Actor Canvas", "automerge:actor");

  const insertDefinition = await db.prepare("insert into actor_definitions (name, slug, manifest_path) values (?, ?, ?)");
  await insertDefinition.run("Counter", "counter", "/actors/counter/vibecanvas.json");

  const insertInstance = await db.prepare("insert into actor_instances (id, canvas_id, element_id, actor_definition_name, display_name, status, machine_state, machine_context) values (?, ?, ?, ?, ?, ?, ?, ?)");
  await insertInstance.run(
    "actor-object-context",
    "canvas-actor",
    "element-object-context",
    "Counter",
    "Counter Object Context",
    "running",
    "ready",
    JSON.stringify({ count: 7, nested: { ok: true } }),
  );
  await insertInstance.run(
    "actor-string-context",
    "canvas-actor",
    "element-string-context",
    "Counter",
    "Counter String Context",
    "running",
    "ready",
    JSON.stringify("valid-json-string"),
  );
}

describe("fx.actor", () => {
  let db!: Database;

  beforeEach(async () => {
    db = await inMemoryDb();
    await seedActorRows(db);
  });

  afterEach(async () => {
    await db.close();
  });

  test("lists actor instances with machine_context decoded from JSON column", async () => {
    const instances = await fxActorListInstances({ db }, {});

    const objectContext = instances.find(instance => instance.id === "actor-object-context");
    const stringContext = instances.find(instance => instance.id === "actor-string-context");

    expect(objectContext?.machine_context).toEqual({ count: 7, nested: { ok: true } });
    expect(typeof objectContext?.machine_context).toBe("object");
    expect(stringContext?.machine_context).toBe("valid-json-string");
    expect(typeof stringContext?.machine_context).toBe("string");
  });
});
