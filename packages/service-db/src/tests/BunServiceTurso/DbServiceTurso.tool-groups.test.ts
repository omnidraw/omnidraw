import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso";

describe("DbServiceTurso tool groups", () => {
  let tempRoot: string;
  let db: DbServiceTurso;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "vibecanvas-db-tool-groups-"));
    db = new DbServiceTurso({
      databasePath: join(tempRoot, "vibecanvas.turso"),
      dataDir: tempRoot,
      cacheDir: tempRoot,
    });
    await db.start();
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
