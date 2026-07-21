/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { connect, type Database as TursoDatabase } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { AutomergeService } from '../src/AutomergeService';
import type { TCanvasDoc, TElement } from '../src/types/canvas-doc.types';

const TENANT_A: TTenantContext = Object.freeze({
  orgId: '11111111-1111-4111-8111-111111111111',
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cellId: 'cell-test',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['canvas:write']),
  requestId: 'request-a',
});

const TENANT_B: TTenantContext = Object.freeze({
  orgId: '22222222-2222-4222-8222-222222222222',
  accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  cellId: 'cell-test',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['canvas:write']),
  requestId: 'request-b',
});

const TENANT_A_OTHER_ACCOUNT: TTenantContext = Object.freeze({
  ...TENANT_A,
  accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requestId: 'request-a-other-account',
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(args: {
  predicate: () => boolean | Promise<boolean>;
  message: string;
  timeoutMs?: number;
}): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = args.timeoutMs ?? 3000;
  while (Date.now() - startedAt < timeoutMs) {
    if (await args.predicate()) return;
    await sleep(25);
  }
  throw new Error(args.message);
}

async function waitForPersistedTursoDoc(args: {
  database: TursoDatabase;
  tenantContext: TTenantContext;
  automergeUrl: string;
  timeoutMs?: number;
}): Promise<void> {
  await waitFor({
    timeoutMs: args.timeoutMs,
    message: `Timed out waiting for persisted Turso Automerge data for ${args.automergeUrl}`,
    predicate: async () => {
      const row = await (await args.database.prepare(`
        SELECT count(*) AS n
        FROM collaboration_chunks AS chunks
        INNER JOIN collaboration_documents AS documents
          ON documents.org_id = chunks.org_id AND documents.id = chunks.document_id
        WHERE documents.org_id = ? AND documents.automerge_url = ?
      `)).get(args.tenantContext.orgId, args.automergeUrl) as { n: number };
      return row.n > 0;
    },
  });
}

async function createMemoryTurso(): Promise<TursoDatabase> {
  const database = await connect(':memory:');
  await database.exec(`
    CREATE TABLE collaboration_documents (
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      automerge_url TEXT NOT NULL,
      PRIMARY KEY (org_id, id),
      UNIQUE (org_id, automerge_url)
    ) STRICT;
    CREATE TABLE collaboration_chunks (
      org_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_key TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      chunk_bytes BLOB NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (org_id, document_id, chunk_key),
      UNIQUE (org_id, document_id, sequence)
    ) STRICT;
  `);
  return database;
}

async function registerDocument(args: {
  database: TursoDatabase;
  service: AutomergeService;
  tenantContext: TTenantContext;
  id: string;
  automergeUrl: string;
}): Promise<void> {
  await (await args.database.prepare(`
    INSERT INTO collaboration_documents (org_id, id, automerge_url)
    VALUES (?, ?, ?)
  `)).run(args.tenantContext.orgId, args.id, args.automergeUrl);
  await args.service.notifyDocumentRegistered(args.tenantContext, args.automergeUrl);
}

function createNoopAutomergeCallbacks(): ConstructorParameters<typeof AutomergeService>[1] {
  return {
    authorizeDocument: () => true,
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
    while (services.length > 0) await services.pop()?.stop();
    while (tursoDatabases.length > 0) await tursoDatabases.pop()?.close();
  });

  test('one shared service persists and reloads same-id documents for two organizations', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const creator = new AutomergeService(turso, createNoopAutomergeCallbacks());
    creator.start();
    services.push(creator);

    const handleA = await creator.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-a',
      name: 'organization A',
      elements: {},
      groups: {},
    });
    const handleB = await creator.createDocument<TCanvasDoc>(TENANT_B, {
      id: 'canvas-b',
      name: 'organization B',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service: creator,
      tenantContext: TENANT_A,
      id: 'same-directory-document-id',
      automergeUrl: handleA.url,
    });
    await registerDocument({
      database: turso,
      service: creator,
      tenantContext: TENANT_B,
      id: 'same-directory-document-id',
      automergeUrl: handleB.url,
    });
    await waitForPersistedTursoDoc({ database: turso, tenantContext: TENANT_A, automergeUrl: handleA.url });
    await waitForPersistedTursoDoc({ database: turso, tenantContext: TENANT_B, automergeUrl: handleB.url });

    const reader = new AutomergeService({ type: 'turso', database: turso }, createNoopAutomergeCallbacks());
    reader.start();
    services.push(reader);
    const readA = await reader.findDocument<TCanvasDoc>(TENANT_A, handleA.url);
    const readB = await reader.findDocument<TCanvasDoc>(TENANT_B, handleB.url);

    expect(readA.doc().name).toBe('organization A');
    expect(readB.doc().name).toBe('organization B');
    expect(reader.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);
    expect(reader.getTenantMetrics(TENANT_B).activeDocuments).toBe(1);

    const chunkOrganizations = await (await turso.prepare(`
      SELECT DISTINCT org_id
      FROM collaboration_chunks
      ORDER BY org_id ASC
    `)).all() as Array<{ org_id: string }>;
    expect(chunkOrganizations.map(({ org_id }) => org_id)).toEqual([
      TENANT_A.orgId,
      TENANT_B.orgId,
    ]);
  });

  test('known foreign and unknown document ids fail without existence leakage', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks());
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-private',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'private-document',
      automergeUrl: handle.url,
    });

    await expect(service.findDocument<TCanvasDoc>(TENANT_B, handle.url))
      .rejects.toThrow('Automerge document is unavailable.');
    await expect(service.findDocument<TCanvasDoc>(TENANT_B, 'automerge:11111111111111111111111111111111'))
      .rejects.toThrow('Automerge document is unavailable.');
    expect(service.getTenantMetrics(TENANT_B).deniedDocuments).toBe(2);
    expect(service.getTenantMetrics(TENANT_B).activeDocuments).toBe(0);
    expect(service.getTenantMetrics(TENANT_A).deniedDocuments).toBe(0);
  });

  test('passes tenant context to element callbacks without polling known handles', async () => {
    const createdElements: Array<{ accountId: string; orgId: string; element: TElement }> = [];
    const deletedElements: Array<{ accountId: string; orgId: string; element: TElement }> = [];
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, {
      authorizeDocument: () => true,
      onElementCreate: (event) => {
        createdElements.push({
          accountId: event.tenantContext.accountId,
          orgId: event.tenantContext.orgId,
          element: event.element,
        });
      },
      onElementDelete: (event) => {
        deletedElements.push({
          accountId: event.tenantContext.accountId,
          orgId: event.tenantContext.orgId,
          element: event.element,
        });
      },
    });
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-callback',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'callback-document',
      automergeUrl: handle.url,
    });
    await service.findDocument<TCanvasDoc>(TENANT_A_OTHER_ACCOUNT, handle.url);

    const element = createTestElement('element-callback');
    handle.change((doc) => {
      doc.elements[element.id] = element;
    });
    await waitFor({
      message: 'Timed out waiting for element create notification',
      predicate: () => createdElements.length === 1,
    });
    handle.change((doc) => {
      delete doc.elements[element.id];
    });
    await waitFor({
      message: 'Timed out waiting for element delete notification',
      predicate: () => deletedElements.length === 1,
    });

    expect(createdElements).toEqual([{
      accountId: TENANT_A.accountId,
      orgId: TENANT_A.orgId,
      element,
    }]);
    expect(deletedElements).toEqual([{
      accountId: TENANT_A.accountId,
      orgId: TENANT_A.orgId,
      element,
    }]);
  });

  test('denies a same-organization account without document membership', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      authorizeDocument: (tenantContext) => tenantContext.accountId === TENANT_A.accountId,
    });
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-account-private',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'account-private-document',
      automergeUrl: handle.url,
    });

    await expect(service.findDocument<TCanvasDoc>(TENANT_A_OTHER_ACCOUNT, handle.url))
      .rejects.toThrow('Automerge document is unavailable.');
    await expect(service.findDocument<TCanvasDoc>(
      TENANT_A_OTHER_ACCOUNT,
      'automerge:22222222222222222222222222222222',
    )).rejects.toThrow('Automerge document is unavailable.');
    await expect(service.deleteDocument(TENANT_A_OTHER_ACCOUNT, handle.url))
      .rejects.toThrow('Automerge document is unavailable.');
    expect((await service.findDocument<TCanvasDoc>(TENANT_A, handle.url)).doc().id)
      .toBe('canvas-account-private');
  });

  test('bounds handles with LRU eviction and reports tenant-local metrics', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks(), {
      maxActiveDocuments: 1,
      documentIdleMs: 60_000,
      lifecycleSweepMs: 60_000,
    });
    service.start();
    services.push(service);
    const handleA = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-capacity-a',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'capacity-document-a',
      automergeUrl: handleA.url,
    });
    const handleB = await service.createDocument<TCanvasDoc>(TENANT_B, {
      id: 'canvas-capacity-b',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_B,
      id: 'capacity-document-b',
      automergeUrl: handleB.url,
    });

    expect(handleA.isUnloaded()).toBe(true);
    expect(handleB.isReady()).toBe(true);
    expect(service.getTenantMetrics(TENANT_A)).toMatchObject({
      activeDocuments: 0,
      evictedDocuments: 1,
    });
    expect(service.getTenantMetrics(TENANT_B)).toMatchObject({
      activeDocuments: 1,
      evictedDocuments: 0,
    });

    const reloadedA = await service.findDocument<TCanvasDoc>(TENANT_A, handleA.url);
    expect(reloadedA).not.toBe(handleA);
    expect(reloadedA.doc().id).toBe('canvas-capacity-a');
    expect(service.getTenantMetrics(TENANT_A)).toMatchObject({
      activeDocuments: 1,
      evictedDocuments: 1,
    });
    expect(service.getTenantMetrics(TENANT_B)).toMatchObject({
      activeDocuments: 0,
      evictedDocuments: 1,
    });
  });

  test('stops without waiting on an unregistered document write', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks());
    service.start();
    services.push(service);
    await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-unregistered',
      elements: {},
      groups: {},
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('AutomergeService stop timed out on unregistered document'));
      }, 500);
    });
    try {
      await Promise.race([service.stop(), timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  });

  test('drains the final registered document change before stopping', async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const turso = await createMemoryTurso();
      tursoDatabases.push(turso);
      const service = new AutomergeService(turso, createNoopAutomergeCallbacks());
      service.start();
      services.push(service);
      const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
        id: 'canvas-stop-drain',
        name: 'before-stop',
        elements: {},
        groups: {},
      });
      await registerDocument({
        database: turso,
        service,
        tenantContext: TENANT_A,
        id: 'stop-drain-document',
        automergeUrl: handle.url,
      });
      await waitForPersistedTursoDoc({
        database: turso,
        tenantContext: TENANT_A,
        automergeUrl: handle.url,
      });

      // Keep both callbacks to deterministically model a timer that was already
      // dispatched when the throttle tried to cancel it. This is the boundary
      // race that previously let a stale save run after the adapter was disposed.
      const nativeSetTimeout = globalThis.setTimeout;
      const nativeClearTimeout = globalThis.clearTimeout;
      const capturedTimeouts: Array<{
        callback: (...args: unknown[]) => unknown;
        args: unknown[];
        id: ReturnType<typeof setTimeout>;
      }> = [];
      globalThis.setTimeout = ((
        callback: (...args: unknown[]) => unknown,
        delay?: number,
        ...args: unknown[]
      ) => {
        const stack = new Error().stack ?? '';
        if (!stack.includes('/Repo.js:113:')) {
          return nativeSetTimeout(callback, delay, ...args);
        }
        const id = Object.freeze({ capturedTimeout: capturedTimeouts.length }) as unknown as ReturnType<typeof setTimeout>;
        capturedTimeouts.push({ callback, args, id });
        return id;
      }) as typeof setTimeout;
      globalThis.clearTimeout = ((timeoutId: ReturnType<typeof setTimeout>) => {
        if (capturedTimeouts.some(({ id }) => id === timeoutId)) return;
        nativeClearTimeout(timeoutId);
      }) as typeof clearTimeout;
      try {
        handle.change((doc) => {
          doc.name = 'intermediate-before-stop';
        });
        handle.change((doc) => {
          doc.name = 'final-before-stop';
        });
      } finally {
        globalThis.setTimeout = nativeSetTimeout;
        globalThis.clearTimeout = nativeClearTimeout;
      }
      expect(capturedTimeouts).toHaveLength(2);

      let stopSettled = false;
      const stopping = service.stop().finally(() => {
        stopSettled = true;
      });
      await Promise.resolve();
      expect(stopSettled).toBe(false);
      await capturedTimeouts[0]!.callback(...capturedTimeouts[0]!.args);
      await stopping;
      for (const timeout of capturedTimeouts.slice(1)) {
        await timeout.callback(...timeout.args);
      }
      await Promise.resolve();

      const reader = new AutomergeService(turso, createNoopAutomergeCallbacks());
      reader.start();
      services.push(reader);
      const reloaded = await reader.findDocument<TCanvasDoc>(TENANT_A, handle.url);

      expect(reloaded.doc().name).toBe('final-before-stop');
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
