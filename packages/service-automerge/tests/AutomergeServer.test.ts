import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomergeService } from '../src/AutomergeServer';
import { DbServiceBunSqlite } from '../../service-db/src/DbServiceBunSqlite/index';
import type { TCanvasDoc } from '../src/types/canvas-doc';

async function waitForPersistedDoc(args: { dbService: DbServiceBunSqlite; automergeUrl: string; timeoutMs?: number }): Promise<void> {
  const startedAt = Date.now();
  const prefix = `${args.automergeUrl.replace('automerge:', '')}*`;
  const timeoutMs = args.timeoutMs ?? 2000;

  while (Date.now() - startedAt < timeoutMs) {
    const row = args.dbService.sqlite.prepare('select count(*) as n from automerge_repo_data where key glob ?').get(prefix) as { n: number };
    if (row.n > 0) return;
    await Bun.sleep(25);
  }

  throw new Error(`Timed out waiting for persisted Automerge data for ${args.automergeUrl}`);
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
});
