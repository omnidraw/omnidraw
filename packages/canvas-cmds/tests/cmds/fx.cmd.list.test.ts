import { DbServiceBunSqlite } from "@vibecanvas/service-db/DbServiceBunSqlite/index";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { fxExecuteCanvasList } from "packages/canvas-cmds/src/cmds/fx.cmd.list";

describe('list canvas command', () => {
  let dbService!: DbServiceBunSqlite

  beforeEach(async () => {
    dbService = new DbServiceBunSqlite({
      cacheDir: tmpdir(),
      databasePath: ":memory:",
      dataDir: tmpdir(),
      silentMigrations: true
    })
    await dbService.start();
  })

  afterEach(async () => {
    await dbService.stop();
  });

  test("should be empty", async () => {
    const result = await fxExecuteCanvasList({ dbService })
    expect(result).toEqual({ ok: true, command: 'canvas', subcommand: 'list', count: 0, canvases: [] })
  })

  test("should find 2 canvases", async () => {
    // setup data
    dbService.canvas.create({ id: '1', automerge_url: '', name: 'test' })
    dbService.canvas.create({ id: '2', automerge_url: '', name: 'test2' })

    const result = await fxExecuteCanvasList({ dbService })
    expect(result).toMatchObject({
      ok: true,
      command: 'canvas',
      subcommand: 'list',
      count: 2,
      canvases: [
        { id: '1', automergeUrl: '', name: 'test' },
        { id: '2', automergeUrl: '', name: 'test2' }
      ]
    })
  });
})