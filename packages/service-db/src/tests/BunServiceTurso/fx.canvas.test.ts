import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { connect, Database } from "@tursodatabase/database";
import path from "node:path";
import { txRunMigrations } from "../../../src/DbServiceTurso/tx.migrations";
import {
  fxCanvasCanEdit,
  fxCanvasFindById,
  fxCanvasFindByName,
  fxCanvasHasOwnerRole,
  fxCanvasListAll,
  fxCanvasListMembers,
} from "../../../src/DbServiceTurso/fx.canvas";

async function inMemoryDb() {
  // @ts-expect-error custom_types not typed yet
  return connect(":memory:", { experimental: ["custom_types"] });
}

async function seedCanvasRows(db: Database) {
  await db.exec("PRAGMA foreign_keys = ON");
  await txRunMigrations({ db, Bun, path }, {});

  const insertAccount = await db.prepare("insert into accounts (id, display_name) values (?, ?)");
  await insertAccount.run("account-owner", "Owner Account");
  await insertAccount.run("account-editor", "Editor Account");
  await insertAccount.run("account-viewer", "Viewer Account");
  await insertAccount.run("account-outsider", "Outsider Account");

  const insertCanvas = await db.prepare("insert into canvas (id, name, automerge_url) values (?, ?, ?)");
  await insertCanvas.run("canvas-alpha", "Alpha", "automerge:alpha");
  await insertCanvas.run("canvas-beta", "Beta", "automerge:beta");
  await insertCanvas.run("canvas-private", "Private", "automerge:private");

  const insertMember = await db.prepare("insert into canvas_members (canvas_id, account_id, role) values (?, ?, ?)");
  await insertMember.run("canvas-alpha", "account-owner", "owner");
  await insertMember.run("canvas-alpha", "account-editor", "editor");
  await insertMember.run("canvas-alpha", "account-viewer", "viewer");
  await insertMember.run("canvas-beta", "account-editor", "owner");
}

describe("fx.canvas", () => {
  let db!: Database;

  beforeEach(async () => {
    db = await inMemoryDb();
    await seedCanvasRows(db);
  });

  afterEach(async () => {
    await db.close();
  });

  test("lists all canvases when no account scope is provided", async () => {
    const canvases = await fxCanvasListAll({ db }, {});

    expect(canvases.map((canvas) => canvas.id).sort()).toEqual([
      "canvas-alpha",
      "canvas-beta",
      "canvas-private",
    ]);
  });

  test("lists only canvases visible to the account scope", async () => {
    const editorCanvases = await fxCanvasListAll({ db }, { accountId: "account-editor" });
    const viewerCanvases = await fxCanvasListAll({ db }, { accountId: "account-viewer" });
    const outsiderCanvases = await fxCanvasListAll({ db }, { accountId: "account-outsider" });

    expect(editorCanvases.map((canvas) => canvas.id).sort()).toEqual(["canvas-alpha", "canvas-beta"]);
    expect(viewerCanvases.map((canvas) => canvas.id)).toEqual(["canvas-alpha"]);
    expect(outsiderCanvases).toEqual([]);
  });

  test("finds canvas by name with and without account scope", async () => {
    expect(await fxCanvasFindByName({ db }, { name: "Private" })).toMatchObject({
      id: "canvas-private",
      name: "Private",
      automerge_url: "automerge:private",
    });
    expect(await fxCanvasFindByName({ db }, { name: "Beta", accountId: "account-owner" })).toBeNull();
    expect(await fxCanvasFindByName({ db }, { name: "Beta", accountId: "account-editor" })).toMatchObject({
      id: "canvas-beta",
      name: "Beta",
      automerge_url: "automerge:beta",
    });
  });

  test("finds canvas by id with and without account scope", async () => {
    expect(await fxCanvasFindById({ db }, { id: "canvas-private" })).toMatchObject({
      id: "canvas-private",
      name: "Private",
      automerge_url: "automerge:private",
    });
    expect(await fxCanvasFindById({ db }, { id: "canvas-beta", accountId: "account-owner" })).toBeNull();
    expect(await fxCanvasFindById({ db }, { id: "canvas-beta", accountId: "account-editor" })).toMatchObject({
      id: "canvas-beta",
      name: "Beta",
      automerge_url: "automerge:beta",
    });
  });

  test("checks edit and owner permissions from member roles", async () => {
    expect(await fxCanvasCanEdit({ db }, { canvasId: "canvas-alpha", accountId: "account-owner" })).toBe(true);
    expect(await fxCanvasCanEdit({ db }, { canvasId: "canvas-alpha", accountId: "account-editor" })).toBe(true);
    expect(await fxCanvasCanEdit({ db }, { canvasId: "canvas-alpha", accountId: "account-viewer" })).toBe(false);
    expect(await fxCanvasCanEdit({ db }, { canvasId: "canvas-alpha", accountId: "account-outsider" })).toBe(false);

    expect(await fxCanvasHasOwnerRole({ db }, { canvasId: "canvas-alpha", accountId: "account-owner" })).toBe(true);
    expect(await fxCanvasHasOwnerRole({ db }, { canvasId: "canvas-alpha", accountId: "account-editor" })).toBe(false);
  });

  test("lists canvas members", async () => {
    const members = await fxCanvasListMembers({ db }, { canvasId: "canvas-alpha" });

    expect(members.map((member) => ({ account_id: member.account_id, role: member.role })).sort((a, b) => a.account_id.localeCompare(b.account_id))).toEqual([
      { account_id: "account-editor", role: "editor" },
      { account_id: "account-owner", role: "owner" },
      { account_id: "account-viewer", role: "viewer" },
    ]);
  });
});
