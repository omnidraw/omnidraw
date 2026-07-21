import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { connect, type Database } from "@tursodatabase/database";
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from "../../../src/CONSTANTS";
import { fxActorListInstances } from "../../../src/DbServiceTurso/fx.actor";
import { txRunMigrations } from "../../../src/DbServiceTurso/tx.migrations";
import { EXPECTED_APPLICATION_TABLES } from "../../../src/schema/expected-schema";
import { TEST_TENANT } from "../tenant.fixture";

const CANVAS_ID = "00000000-0000-4000-8000-000000000101";
const OBJECT_ACTOR_ID = "00000000-0000-4000-8000-000000000102";

async function inMemoryDb(): Promise<Database> {
  // @ts-expect-error custom_types not typed yet
  return connect(":memory:", { experimental: ["custom_types", "triggers", "index_method"] });
}

async function seedActorRows(db: Database): Promise<void> {
  await txRunMigrations({ db, Bun }, {
    applicationVersion: "test",
    appliedAtMs: 1,
    expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
  });
  await (await db.prepare(`
    INSERT INTO canvases (
      org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'Actor Canvas', 'restricted', ?, 1, 1)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, CANVAS_ID, DEFAULT_OSS_ACCOUNT_ID);
  await (await db.prepare(`
    INSERT INTO legacy_actor_definitions (
      org_id, name, slug, url, description, manifest_relative_path, created_at_ms, updated_at_ms
    ) VALUES (?, 'Counter', 'counter', NULL, NULL, 'actors/counter/vibecanvas.json', 1, 1)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID);
  const insertInstance = await db.prepare(`
    INSERT INTO legacy_actor_instances (
      org_id, id, canvas_id, element_id, actor_definition_name, file_system_id,
      display_name, status, machine_state, machine_context_json, last_error_json,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'Counter', NULL, ?, 'running', 'ready', ?, NULL, 1, 1)
  `);
  await insertInstance.run(
    DEFAULT_OSS_ORGANIZATION_ID,
    OBJECT_ACTOR_ID,
    CANVAS_ID,
    "element-object-context",
    "Counter Object Context",
    JSON.stringify({ count: 7, nested: { ok: true } }),
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

  test("lists actor instances with machine_context decoded from the checked object JSON column", async () => {
    const instances = await fxActorListInstances({ db }, { tenant: TEST_TENANT });
    const objectContext = instances.find((instance) => instance.id === OBJECT_ACTOR_ID);

    expect(objectContext?.machine_context).toEqual({ count: 7, nested: { ok: true } });
    expect(typeof objectContext?.machine_context).toBe("object");
  });
});
