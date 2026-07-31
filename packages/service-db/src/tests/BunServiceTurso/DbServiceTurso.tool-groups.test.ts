import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso";
import { bindTestTenant, type TTenantTestDb } from "../tenant.fixture";

describe("DbServiceTurso tool groups", () => {
  let tempRoot: string;
  let db: TTenantTestDb;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "omnidraw-db-tool-groups-"));
    const service = new DbServiceTurso({
      databasePath: join(tempRoot, "omnidraw.turso"),
      dataDir: tempRoot,
      cacheDir: tempRoot,
    });
    await service.start();
    db = bindTestTenant(service);
  });

  afterEach(async () => {
    await db.db.close();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("creates, reads, lists, updates, and removes independent groups", async () => {
    await expect(db.toolGroup.create({
      name: "Productivity",
      json: { lucidIcon: "LayoutGrid" },
    })).resolves.toEqual({
      name: "Productivity",
      json: { lucidIcon: "LayoutGrid" },
    });
    await db.toolGroup.create({ name: "Unstyled", json: null });

    await expect(db.toolGroup.getByName({ name: "Productivity" })).resolves.toEqual({
      name: "Productivity",
      json: { lucidIcon: "LayoutGrid" },
    });
    await expect(db.toolGroup.listAll()).resolves.toEqual([
      { name: "Productivity", json: { lucidIcon: "LayoutGrid" } },
      { name: "Unstyled", json: null },
    ]);

    await expect(db.toolGroup.update({
      currentName: "Productivity",
      name: "Work",
      json: { svgIcon: "<svg></svg>" },
    })).resolves.toEqual({
      name: "Work",
      json: { svgIcon: "<svg></svg>" },
    });
    await expect(db.toolGroup.update({ currentName: "Missing", name: "Missing", json: null })).resolves.toBeNull();

    await expect(db.toolGroup.remove({ name: "Work" })).resolves.toEqual({
      name: "Work",
      json: { svgIcon: "<svg></svg>" },
    });
    await expect(db.toolGroup.remove({ name: "Work" })).resolves.toBeNull();
  });
});
