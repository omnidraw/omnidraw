/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { connect, type Database as TursoDatabase } from '@tursodatabase/database';
import { AutomergeService } from '../src/AutomergeService';
import type { TCanvasDoc, TElement } from '../src/types/canvas-doc.types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(args: { predicate: () => boolean | Promise<boolean>; message: string; timeoutMs?: number }): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = args.timeoutMs ?? 2000;

  while (Date.now() - startedAt < timeoutMs) {
    if (await args.predicate()) return;
    await sleep(25);
  }

  throw new Error(args.message);
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

function createNoopAutomergeCallbacks(): ConstructorParameters<typeof AutomergeService>[1] {
  return {
    onElementDelete: () => {},
    onElementCreate: () => {},
  };
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
  const services: AutomergeService[] = [];
  const tursoDatabases: TursoDatabase[] = [];

  afterEach(async () => {
    while (services.length > 0) {
      services.pop()?.stop();
    }
    await sleep(50);
    while (tursoDatabases.length > 0) {
      await tursoDatabases.pop()?.close();
    }
  });

  test('loads persisted documents through turso connections', async () => {
    const turso = await connect(':memory:');
    tursoDatabases.push(turso);

    const creator = new AutomergeService(turso, createNoopAutomergeCallbacks());
    creator.start();
    services.push(creator);

    const createdHandle = creator.repo.create<TCanvasDoc>({
      id: 'canvas-turso-1',
      name: 'hello turso',
      elements: {},
      groups: {},
    });
    await createdHandle.whenReady();

    await waitForPersistedTursoDoc({ database: turso, automergeUrl: createdHandle.url });

    const reader = new AutomergeService({ type: 'turso', database: turso }, createNoopAutomergeCallbacks());
    reader.start();
    services.push(reader);
    const handle = await reader.repo.find<TCanvasDoc>(createdHandle.url as never);
    await handle.whenReady();
    const doc = handle.doc();

    expect(doc).not.toBeNull();
    expect(doc?.id).toBe('canvas-turso-1');
    expect(doc?.name).toBe('hello turso');
  });

  test('notifies when an element is deleted from a watched canvas document', async () => {
    const deletedElements: Array<{ canvasDocId: string; automergeUrl: string; element: TElement }> = [];
    const turso = await connect(':memory:');
    tursoDatabases.push(turso);

    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      onElementDelete: (event) => {
        deletedElements.push(event);
      },
    });
    service.start();
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

    await sleep(1100);

    handle.change((doc) => {
      delete doc.elements[element.id];
    });

    await waitFor({
      message: 'Timed out waiting for element delete notification',
      predicate: () => deletedElements.length === 1,
    });

    expect(deletedElements).toEqual([{ canvasDocId: 'canvas-delete-test', automergeUrl: handle.url, element }]);
  });

  test('notifies when an element is created in a watched canvas document', async () => {
    const createdElements: Array<{ canvasDocId: string; automergeUrl: string; element: TElement }> = [];
    const turso = await connect(':memory:');
    tursoDatabases.push(turso);

    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      onElementCreate: (event) => {
        createdElements.push(event);
      },
    });
    service.start();
    services.push(service);

    const handle = service.repo.create<TCanvasDoc>({
      id: 'canvas-create-test',
      name: 'create test',
      elements: {},
      groups: {},
    });
    await handle.whenReady();

    await sleep(1100);

    const element = createTestElement('element-created-1');
    handle.change((doc) => {
      doc.elements[element.id] = element;
    });

    await waitFor({
      message: 'Timed out waiting for element create notification',
      predicate: () => createdElements.length === 1,
    });

    expect(createdElements).toEqual([{ canvasDocId: 'canvas-create-test', automergeUrl: handle.url, element }]);
  });
});
