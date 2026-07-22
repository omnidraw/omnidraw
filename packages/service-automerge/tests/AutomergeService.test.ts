/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import * as Automerge from '@automerge/automerge';
import { generateAutomergeUrl, parseAutomergeUrl } from '@automerge/automerge-repo';
import { connect, type Database as TursoDatabase } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { AutomergeService } from '../src/AutomergeService';
import type { WebSocketWithIsAlive } from '../src/adapters/websocket.adapter';
import type { TCanvasDoc, TElement } from '../src/types/canvas-doc.types';
// @ts-ignore - internal module
import { decode, encode } from '@automerge/automerge-repo/helpers/cbor.js';

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

type TMockSocket = WebSocketWithIsAlive & {
  sent: ArrayBuffer[];
  terminateCount: number;
};

function createSocket(): TMockSocket {
  return {
    data: { isAlive: false },
    readyState: 1,
    sent: [],
    terminateCount: 0,
    ping() {},
    close() {
      this.readyState = 3;
    },
    send(data: ArrayBuffer) {
      this.sent.push(data);
      return 1;
    },
    terminate() {
      this.terminateCount += 1;
      this.readyState = 3;
    },
  };
}

function encodeClientMessage(message: Record<string, unknown>): Buffer {
  return Buffer.from(encode(message as never));
}

function decodeLastMessage(socket: TMockSocket): Record<string, unknown> {
  const message = socket.sent.at(-1);
  if (message === undefined) throw new Error('Expected socket message.');
  return decode(new Uint8Array(message)) as Record<string, unknown>;
}

function createReadOnlySyncMessage(): Uint8Array {
  const [, message] = Automerge.generateSyncMessage(
    Automerge.init(),
    Automerge.initSyncState(),
  );
  if (message === null) throw new Error('Expected a read-only Automerge sync message.');
  return message;
}

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
    CREATE TABLE canvas_members (
      org_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (org_id, canvas_id, account_id)
    ) STRICT;
    CREATE TABLE widget_instances (
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      element_id TEXT NOT NULL,
      definition_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (org_id, id)
    ) STRICT;
    CREATE TABLE collaboration_documents (
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      canvas_id TEXT,
      widget_instance_id TEXT,
      automerge_url TEXT NOT NULL,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK (content_version >= 0),
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
    CREATE TABLE widget_instance_projection_heads (
      org_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      source_sequence INTEGER NOT NULL,
      PRIMARY KEY (org_id, canvas_id)
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
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url
    ) VALUES (?, ?, ?, NULL, ?)
  `)).run(args.tenantContext.orgId, args.id, `${args.id}-canvas`, args.automergeUrl);
  await (await args.database.prepare(`
    INSERT OR IGNORE INTO canvas_members (org_id, canvas_id, account_id)
    VALUES (?, ?, ?)
  `)).run(args.tenantContext.orgId, `${args.id}-canvas`, args.tenantContext.accountId);
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

  test('rejects a non-canonical document URL before consulting external policy', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    let authorizationCalls = 0;
    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      authorizeDocument: () => {
        authorizationCalls += 1;
        return true;
      },
    });
    service.start();
    services.push(service);

    await expect(service.admitDocument(TENANT_A, 'automerge:not-valid')).resolves.toBe(false);
    expect(authorizationCalls).toBe(0);
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

    const reloadedSnapshots: Array<{
      canvasId: string;
      sourceSequence: number;
      elementIds: string[];
    }> = [];
    const reader = new AutomergeService({ type: 'turso', database: turso }, {
      ...createNoopAutomergeCallbacks(),
      onDocumentSnapshot: (event) => {
        reloadedSnapshots.push({
          canvasId: event.canvasId,
          sourceSequence: event.sourceSequence,
          elementIds: Object.keys(event.elements).sort(),
        });
      },
    });
    reader.start();
    services.push(reader);
    const readA = await reader.findDocument<TCanvasDoc>(TENANT_A, handleA.url);
    const readB = await reader.findDocument<TCanvasDoc>(TENANT_B, handleB.url);

    expect(readA.doc().name).toBe('organization A');
    expect(readB.doc().name).toBe('organization B');
    expect(reloadedSnapshots).toEqual([
      {
        canvasId: 'same-directory-document-id-canvas',
        sourceSequence: 1,
        elementIds: [],
      },
      {
        canvasId: 'same-directory-document-id-canvas',
        sourceSequence: 1,
        elementIds: [],
      },
    ]);
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
    await (await turso.prepare(`
      INSERT INTO canvas_members (org_id, canvas_id, account_id)
      VALUES (?, ?, ?)
    `)).run(TENANT_A.orgId, 'callback-document-canvas', TENANT_A_OTHER_ACCOUNT.accountId);
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

  test('projects authoritative canvas identity from the exact persisted Automerge heads', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const snapshots: Array<{
      canvasId: string;
      sourceSequence: number;
      elementIds: string[];
    }> = [];
    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      onDocumentSnapshot: (event) => {
        snapshots.push({
          canvasId: event.canvasId,
          sourceSequence: event.sourceSequence,
          elementIds: Object.keys(event.elements).sort(),
        });
      },
    });
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'peer-controlled-embedded-id',
      elements: { first: createTestElement('first') },
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'projection-document',
      automergeUrl: handle.url,
    });
    await waitFor({
      message: 'Timed out waiting for the initial persisted projection snapshot',
      predicate: () => snapshots.some((snapshot) => snapshot.sourceSequence > 0),
    });
    const initialPersisted = snapshots.at(-1)!;
    let writeBlocked = false;
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const rawTransaction = turso.transaction.bind(turso);
    const gatedTransaction = ((
      callback: Parameters<TursoDatabase['transaction']>[0],
    ) => {
      const execute = rawTransaction(callback);
      return async () => {
        writeBlocked = true;
        await writeGate;
        return execute();
      };
    }) as TursoDatabase['transaction'];
    Object.defineProperty(turso, 'transaction', {
      configurable: true,
      value: gatedTransaction,
    });
    handle.change((doc) => {
      doc.elements.second = createTestElement('second');
    });
    await waitFor({
      message: 'Timed out waiting for the changed document persistence barrier',
      predicate: () => writeBlocked,
    });
    try {
      await service.findDocument<TCanvasDoc>(TENANT_A, handle.url);
      expect(snapshots.at(-1)).toEqual(initialPersisted);
    } finally {
      releaseWrite();
    }
    await waitFor({
      message: 'Timed out waiting for the changed persisted projection snapshot',
      predicate: () => snapshots.some((snapshot) => snapshot.elementIds.length === 2),
    });

    const persisted = snapshots.filter((snapshot) => snapshot.sourceSequence > 0);
    expect(persisted.every(({ canvasId }) => canvasId === 'projection-document-canvas')).toBe(true);
    expect(persisted.at(-1)?.elementIds).toEqual(['first', 'second']);
    expect(persisted.at(-1)?.sourceSequence).toBeGreaterThan(persisted[0]!.sourceSequence);
  });

  test('seeds a migrated version-zero projection before applying its first incremental save', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const creator = new AutomergeService(turso, createNoopAutomergeCallbacks());
    creator.start();
    services.push(creator);
    const initialElementIds = Array.from({ length: 128 }, (_, index) => `legacy-${index}`);
    const created = await creator.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'legacy-large-canvas',
      elements: Object.fromEntries(initialElementIds.map((id) => [id, createTestElement(id)])),
      groups: {},
    });
    await registerDocument({
      database: turso,
      service: creator,
      tenantContext: TENANT_A,
      id: 'legacy-large-document',
      automergeUrl: created.url,
    });
    await waitForPersistedTursoDoc({
      database: turso,
      tenantContext: TENANT_A,
      automergeUrl: created.url,
    });
    await creator.stop();
    await (await turso.prepare(`
      UPDATE collaboration_documents
      SET content_version = 0
      WHERE org_id = ? AND id = ?
    `)).run(TENANT_A.orgId, 'legacy-large-document');

    const snapshots: Array<{ sourceSequence: number; elementIds: string[] }> = [];
    const reader = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      onDocumentSnapshot(event) {
        snapshots.push({
          sourceSequence: event.sourceSequence,
          elementIds: Object.keys(event.elements).sort(),
        });
      },
    });
    reader.start();
    services.push(reader);
    const reloaded = await reader.findDocument<TCanvasDoc>(TENANT_A, created.url);

    expect(snapshots).toEqual([{
      sourceSequence: 0,
      elementIds: [...initialElementIds].sort(),
    }]);
    reloaded.change((doc) => {
      doc.elements.after = createTestElement('after');
    });
    await waitFor({
      message: 'Timed out waiting for the first post-migration incremental projection',
      predicate: () => snapshots.some((snapshot) => (
        snapshot.sourceSequence === 1 && snapshot.elementIds.length === initialElementIds.length + 1
      )),
    });
    expect(snapshots.at(-1)).toEqual({
      sourceSequence: 1,
      elementIds: ['after', ...initialElementIds].sort(),
    });
    const chunkKinds = await (await turso.prepare(`
      SELECT chunk_key
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ?
      ORDER BY sequence ASC
    `)).all(TENANT_A.orgId, 'legacy-large-document') as Array<{ chunk_key: string }>;
    expect(chunkKinds.some(({ chunk_key }) => chunk_key.includes('.incremental.'))).toBe(true);
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

  test('does not let a same-organization nonmember release or delete an active member document', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks());
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-cached-member-only',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'cached-member-only-document',
      automergeUrl: handle.url,
    });
    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);

    await service.releaseDocument(TENANT_A_OTHER_ACCOUNT, handle.url);

    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);
    await expect(service.deleteDocument(TENANT_A_OTHER_ACCOUNT, handle.url))
      .rejects.toThrow('Automerge document is unavailable.');
    const persisted = await (await turso.prepare(`
      SELECT count(*) AS n
      FROM collaboration_documents
      WHERE org_id = ? AND automerge_url = ?
    `)).get(TENANT_A.orgId, handle.url) as { n: number };
    expect(persisted.n).toBe(1);
    expect((await service.findDocument<TCanvasDoc>(TENANT_A, handle.url)).doc().id)
      .toBe('canvas-cached-member-only');
  });

  test('keeps concurrent local acquisitions live until their final tenant release', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks());
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'concurrent-local-acquisitions-canvas',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'concurrent-local-acquisitions-document',
      automergeUrl: handle.url,
    });
    const concurrentTenant = Object.freeze({
      ...TENANT_A,
      requestId: 'request-a-concurrent',
    });

    const [first, second] = await Promise.all([
      service.findDocument<TCanvasDoc>(TENANT_A, handle.url),
      service.findDocument<TCanvasDoc>(concurrentTenant, handle.url),
    ]);
    expect(first.doc().id).toBe('concurrent-local-acquisitions-canvas');
    expect(second.doc().id).toBe('concurrent-local-acquisitions-canvas');

    await service.releaseDocument(TENANT_A, handle.url);

    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);
    expect(second.doc().id).toBe('concurrent-local-acquisitions-canvas');

    await service.releaseDocument(concurrentTenant, handle.url);

    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(0);
  });

  for (const finalPeerAuthority of [true, false]) {
    test(`fences final local release while peer admission ${
      finalPeerAuthority ? 'attaches' : 'is denied'
    }`, async () => {
      const turso = await createMemoryTurso();
      tursoDatabases.push(turso);
      const peerTenant = Object.freeze({
        ...TENANT_A,
        requestId: `request-peer-admission-${finalPeerAuthority}`,
      });
      let peerAuthorizationCalls = 0;
      let markFinalAuthorizationStarted!: () => void;
      const finalAuthorizationStarted = new Promise<void>((resolve) => {
        markFinalAuthorizationStarted = resolve;
      });
      let settleFinalAuthorization!: (authorized: boolean) => void;
      const finalAuthorization = new Promise<boolean>((resolve) => {
        settleFinalAuthorization = resolve;
      });
      let fencePeerAuthorization = false;
      const service = new AutomergeService(turso, {
        ...createNoopAutomergeCallbacks(),
        authorizeDocument(tenantContext) {
          if (!fencePeerAuthorization || tenantContext.requestId !== peerTenant.requestId) {
            return true;
          }
          peerAuthorizationCalls += 1;
          if (peerAuthorizationCalls !== 2) return true;
          markFinalAuthorizationStarted();
          return finalAuthorization;
        },
      });
      service.start();
      services.push(service);
      const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
        id: `peer-admission-race-${finalPeerAuthority}`,
        elements: {},
        groups: {},
      });
      await registerDocument({
        database: turso,
        service,
        tenantContext: TENANT_A,
        id: `peer-admission-race-document-${finalPeerAuthority}`,
        automergeUrl: handle.url,
      });
      await service.findDocument<TCanvasDoc>(TENANT_A, handle.url);

      const socket = createSocket();
      service.openConnection(peerTenant, socket);
      await service.receiveConnectionMessage(peerTenant, socket, encodeClientMessage({
        type: 'join',
        senderId: `peer-admission-${finalPeerAuthority}`,
        supportedProtocolVersions: ['1'],
      }));
      const serverPeerId = decodeLastMessage(socket).senderId;
      if (typeof serverPeerId !== 'string') throw new Error('Expected the server peer id.');

      fencePeerAuthorization = true;
      const receiving = service.receiveConnectionMessage(peerTenant, socket, encodeClientMessage({
        type: 'request',
        senderId: `peer-admission-${finalPeerAuthority}`,
        targetId: serverPeerId,
        documentId: parseAutomergeUrl(handle.url).documentId,
        data: createReadOnlySyncMessage(),
      }));
      await finalAuthorizationStarted;

      await service.releaseDocument(TENANT_A, handle.url);

      const pendingRecord = [...(service as unknown as {
        documentRecords: Map<string, {
          automergeUrl: string;
          localLeaseCount: number;
          peerCount: number;
          pendingAdmissionIds: Set<number>;
        }>;
      }).documentRecords.values()].find((record) => record.automergeUrl === handle.url);
      expect(pendingRecord).toMatchObject({
        localLeaseCount: 0,
        peerCount: 0,
      });
      expect(pendingRecord?.pendingAdmissionIds.size).toBe(1);
      expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);

      settleFinalAuthorization(finalPeerAuthority);
      await receiving;

      if (finalPeerAuthority) {
        const retainedRecord = [...(service as unknown as {
          documentRecords: Map<string, {
            automergeUrl: string;
            localLeaseCount: number;
            peerCount: number;
            pendingAdmissionIds: Set<number>;
          }>;
        }).documentRecords.values()].find((record) => record.automergeUrl === handle.url);
        expect(retainedRecord).toMatchObject({
          localLeaseCount: 0,
          peerCount: 1,
        });
        expect(retainedRecord?.pendingAdmissionIds.size).toBe(0);
        expect(service.getTenantMetrics(peerTenant)).toMatchObject({
          activeDocuments: 1,
          admittedPeerDocuments: 1,
        });
        expect(socket.terminateCount).toBe(0);
      } else {
        expect(service.getTenantMetrics(peerTenant)).toMatchObject({
          activeDocuments: 0,
          admittedPeerDocuments: 0,
        });
        expect(socket.terminateCount).toBe(1);
      }
    });
  }

  test('cancels and drains a pending peer admission before stop disposes storage', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const peerTenant = Object.freeze({ ...TENANT_A, requestId: 'request-peer-stop' });
    let peerAuthorizationCalls = 0;
    let markFinalAuthorizationStarted!: () => void;
    const finalAuthorizationStarted = new Promise<void>((resolve) => {
      markFinalAuthorizationStarted = resolve;
    });
    let settleFinalAuthorization!: (authorized: boolean) => void;
    const finalAuthorization = new Promise<boolean>((resolve) => {
      settleFinalAuthorization = resolve;
    });
    let fencePeerAuthorization = false;
    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      authorizeDocument(tenantContext) {
        if (!fencePeerAuthorization || tenantContext.requestId !== peerTenant.requestId) return true;
        peerAuthorizationCalls += 1;
        if (peerAuthorizationCalls !== 2) return true;
        markFinalAuthorizationStarted();
        return finalAuthorization;
      },
    });
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'pending-peer-stop-canvas',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'pending-peer-stop-document',
      automergeUrl: handle.url,
    });

    const socket = createSocket();
    service.openConnection(peerTenant, socket);
    await service.receiveConnectionMessage(peerTenant, socket, encodeClientMessage({
      type: 'join',
      senderId: 'pending-peer-stop',
      supportedProtocolVersions: ['1'],
    }));
    const serverPeerId = decodeLastMessage(socket).senderId;
    if (typeof serverPeerId !== 'string') throw new Error('Expected the server peer id.');
    fencePeerAuthorization = true;
    const receiving = service.receiveConnectionMessage(peerTenant, socket, encodeClientMessage({
      type: 'request',
      senderId: 'pending-peer-stop',
      targetId: serverPeerId,
      documentId: parseAutomergeUrl(handle.url).documentId,
      data: createReadOnlySyncMessage(),
    }));
    await finalAuthorizationStarted;

    await expect(Promise.race([
      service.stop().then(() => 'stopped'),
      sleep(500).then(() => 'timed-out'),
    ])).resolves.toBe('stopped');
    await receiving;
    const internals = service as unknown as {
      documentRecords: Map<string, unknown>;
      pendingAdmissionTasks: Set<Promise<unknown>>;
      pendingPreflightTasks: Set<Promise<unknown>>;
      storageAdapter: unknown;
    };
    expect(internals.documentRecords.size).toBe(0);
    expect(internals.pendingAdmissionTasks.size).toBe(0);
    expect(internals.pendingPreflightTasks.size).toBe(0);
    expect(internals.storageAdapter).toBeNull();
    expect(socket.terminateCount).toBe(1);

    settleFinalAuthorization(true);
    await Promise.resolve();
    expect(internals.documentRecords.size).toBe(0);
  });

  test('releases a local acquisition after its document authority is revoked', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks());
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'revoked-local-acquisition-canvas',
      elements: {},
      groups: {},
    });
    const documentId = 'revoked-local-acquisition-document';
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: documentId,
      automergeUrl: handle.url,
    });
    expect((await service.findDocument<TCanvasDoc>(TENANT_A, handle.url)).doc().id)
      .toBe('revoked-local-acquisition-canvas');
    await (await turso.prepare(`
      DELETE FROM canvas_members
      WHERE org_id = ? AND canvas_id = ? AND account_id = ?
    `)).run(TENANT_A.orgId, `${documentId}-canvas`, TENANT_A.accountId);

    await service.releaseDocument(TENANT_A, handle.url);

    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(0);
    await expect(service.findDocument<TCanvasDoc>(TENANT_A, handle.url))
      .rejects.toThrow('Automerge document is unavailable.');
    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(0);
  });

  test('releases projections after true document release but not global stop', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const releases: Array<Readonly<{
      automergeUrl: string;
      canvasId: string;
    }>> = [];
    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      async onDocumentRelease(event) {
        await Promise.resolve();
        releases.push({
          automergeUrl: event.automergeUrl,
          canvasId: event.canvasId,
        });
      },
    }, {
      maxActiveDocuments: 1,
      documentIdleMs: 60_000,
      lifecycleSweepMs: 60_000,
    });
    service.start();
    services.push(service);

    const capacity = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'release-capacity-canvas',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'release-capacity-document',
      automergeUrl: capacity.url,
    });
    const manual = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'release-manual-canvas',
      elements: {},
      groups: {},
    });
    expect(releases).toEqual([{
      automergeUrl: capacity.url,
      canvasId: 'release-capacity-document-canvas',
    }]);
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'release-manual-document',
      automergeUrl: manual.url,
    });
    await service.releaseDocument(TENANT_A, manual.url);
    expect(releases.at(-1)).toEqual({
      automergeUrl: manual.url,
      canvasId: 'release-manual-document-canvas',
    });

    const deleted = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'release-delete-canvas',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'release-delete-document',
      automergeUrl: deleted.url,
    });
    await service.deleteDocument(TENANT_A, deleted.url);
    expect(releases.at(-1)).toEqual({
      automergeUrl: deleted.url,
      canvasId: 'release-delete-document-canvas',
    });

    const stopped = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'release-stop-canvas',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'release-stop-document',
      automergeUrl: stopped.url,
    });
    const releaseCountBeforeStop = releases.length;
    await service.stop();
    expect(releases).toHaveLength(releaseCountBeforeStop);
  });

  test('keeps the document live when projection release rejects', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    let rejectRelease = true;
    const service = new AutomergeService(turso, {
      ...createNoopAutomergeCallbacks(),
      onDocumentRelease() {
        if (rejectRelease) throw new Error('projection quarantine is unresolved');
      },
    });
    service.start();
    services.push(service);
    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'release-fail-closed-canvas',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'release-fail-closed-document',
      automergeUrl: handle.url,
    });

    await expect(service.releaseDocument(TENANT_A, handle.url))
      .rejects.toThrow('projection quarantine is unresolved');
    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);
    expect(handle.isReady()).toBe(true);
    expect((await service.findDocument<TCanvasDoc>(TENANT_A, handle.url)).doc().id)
      .toBe('release-fail-closed-canvas');

    rejectRelease = false;
    await service.releaseDocument(TENANT_A, handle.url);
    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(0);
  });

  test('keeps lifecycle timer sweeps single-flight while an eviction flush is stalled', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const lifecycleSweepMs = 987_654_321;
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks(), {
      documentIdleMs: 0,
      lifecycleSweepMs,
    });
    let lifecycleTick: (() => void) | undefined;
    const nativeSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((
      callback: (...args: unknown[]) => unknown,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay !== lifecycleSweepMs) return nativeSetInterval(callback, delay, ...args);
      lifecycleTick = () => {
        callback(...args);
      };
      return nativeSetInterval(() => undefined, lifecycleSweepMs);
    }) as typeof setInterval;
    try {
      service.start();
    } finally {
      globalThis.setInterval = nativeSetInterval;
    }
    services.push(service);
    expect(lifecycleTick).toBeDefined();

    const handle = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'lifecycle-single-flight-canvas',
      elements: {},
      groups: {},
    });
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'lifecycle-single-flight-document',
      automergeUrl: handle.url,
    });

    const internals = service as unknown as {
      evictIdleDocuments(): Promise<void>;
      lifecycleSweepTask: Promise<void> | null;
      lifecycleTail: Promise<void>;
      repoInstance: {
        flush(...args: unknown[]): Promise<void>;
      };
    };
    const originalSweep = internals.evictIdleDocuments.bind(service);
    let sweepCalls = 0;
    internals.evictIdleDocuments = async () => {
      sweepCalls += 1;
      await originalSweep();
    };
    const originalFlush = internals.repoInstance.flush.bind(internals.repoInstance);
    let flushCalls = 0;
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    internals.repoInstance.flush = async (...args: unknown[]) => {
      flushCalls += 1;
      if (flushCalls === 1) {
        await flushGate;
        throw new Error('deterministic stalled lifecycle flush failure');
      }
      await originalFlush(...args);
    };

    lifecycleTick!();
    await waitFor({
      message: 'Timed out waiting for the lifecycle eviction flush to stall',
      predicate: () => flushCalls === 1,
    });
    for (let index = 0; index < 100; index += 1) lifecycleTick!();
    await Promise.resolve();
    expect(sweepCalls).toBe(1);
    expect(flushCalls).toBe(1);

    releaseFlush();
    await internals.lifecycleTail;
    await Promise.resolve();
    expect(sweepCalls).toBe(1);
    expect(internals.lifecycleSweepTask).toBeNull();

    lifecycleTick!();
    await internals.lifecycleTail;
    await Promise.resolve();
    expect(sweepCalls).toBe(2);
    expect(flushCalls).toBe(2);
    expect(internals.lifecycleSweepTask).toBeNull();
    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(0);
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

  test('evicts a terminally unavailable handle so a rejected load cannot exhaust capacity', async () => {
    const turso = await createMemoryTurso();
    tursoDatabases.push(turso);
    const service = new AutomergeService(turso, createNoopAutomergeCallbacks(), {
      maxActiveDocuments: 1,
      documentIdleMs: 60_000,
      lifecycleSweepMs: 60_000,
    });
    service.start();
    services.push(service);

    const unavailableUrl = generateAutomergeUrl();
    const unavailableDocumentId = parseAutomergeUrl(unavailableUrl).documentId;
    await registerDocument({
      database: turso,
      service,
      tenantContext: TENANT_A,
      id: 'unavailable-capacity-document',
      automergeUrl: unavailableUrl,
    });
    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);
    const finding = service.findDocument<TCanvasDoc>(TENANT_A, unavailableUrl);
    const findingRejected = expect(finding).rejects.toThrow('unavailable');
    const repository = (service as unknown as {
      repoInstance: { handles: Record<string, { unavailable(): void }> };
    }).repoInstance;
    await waitFor({
      message: 'Timed out waiting for the unavailable handle to enter the repository cache',
      predicate: () => repository.handles[unavailableDocumentId] !== undefined,
    });
    repository.handles[unavailableDocumentId]!.unavailable();
    await findingRejected;

    await service.releaseDocument(TENANT_A, unavailableUrl);
    expect(service.getTenantMetrics(TENANT_A)).toMatchObject({
      activeDocuments: 0,
      evictedDocuments: 1,
    });
    expect(repository.handles[unavailableDocumentId]).toBeUndefined();

    const next = await service.createDocument<TCanvasDoc>(TENANT_A, {
      id: 'canvas-after-unavailable',
      elements: {},
      groups: {},
    });
    expect(next.isReady()).toBe(true);
    expect(service.getTenantMetrics(TENANT_A).activeDocuments).toBe(1);
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
