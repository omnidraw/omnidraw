import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect, type Database as TursoDatabase } from '@tursodatabase/database';
import { AutomergeService } from '../src/AutomergeServer';
import { DbServiceBunSqlite } from '../../service-db/src/DbServiceBunSqlite/index';
import type { TCanvasDoc, TElement } from '../src/types/canvas-doc.types';

async function waitFor(args: { predicate: () => boolean | Promise<boolean>; message: string; timeoutMs?: number }): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = args.timeoutMs ?? 2000;

  while (Date.now() - startedAt < timeoutMs) {
    if (await args.predicate()) return;
    await Bun.sleep(25);
  }

  throw new Error(args.message);
}

async function waitForPersistedDoc(args: { dbService: DbServiceBunSqlite; automergeUrl: string; timeoutMs?: number }): Promise<void> {
  const prefix = `${args.automergeUrl.replace('automerge:', '')}*`;
  await waitFor({
    timeoutMs: args.timeoutMs,
    message: `Timed out waiting for persisted Automerge data for ${args.automergeUrl}`,
    predicate: () => {
      const row = args.dbService.sqlite.prepare('select count(*) as n from automerge_repo_data where key glob ?').get(prefix) as { n: number };
      return row.n > 0;
    },
  });
}

async function waitForPersistedTursoDoc(args: { database: TursoDatabase; automergeUrl: string; timeoutMs?: number }): Promise<void> {
  const prefix = `${args.automergeUrl.replace('automerge:', '')}*`;
  await waitFor({
    timeoutMs: args.timeoutMs,
    message: `Timed out waiting for persisted Turso Automerge data for ${args.automergeUrl}`,
    predicate: async () => {
      const row = await args.database.get('select count(*) as n from automerge_repo_data where key glob ?', prefix) as { n: number };
      return row.n > 0;
    },
  });
}

function createTestElement(id: string): TElement {
  return {
    id,
    x: 0,
    y: 0,
    rotation: 0,
    zIndex: 'a0',
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: 'rect',
      w: 10,
      h: 10,
    },
    style: {},
  };
}

const previousSilentAutomergeLogs = process.env.VIBECANVAS_SILENT_AUTOMERGE_LOGS;

beforeAll(() => {
  process.env.VIBECANVAS_SILENT_AUTOMERGE_LOGS = '1';
});

afterAll(() => {
  if (previousSilentAutomergeLogs === undefined) {
    delete process.env.VIBECANVAS_SILENT_AUTOMERGE_LOGS;
    return;
  }
  process.env.VIBECANVAS_SILENT_AUTOMERGE_LOGS = previousSilentAutomergeLogs;
});

describe('AutomergeService', () => {
  let databasePath!: string;
  let dbService!: DbServiceBunSqlite;
  const services: AutomergeService[] = [];
  const tursoDatabases: TursoDatabase[] = [];

  beforeEach(async () => {
    databasePath = join(tmpdir(), `automerge-service-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({
      databasePath,
      dataDir: tmpdir(),
      cacheDir: tmpdir(),
      silentMigrations: true,
    });
    await dbService.start();
  });

  afterEach(async () => {
    while (services.length > 0) {
      services.pop()?.stop();
    }
    while (tursoDatabases.length > 0) {
      await tursoDatabases.pop()?.close();
    }
    await dbService.stop();
  });

  test('loads persisted documents through both path and shared sqlite connection', async () => {
    const creator = new AutomergeService(databasePath);
    services.push(creator);

    const createdHandle = creator.repo.create<TCanvasDoc>({
      id: 'canvas-1',
      name: 'hello',
      elements: {},
      groups: {},
    });
    await createdHandle.whenReady();

    await waitForPersistedDoc({ dbService, automergeUrl: createdHandle.url });

    const pathReader = new AutomergeService(databasePath);
    services.push(pathReader);
    const sharedReader = new AutomergeService(dbService.sqlite);
    services.push(sharedReader);

    const pathHandle = await pathReader.repo.find<TCanvasDoc>(createdHandle.url as never);
    await pathHandle.whenReady();
    const pathDoc = pathHandle.doc();

    const sharedHandle = await sharedReader.repo.find<TCanvasDoc>(createdHandle.url as never);
    await sharedHandle.whenReady();
    const sharedDoc = sharedHandle.doc();

    expect(pathDoc).not.toBeNull();
    expect(pathDoc?.id).toBe('canvas-1');
    expect(pathDoc?.name).toBe('hello');

    expect(sharedDoc).not.toBeNull();
    expect(sharedDoc?.id).toBe('canvas-1');
    expect(sharedDoc?.name).toBe('hello');
  });

  test('loads persisted documents through turso connections', async () => {
    const turso = await connect(':memory:');
    tursoDatabases.push(turso);

    const creator = new AutomergeService(turso);
    services.push(creator);

    const createdHandle = creator.repo.create<TCanvasDoc>({
      id: 'canvas-turso-1',
      name: 'hello turso',
      elements: {},
      groups: {},
    });
    await createdHandle.whenReady();

    await waitForPersistedTursoDoc({ database: turso, automergeUrl: createdHandle.url });

    const reader = new AutomergeService({ type: 'turso', database: turso });
    services.push(reader);
    const handle = await reader.repo.find<TCanvasDoc>(createdHandle.url as never);
    await handle.whenReady();
    const doc = handle.doc();

    expect(doc).not.toBeNull();
    expect(doc?.id).toBe('canvas-turso-1');
    expect(doc?.name).toBe('hello turso');
  });

  test('notifies when an element is deleted from a watched canvas document', async () => {
    const deletedElements: Array<{ canvasId: string; element: TElement }> = [];
    const service = new AutomergeService(databasePath, (canvasId, element) => {
      deletedElements.push({ canvasId, element });
    });
    services.push(service);

    const element = createTestElement('element-1');
    const handle = service.repo.create<TCanvasDoc>({
      id: 'canvas-delete-test',
      name: 'delete test',
      elements: {
        [element.id]: element,
      },
      groups: {},
    });
    await handle.whenReady();

    await Bun.sleep(1100);

    handle.change((doc) => {
      delete doc.elements[element.id];
    });

    await waitFor({
      message: 'Timed out waiting for element delete notification',
      predicate: () => deletedElements.length === 1,
    });

    expect(deletedElements).toEqual([{ canvasId: 'canvas-delete-test', element }]);
  });
});
