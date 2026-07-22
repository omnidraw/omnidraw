import { afterEach, describe, expect, test } from 'bun:test';
import * as Automerge from '@automerge/automerge';
import {
  generateAutomergeUrl,
  parseAutomergeUrl,
} from '@automerge/automerge-repo';
import { connect, type Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { AutomergeService } from '../src/AutomergeService';
import { MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES } from '../src/CONSTANTS';
import type { WebSocketWithIsAlive } from '../src/adapters/websocket.adapter';
import type { TWidgetCollaborativeStateIdentity } from '../src/types/widget-state.types';
// @ts-ignore - internal module
import { decode, encode } from '@automerge/automerge-repo/helpers/cbor.js';

const TENANT: TTenantContext = Object.freeze({
  orgId: '11111111-1111-4111-8111-111111111111',
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cellId: 'cell-test',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['canvas:write']),
  requestId: 'widget-state-sync-containment',
  canvasId: '22222222-2222-4222-8222-222222222222',
});

const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';
const DEFINITION_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = '55555555-5555-4555-8555-555555555555';
const DOCUMENT_ROW_ID = '66666666-6666-4666-8666-666666666666';
const CANVAS_DOCUMENT_ROW_ID = '77777777-7777-4777-8777-777777777777';

type TWidgetStateDocument = {
  schemaVersion: 1;
  identity: TWidgetCollaborativeStateIdentity;
  state: Record<string, unknown>;
};

type TTestSocket = WebSocketWithIsAlive & {
  sent: ArrayBuffer[];
  terminateCount: number;
};

type TPeer = {
  id: string;
  serverId: string;
  socket: TTestSocket;
  doc: Automerge.Doc<TWidgetStateDocument>;
  syncState: Automerge.SyncState;
  responseCursor: number;
};

const databases: Database[] = [];
const services: AutomergeService[] = [];

afterEach(async () => {
  while (services.length > 0) await services.pop()?.stop();
  while (databases.length > 0) await databases.pop()?.close();
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
  while (Date.now() - startedAt < (args.timeoutMs ?? 3_000)) {
    if (await args.predicate()) return;
    await sleep(20);
  }
  throw new Error(args.message);
}

function createSocket(): TTestSocket {
  return {
    data: { isAlive: false },
    readyState: WebSocket.OPEN,
    sent: [],
    terminateCount: 0,
    ping() {},
    close() {
      this.readyState = WebSocket.CLOSED;
    },
    send(data) {
      this.sent.push(data);
      return data.byteLength;
    },
    terminate() {
      this.terminateCount += 1;
      this.readyState = WebSocket.CLOSED;
    },
  };
}

function deterministicIncompressibleText(length: number): string {
  let seed = 0x12345678;
  const chunks: string[] = [];
  for (let offset = 0; offset < length; offset += 8_192) {
    const codes: number[] = [];
    const chunkLength = Math.min(8_192, length - offset);
    for (let index = 0; index < chunkLength; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      codes.push(33 + (seed % 90));
    }
    chunks.push(String.fromCharCode(...codes));
  }
  return chunks.join('');
}

async function createDatabase(): Promise<Database> {
  const database = await connect(':memory:');
  databases.push(database);
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
      content_version INTEGER NOT NULL DEFAULT 0,
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

async function createHarness(): Promise<Readonly<{
  database: Database;
  service: AutomergeService;
  automergeUrl: string;
  documentKey: string;
  initialDocument: Automerge.Doc<TWidgetStateDocument>;
  serverHandle: Awaited<ReturnType<AutomergeService['findDocument<TWidgetStateDocument>']>>;
}>> {
  const database = await createDatabase();
  const automergeUrl = generateAutomergeUrl();
  const documentKey = parseAutomergeUrl(automergeUrl).documentId;
  const identity: TWidgetCollaborativeStateIdentity = Object.freeze({
    orgId: TENANT.orgId,
    canvasId: TENANT.canvasId!,
    elementId: 'widget-state-element',
    widgetInstanceId: INSTANCE_ID,
    definitionId: DEFINITION_ID,
    revisionId: REVISION_ID,
    stateDocumentId: automergeUrl,
  });
  const initialDocument = Automerge.from<TWidgetStateDocument>({
    schemaVersion: 1,
    identity,
    state: {},
  });
  await (await database.prepare(`
    INSERT INTO canvas_members (org_id, canvas_id, account_id) VALUES (?, ?, ?)
  `)).run(TENANT.orgId, TENANT.canvasId!, TENANT.accountId);
  await (await database.prepare(`
    INSERT INTO widget_instances (
      org_id, id, canvas_id, element_id, definition_id, revision_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'active')
  `)).run(
    TENANT.orgId,
    INSTANCE_ID,
    TENANT.canvasId!,
    identity.elementId,
    DEFINITION_ID,
    REVISION_ID,
  );
  await (await database.prepare(`
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url, content_version
    ) VALUES (?, ?, ?, NULL, ?, 0)
  `)).run(
    TENANT.orgId,
    CANVAS_DOCUMENT_ROW_ID,
    TENANT.canvasId!,
    generateAutomergeUrl(),
  );
  await (await database.prepare(`
    INSERT INTO widget_instance_projection_heads (org_id, canvas_id, source_sequence)
    VALUES (?, ?, 0)
  `)).run(TENANT.orgId, TENANT.canvasId!);
  await (await database.prepare(`
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url, content_version
    ) VALUES (?, ?, NULL, ?, ?, 1)
  `)).run(TENANT.orgId, DOCUMENT_ROW_ID, INSTANCE_ID, automergeUrl);
  await (await database.prepare(`
    INSERT INTO collaboration_chunks (
      org_id, document_id, chunk_key, sequence, chunk_bytes, created_at_ms
    ) VALUES (?, ?, ?, 0, ?, 1)
  `)).run(
    TENANT.orgId,
    DOCUMENT_ROW_ID,
    `${documentKey}.snapshot.initial`,
    Automerge.save(initialDocument),
  );
  const service = new AutomergeService(database, {
    authorizeDocument: () => true,
    onElementCreate: () => {},
    onElementDelete: () => {},
  });
  service.start();
  services.push(service);
  const serverHandle = await service.findDocument<TWidgetStateDocument>(TENANT, automergeUrl);
  return { database, service, automergeUrl, documentKey, initialDocument, serverHandle };
}

async function connectPeer(
  service: AutomergeService,
  id: string,
  document: Automerge.Doc<TWidgetStateDocument>,
  peerMetadata: Record<string, unknown> = {},
): Promise<TPeer> {
  const socket = createSocket();
  service.openConnection(TENANT, socket);
  await service.receiveConnectionMessage(TENANT, socket, Buffer.from(encode({
    type: 'join',
    senderId: id,
    peerMetadata,
    supportedProtocolVersions: ['1'],
  })));
  const peerMessage = decode(new Uint8Array(socket.sent[0]!)) as { senderId: string };
  return {
    id,
    serverId: peerMessage.senderId,
    socket,
    doc: Automerge.clone(document),
    syncState: Automerge.initSyncState(),
    responseCursor: socket.sent.length,
  };
}

async function sendPeerSyncMessage(
  service: AutomergeService,
  documentKey: string,
  peer: TPeer,
  syncMessage: Uint8Array,
): Promise<void> {
  await service.receiveConnectionMessage(TENANT, peer.socket, Buffer.from(encode({
    type: 'sync',
    senderId: peer.id,
    targetId: peer.serverId,
    documentId: documentKey,
    data: syncMessage,
  })));
}

function receiveServerMessages(peer: TPeer): number {
  let received = 0;
  for (const encoded of peer.socket.sent.slice(peer.responseCursor)) {
    const message = decode(new Uint8Array(encoded)) as {
      type: string;
      data?: Uint8Array;
    };
    if (
      (message.type === 'sync' || message.type === 'request')
      && message.data instanceof Uint8Array
    ) {
      [peer.doc, peer.syncState] = Automerge.receiveSyncMessage(
        peer.doc,
        peer.syncState,
        message.data,
      );
      received += 1;
    }
  }
  peer.responseCursor = peer.socket.sent.length;
  return received;
}

async function synchronizePeer(
  service: AutomergeService,
  documentKey: string,
  peer: TPeer,
): Promise<number> {
  let maximumChangeCount = 0;
  for (let round = 0; round < 16; round += 1) {
    const [syncState, syncMessage] = Automerge.generateSyncMessage(peer.doc, peer.syncState);
    peer.syncState = syncState;
    let sent = false;
    if (syncMessage !== null) {
      maximumChangeCount = Math.max(
        maximumChangeCount,
        Automerge.decodeSyncMessage(syncMessage).changes.length,
      );
      await sendPeerSyncMessage(service, documentKey, peer, syncMessage);
      sent = true;
      if (peer.socket.terminateCount > 0) return maximumChangeCount;
    }
    await sleep(10);
    const received = receiveServerMessages(peer);
    if (!sent && received === 0) return maximumChangeCount;
  }
  throw new Error(`Peer ${peer.id} did not finish Automerge synchronization.`);
}

async function durableState(database: Database): Promise<Readonly<{
  version: number;
  chunkCount: number;
  document: Automerge.Doc<TWidgetStateDocument>;
}>> {
  const row = await (await database.prepare(`
    SELECT content_version FROM collaboration_documents
    WHERE org_id = ? AND id = ?
  `)).get(TENANT.orgId, DOCUMENT_ROW_ID) as { content_version: number };
  const chunks = await (await database.prepare(`
    SELECT chunk_bytes FROM collaboration_chunks
    WHERE org_id = ? AND document_id = ?
    ORDER BY sequence ASC
  `)).all(TENANT.orgId, DOCUMENT_ROW_ID) as Array<{ chunk_bytes: Uint8Array }>;
  let document = Automerge.init<TWidgetStateDocument>();
  for (const chunk of chunks) document = Automerge.loadIncremental(document, chunk.chunk_bytes);
  return {
    version: Number(row.content_version),
    chunkCount: chunks.length,
    document,
  };
}

function heads(document: Automerge.Doc<unknown>): string[] {
  return [...Automerge.getHeads(document)].sort();
}

function plainState(document: Automerge.Doc<TWidgetStateDocument>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(document.state)) as Record<string, unknown>;
}

describe('widget-state remote sync containment', () => {
  test('ignores forged persistent peer metadata and converges after an ephemeral reconnect', async () => {
    const harness = await createHarness();
    const first = await connectPeer(
      harness.service,
      'forged-storage-peer',
      harness.initialDocument,
      { isEphemeral: false, storageId: 'forged-storage-a' },
    );
    first.doc = Automerge.change(first.doc, (draft) => {
      draft.state.acceptedBeforeReconnect = true;
    });
    await synchronizePeer(harness.service, harness.documentKey, first);
    await waitFor({
      message: 'Timed out waiting for the pre-reconnect state to persist.',
      predicate: async () => {
        const row = await (await harness.database.prepare(`
          SELECT content_version
          FROM collaboration_documents
          WHERE org_id = ? AND id = ?
        `)).get(TENANT.orgId, DOCUMENT_ROW_ID) as { content_version: number };
        return Number(row.content_version) > 1;
      },
    });

    harness.service.closeConnection(TENANT, first.socket, 1000, 'ephemeral-reconnect');
    const reconnected = await connectPeer(
      harness.service,
      'forged-storage-peer',
      harness.initialDocument,
      { isEphemeral: false, storageId: 'forged-storage-b' },
    );
    await synchronizePeer(harness.service, harness.documentKey, reconnected);
    expect(plainState(reconnected.doc)).toEqual({ acceptedBeforeReconnect: true });
    expect(reconnected.socket.terminateCount).toBe(0);

    await sleep(150);
    const chunkRows = await (await harness.database.prepare(`
      SELECT chunk_key
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ?
      ORDER BY sequence ASC
    `)).all(TENANT.orgId, DOCUMENT_ROW_ID) as Array<{ chunk_key: string }>;
    expect(chunkRows.some(({ chunk_key: chunkKey }) => (
      chunkKey.startsWith(`${harness.documentKey}.sync-state.`)
    ))).toBe(false);

    Automerge.free(first.doc);
    Automerge.free(reconnected.doc);
    Automerge.free(harness.initialDocument);
  }, 30_000);

  test('rejects hidden oversized history and bundled rate abuse before Repo mutation or rebroadcast', async () => {
    const harness = await createHarness();
    const baselineHeads = heads(harness.serverHandle.doc());
    const observer = await connectPeer(harness.service, 'observer-peer', harness.initialDocument);
    await synchronizePeer(harness.service, harness.documentKey, observer);
    await sleep(150);
    receiveServerMessages(observer);
    const observerMessageCount = observer.socket.sent.length;

    const oversized = await connectPeer(harness.service, 'oversized-peer', harness.initialDocument);
    const transient = deterministicIncompressibleText(
      MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES + 32 * 1024,
    );
    oversized.doc = Automerge.change(oversized.doc, (draft) => {
      draft.state.transient = transient;
      delete draft.state.transient;
    });
    expect(Automerge.toJS(oversized.doc).state).toEqual({});
    expect(Automerge.getLastLocalChange(oversized.doc)?.byteLength).toBeGreaterThan(
      MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES,
    );
    await synchronizePeer(harness.service, harness.documentKey, oversized);
    expect(oversized.socket.terminateCount).toBe(1);
    await sleep(150);

    let persisted = await durableState(harness.database);
    expect(heads(harness.serverHandle.doc())).toEqual(baselineHeads);
    expect(heads(observer.doc)).toEqual(baselineHeads);
    expect(observer.socket.sent).toHaveLength(observerMessageCount);
    expect(heads(persisted.document)).toEqual(baselineHeads);
    expect({ version: persisted.version, chunks: persisted.chunkCount }).toEqual({
      version: 1,
      chunks: 1,
    });
    Automerge.free(persisted.document);

    const rateAbuse = await connectPeer(harness.service, 'rate-abuse-peer', harness.initialDocument);
    await synchronizePeer(harness.service, harness.documentKey, rateAbuse);
    for (let index = 1; index <= 21; index += 1) {
      rateAbuse.doc = Automerge.change(rateAbuse.doc, (draft) => {
        draft.state.count = index;
      });
    }
    const bundledMessage = Automerge.encodeSyncMessage({
      heads: Automerge.getHeads(rateAbuse.doc),
      need: [],
      have: [],
      changes: Automerge.getChanges(harness.initialDocument, rateAbuse.doc),
    });
    expect(Automerge.decodeSyncMessage(bundledMessage).changes.length).toBe(21);
    await sendPeerSyncMessage(
      harness.service,
      harness.documentKey,
      rateAbuse,
      bundledMessage,
    );
    expect(rateAbuse.socket.terminateCount).toBe(1);
    await sleep(150);

    persisted = await durableState(harness.database);
    expect(heads(harness.serverHandle.doc())).toEqual(baselineHeads);
    expect(heads(observer.doc)).toEqual(baselineHeads);
    expect(observer.socket.sent).toHaveLength(observerMessageCount);
    expect(heads(persisted.document)).toEqual(baselineHeads);
    expect({ version: persisted.version, chunks: persisted.chunkCount }).toEqual({
      version: 1,
      chunks: 1,
    });
    Automerge.free(persisted.document);

    const valid = await connectPeer(harness.service, 'valid-peer', harness.initialDocument);
    valid.doc = Automerge.change(valid.doc, (draft) => {
      draft.state.accepted = true;
    });
    await synchronizePeer(harness.service, harness.documentKey, valid);
    expect(valid.socket.terminateCount).toBe(0);
    await waitFor({
      message: 'Timed out waiting for the accepted remote widget state to persist.',
      predicate: async () => (await durableState(harness.database)).version > 1,
    });
    await waitFor({
      message: 'Timed out waiting for the accepted remote widget state to reach the observer.',
      predicate: () => observer.socket.sent.length > observerMessageCount,
    });
    await synchronizePeer(harness.service, harness.documentKey, observer);
    persisted = await durableState(harness.database);

    expect(plainState(harness.serverHandle.doc())).toEqual({ accepted: true });
    expect(plainState(observer.doc)).toEqual({ accepted: true });
    expect(plainState(persisted.document)).toEqual({ accepted: true });
    expect(heads(observer.doc)).toEqual(heads(harness.serverHandle.doc()));
    expect(heads(persisted.document)).toEqual(heads(harness.serverHandle.doc()));

    Automerge.free(persisted.document);
    Automerge.free(observer.doc);
    Automerge.free(oversized.doc);
    Automerge.free(rateAbuse.doc);
    Automerge.free(valid.doc);
    Automerge.free(harness.initialDocument);
  }, 30_000);
});
