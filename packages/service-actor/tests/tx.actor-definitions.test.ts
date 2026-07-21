import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import { txSyncDbActorDefinitions } from "../src/core/tx.actor-definitions";
import { bindTestTenantDb, type TActorTestDb } from "./tenant.fixture";

type TSyncDefinition = Parameters<typeof txSyncDbActorDefinitions>[1]["defs"][number];

function definition(manifestPath: string): TSyncDefinition {
  return {
    name: "Todo Actor System",
    slug: "todo-actor-system",
    manifest_path: manifestPath,
  } as unknown as TSyncDefinition;
}

describe("txSyncDbActorDefinitions", () => {
  let tempRoot: string;
  let dbService: DbServiceTurso;
  let db: TActorTestDb;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "vibecanvas-actor-definition-sync-"));
    dbService = new DbServiceTurso({
      databasePath: join(tempRoot, "vibecanvas.turso"),
      dataDir: tempRoot,
      cacheDir: tempRoot,
    });
    await dbService.start();
    db = bindTestTenantDb(dbService);
    await db.actor.insertDefinition({
      name: "Todo Actor System",
      slug: "todo-actor-system",
      url: null,
      description: null,
      manifest_path: "widgets/sdk-test/vibecanvas.json",
    });
  });

  afterEach(async () => {
    await db.db.close();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("updates an existing definition when its manifest moves", async () => {
    const errors = await txSyncDbActorDefinitions({
      db,
      crypto,
      configPath: tempRoot,
      isAbsolute,
      relative,
    }, {
      defs: [definition("widgets/todo-actor-system/vibecanvas.json")],
    });

    expect(errors).toEqual([]);
    await expect(db.actor.listDefinitions()).resolves.toEqual([
      expect.objectContaining({
        name: "Todo Actor System",
        slug: "todo-actor-system",
        manifest_path: "widgets/todo-actor-system/vibecanvas.json",
      }),
    ]);
  });
});
