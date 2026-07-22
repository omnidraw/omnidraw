import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import * as Automerge from '@automerge/automerge';
import { generateAutomergeUrl, parseAutomergeUrl, type PeerId } from '@automerge/automerge-repo';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { BunWSServerAdapter, type WebSocketWithIsAlive } from '../src/adapters/websocket.adapter';
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

const TENANT_A_VIEWER: TTenantContext = Object.freeze({
  ...TENANT_A,
  accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  roles: Object.freeze(['viewer']),
  capabilities: Object.freeze([]),
  requestId: 'request-a-viewer',
});

type TMockSocket = WebSocketWithIsAlive & {
  sent: ArrayBuffer[];
  sendStatus: number;
  pingCount: number;
  closeCount: number;
  terminateCount: number;
};

function createSocket(): TMockSocket {
  return {
    data: { isAlive: false },
    readyState: WebSocket.OPEN,
    sent: [],
    sendStatus: 1,
    pingCount: 0,
    closeCount: 0,
    terminateCount: 0,
    ping() {
      this.pingCount += 1;
    },
    close() {
      this.closeCount += 1;
      this.readyState = WebSocket.CLOSED;
    },
    send(data: ArrayBuffer) {
      if (this.sendStatus > 0) this.sent.push(data);
      return this.sendStatus;
    },
    terminate() {
      this.terminateCount += 1;
      this.readyState = WebSocket.CLOSED;
    },
  };
}

function encodeClientMessage(message: Record<string, unknown>): Uint8Array {
  return encode(message as never);
}

function decodeLastMessage(socket: TMockSocket): Record<string, unknown> {
  const message = socket.sent.at(-1);
  if (message === undefined) throw new Error('Expected socket message');
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

function createSyncMessageWithChanges(): Uint8Array {
  let document = Automerge.change(Automerge.init<{ value?: number }>(), (draft) => {
    draft.value = 1;
  });
  let syncState = Automerge.initSyncState();
  const peerMessage = createReadOnlySyncMessage();
  [document, syncState] = Automerge.receiveSyncMessage(document, syncState, peerMessage);
  const [, message] = Automerge.generateSyncMessage(document, syncState);
  if (message === null || Automerge.decodeSyncMessage(message).changes.length === 0) {
    throw new Error('Expected an Automerge sync message containing changes.');
  }
  return message;
}

function createAdapter(
  admitDocument: (tenantContext: TTenantContext, automergeUrl: string) => Promise<boolean> = async () => true,
): BunWSServerAdapter {
  return new BunWSServerAdapter({
    admitWidgetStateSync: async () => true,
    admitDocument: async (tenantContext, automergeUrl) => (
      await admitDocument(tenantContext, automergeUrl)
        ? Object.freeze({
          access: Object.freeze({
            kind: 'canvas' as const,
            orgId: tenantContext.orgId,
            canvasId: tenantContext.canvasId ?? 'canvas-test',
          }),
          canWrite: true,
        })
        : null
    ),
  });
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

describe('BunWSServerAdapter', () => {
  const adapters: BunWSServerAdapter[] = [];

  afterEach(() => {
    while (adapters.length > 0) adapters.pop()?.disconnect();
  });

  test('becomes ready after connect', async () => {
    const adapter = createAdapter();
    adapters.push(adapter);

    expect(adapter.isReady()).toBe(false);
    adapter.connect('server-1' as PeerId);
    await adapter.whenReady();
    expect(adapter.isReady()).toBe(true);
  });

  test('namespaces identical peer ids and replaces untrusted browser persistence metadata', async () => {
    const adapter = createAdapter();
    adapters.push(adapter);
    adapter.connect('server-1' as PeerId, { role: 'server' });

    const socketA = createSocket();
    const socketB = createSocket();
    adapter.open(TENANT_A, socketA);
    adapter.open(TENANT_B, socketB);
    const peerCandidates: Array<{ peerId: PeerId; peerMetadata: Record<string, unknown> }> = [];
    adapter.on('peer-candidate', (event) => {
      peerCandidates.push(event as { peerId: PeerId; peerMetadata: Record<string, unknown> });
    });

    const join = encodeClientMessage({
      type: 'join',
      senderId: 'same-client-id',
      peerMetadata: {
        isEphemeral: false,
        storageId: 'forged-browser-storage',
        role: 'client',
      },
      supportedProtocolVersions: ['1'],
    });
    await adapter.receiveMessage(TENANT_A, join, socketA);
    await adapter.receiveMessage(TENANT_B, join, socketB);

    expect(peerCandidates).toHaveLength(2);
    expect(peerCandidates[0]?.peerId).not.toBe(peerCandidates[1]?.peerId);
    expect(peerCandidates.map(({ peerMetadata }) => peerMetadata)).toEqual([
      { isEphemeral: true },
      { isEphemeral: true },
    ]);
    expect(decodeLastMessage(socketA).targetId).toBe('same-client-id');
    expect(decodeLastMessage(socketB).targetId).toBe('same-client-id');
    expect(adapter.getTenantMetrics(TENANT_A).connectedPeers).toBe(1);
    expect(adapter.getTenantMetrics(TENANT_B).connectedPeers).toBe(1);
  });

  test('rejects oversized peer ids and a second join on the same socket', async () => {
    const adapter = createAdapter();
    adapters.push(adapter);
    adapter.connect('server-join-boundary' as PeerId);
    const candidates: PeerId[] = [];
    const disconnected: PeerId[] = [];
    adapter.on('peer-candidate', (event) => {
      candidates.push((event as { peerId: PeerId }).peerId);
    });
    adapter.on('peer-disconnected', (event) => {
      disconnected.push((event as { peerId: PeerId }).peerId);
    });

    const oversizedSocket = createSocket();
    adapter.open(TENANT_A, oversizedSocket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'x'.repeat(257),
      peerMetadata: { storageId: 'ignored' },
      supportedProtocolVersions: ['1'],
    }), oversizedSocket);
    expect(oversizedSocket.terminateCount).toBe(1);
    expect(candidates).toEqual([]);

    const duplicateSocket = createSocket();
    adapter.open(TENANT_A, duplicateSocket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'first-peer-id',
      supportedProtocolVersions: ['1'],
    }), duplicateSocket);
    const admittedPeerId = candidates[0];
    if (admittedPeerId === undefined) throw new Error('Expected an admitted peer id.');
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'replacement-peer-id',
      supportedProtocolVersions: ['1'],
    }), duplicateSocket);

    expect(duplicateSocket.terminateCount).toBe(1);
    expect(candidates).toEqual([admittedPeerId]);
    expect(disconnected).toEqual([admittedPeerId]);
    expect(adapter.getTenantMetrics(TENANT_A).connectedPeers).toBe(0);
  });

  test('rejects malformed protocol advertisements before registering a peer', async () => {
    let documentAdmissionCount = 0;
    const adapter = createAdapter(async () => {
      documentAdmissionCount += 1;
      return true;
    });
    adapters.push(adapter);
    adapter.connect('server-protocol-validation' as PeerId);
    const candidates: PeerId[] = [];
    const disconnected: PeerId[] = [];
    const messages: Array<Record<string, unknown>> = [];
    adapter.on('peer-candidate', (event) => {
      candidates.push((event as { peerId: PeerId }).peerId);
    });
    adapter.on('peer-disconnected', (event) => {
      disconnected.push((event as { peerId: PeerId }).peerId);
    });
    adapter.on('message', (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    });

    const malformedAdvertisements: unknown[] = [
      '1',
      { version: '1' },
      Array.from({ length: 17 }, () => '1'),
      ['1', 2],
      ['x'.repeat(17)],
    ];
    for (const [index, supportedProtocolVersions] of malformedAdvertisements.entries()) {
      const socket = createSocket();
      const senderId = `malformed-protocol-${index}`;
      adapter.open(TENANT_A, socket);
      await adapter.receiveMessage(TENANT_A, encodeClientMessage({
        type: 'join',
        senderId,
        supportedProtocolVersions,
      }), socket);

      expect(socket.terminateCount).toBe(1);
      expect(decodeLastMessage(socket)).toMatchObject({
        type: 'error',
        targetId: senderId,
        message: 'unsupported protocol version',
      });
      expect(adapter.getTenantMetrics(TENANT_A)).toEqual({
        connectedPeers: 0,
        admittedPeerDocuments: 0,
      });

      await adapter.receiveMessage(TENANT_A, encodeClientMessage({
        type: 'request',
        senderId,
        targetId: 'server-protocol-validation',
        documentId: 'must-not-be-admitted',
        data: createReadOnlySyncMessage(),
      }), socket);
    }

    expect(candidates).toEqual([]);
    expect(disconnected).toEqual([]);
    expect(messages).toEqual([]);
    expect(documentAdmissionCount).toBe(0);
  });

  test('returns the same denial for a known foreign document and an unknown document', async () => {
    const adapter = createAdapter(async (tenantContext, automergeUrl) => (
      tenantContext.orgId === TENANT_A.orgId && automergeUrl === 'automerge:owned-doc'
    ));
    adapters.push(adapter);
    adapter.connect('server-admission' as PeerId);

    const requestDenied = async (documentId: string): Promise<Record<string, unknown>> => {
      const socket = createSocket();
      adapter.open(TENANT_B, socket);
      await adapter.receiveMessage(TENANT_B, encodeClientMessage({
        type: 'join',
        senderId: 'client-b',
        supportedProtocolVersions: ['1'],
      }), socket);
      await adapter.receiveMessage(TENANT_B, encodeClientMessage({
        type: 'request',
        senderId: 'client-b',
        targetId: 'server-admission',
        documentId,
        data: new Uint8Array([1]),
      }), socket);
      expect(socket.terminateCount).toBe(1);
      return decodeLastMessage(socket);
    };

    const foreign = await requestDenied('owned-doc');
    const missing = await requestDenied('missing-doc');
    expect(foreign.type).toBe('error');
    expect(foreign.message).toBe('Automerge document is unavailable.');
    expect(missing.message).toBe(foreign.message);
  });

  test('admits an owned document before emitting its network message', async () => {
    const adapter = createAdapter(async (tenantContext, automergeUrl) => (
      tenantContext.orgId === TENANT_A.orgId && automergeUrl === 'automerge:owned-doc'
    ));
    adapters.push(adapter);
    adapter.connect('server-owned' as PeerId);
    const socket = createSocket();
    adapter.open(TENANT_A, socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'client-a',
      supportedProtocolVersions: ['1'],
    }), socket);
    const messages: Array<Record<string, unknown>> = [];
    adapter.on('message', (message) => messages.push(message as unknown as Record<string, unknown>));

    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'request',
      senderId: 'client-a',
      targetId: 'server-owned',
      documentId: 'owned-doc',
      data: new Uint8Array([1]),
    }), socket);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.senderId).not.toBe('client-a');
    expect(adapter.getTenantMetrics(TENANT_A).admittedPeerDocuments).toBe(1);
    expect(socket.terminateCount).toBe(0);
  });

  test('allows viewer sync handshakes but rejects viewer changes while editors may change the canvas', async () => {
    const automergeUrl = generateAutomergeUrl();
    const documentId = parseAutomergeUrl(automergeUrl).documentId;
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async (tenantContext, requestedUrl) => (
        requestedUrl === automergeUrl
          ? {
            access: {
              kind: 'canvas',
              orgId: tenantContext.orgId,
              canvasId: 'canvas-role-boundary',
            },
            canWrite: tenantContext.accountId !== TENANT_A_VIEWER.accountId,
          }
          : null
      ),
    });
    adapters.push(adapter);
    adapter.connect('server-role-boundary' as PeerId);
    const emitted: Array<Record<string, unknown>> = [];
    adapter.on('message', (message) => emitted.push(message as unknown as Record<string, unknown>));

    const viewerSocket = createSocket();
    adapter.open(TENANT_A_VIEWER, viewerSocket);
    await adapter.receiveMessage(TENANT_A_VIEWER, encodeClientMessage({
      type: 'join',
      senderId: 'viewer-peer',
      supportedProtocolVersions: ['1'],
    }), viewerSocket);
    await adapter.receiveMessage(TENANT_A_VIEWER, encodeClientMessage({
      type: 'sync',
      senderId: 'viewer-peer',
      targetId: 'server-role-boundary',
      documentId,
      data: createReadOnlySyncMessage(),
    }), viewerSocket);

    expect(emitted).toHaveLength(1);
    expect(viewerSocket.terminateCount).toBe(0);

    const changeMessage = createSyncMessageWithChanges();
    await adapter.receiveMessage(TENANT_A_VIEWER, encodeClientMessage({
      type: 'sync',
      senderId: 'viewer-peer',
      targetId: 'server-role-boundary',
      documentId,
      data: changeMessage,
    }), viewerSocket);

    expect(emitted).toHaveLength(1);
    expect(viewerSocket.terminateCount).toBe(1);
    expect(decodeLastMessage(viewerSocket)).toMatchObject({
      type: 'error',
      message: 'Automerge document is unavailable.',
    });

    const editorSocket = createSocket();
    adapter.open(TENANT_A, editorSocket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'editor-peer',
      supportedProtocolVersions: ['1'],
    }), editorSocket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'sync',
      senderId: 'editor-peer',
      targetId: 'server-role-boundary',
      documentId,
      data: changeMessage,
    }), editorSocket);

    expect(emitted).toHaveLength(2);
    expect(editorSocket.terminateCount).toBe(0);
  });

  test('reauthorizes every outbound document send and drops stale access after revocation', async () => {
    const automergeUrl = generateAutomergeUrl();
    const documentId = parseAutomergeUrl(automergeUrl).documentId;
    let authorized = true;
    let releaseRevokedAdmission!: () => void;
    let markRevokedAdmissionStarted!: () => void;
    const revokedAdmissionStarted = new Promise<void>((resolve) => {
      markRevokedAdmissionStarted = resolve;
    });
    const revokedAdmissionGate = new Promise<void>((resolve) => {
      releaseRevokedAdmission = resolve;
    });
    const peerChanges: number[] = [];
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async (tenantContext, requestedUrl) => {
        if (requestedUrl !== automergeUrl || !authorized) {
          markRevokedAdmissionStarted();
          await revokedAdmissionGate;
          return null;
        }
        return {
          access: {
            kind: 'canvas',
            orgId: tenantContext.orgId,
            canvasId: 'canvas-revocation',
          },
          canWrite: true,
        };
      },
      onDocumentPeerChange: ({ delta }) => peerChanges.push(delta),
    });
    adapters.push(adapter);
    adapter.connect('server-revocation' as PeerId);
    const socket = createSocket();
    let internalPeerId: PeerId | undefined;
    adapter.on('peer-candidate', (event) => {
      internalPeerId = (event as { peerId: PeerId }).peerId;
    });
    adapter.open(TENANT_A, socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'revoked-peer',
      supportedProtocolVersions: ['1'],
    }), socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'request',
      senderId: 'revoked-peer',
      targetId: 'server-revocation',
      documentId,
      data: createReadOnlySyncMessage(),
    }), socket);
    if (internalPeerId === undefined) throw new Error('Expected an internal peer id.');
    const sentBeforeRevocation = socket.sent.length;
    expect(peerChanges).toEqual([1]);

    authorized = false;
    adapter.send({
      type: 'sync',
      senderId: 'server-revocation' as PeerId,
      targetId: internalPeerId,
      documentId,
      data: createSyncMessageWithChanges(),
    });
    await revokedAdmissionStarted;
    expect(socket.sent).toHaveLength(sentBeforeRevocation);
    releaseRevokedAdmission();
    for (let attempt = 0; attempt < 20 && peerChanges.length < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect(socket.sent).toHaveLength(sentBeforeRevocation);
    expect(socket.terminateCount).toBe(0);
    expect(peerChanges).toEqual([1, -1]);
    expect(adapter.getTenantMetrics(TENANT_A).admittedPeerDocuments).toBe(0);
    await expect(adapter.isPeerAuthorizedForDocument(internalPeerId, documentId))
      .resolves.toBe(false);
  });

  test('bounds encoded outbound frames while document authorization is stalled', async () => {
    const automergeUrl = generateAutomergeUrl();
    const documentId = parseAutomergeUrl(automergeUrl).documentId;
    let stallAuthorization = false;
    let releaseAuthorization!: () => void;
    let markAuthorizationStarted!: () => void;
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async (tenantContext) => {
        if (stallAuthorization) {
          markAuthorizationStarted();
          await authorizationGate;
        }
        return {
          access: {
            kind: 'canvas',
            orgId: tenantContext.orgId,
            canvasId: 'canvas-outbound-queue',
          },
          canWrite: true,
        };
      },
      maxPendingDocumentMessages: 2,
      maxPendingDocumentBytes: 1024 * 1024,
      maxPendingConnectionMessages: 2,
      maxPendingConnectionBytes: 1024 * 1024,
      maxPendingGlobalMessages: 2,
      maxPendingGlobalBytes: 1024 * 1024,
    });
    adapters.push(adapter);
    adapter.connect('server-outbound-queue' as PeerId);
    const socket = createSocket();
    let internalPeerId: PeerId | undefined;
    adapter.on('peer-candidate', (event) => {
      internalPeerId = (event as { peerId: PeerId }).peerId;
    });
    adapter.open(TENANT_A, socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'outbound-queue-peer',
      supportedProtocolVersions: ['1'],
    }), socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'request',
      senderId: 'outbound-queue-peer',
      targetId: 'server-outbound-queue',
      documentId,
      data: createReadOnlySyncMessage(),
    }), socket);
    if (internalPeerId === undefined) throw new Error('Expected an internal peer id.');
    const outboundMessage = {
      type: 'sync' as const,
      senderId: 'server-outbound-queue' as PeerId,
      targetId: internalPeerId,
      documentId,
      data: createSyncMessageWithChanges(),
    };

    stallAuthorization = true;
    adapter.send(outboundMessage);
    await authorizationStarted;
    adapter.send(outboundMessage);
    adapter.send(outboundMessage);

    const internals = adapter as unknown as {
      documentMessageTails: Map<string, Promise<void>>;
      pendingDocumentMessages: Map<string, { count: number; bytes: number }>;
      pendingGlobalMessages: number;
      pendingGlobalBytes: number;
    };
    expect(socket.terminateCount).toBe(1);
    expect(internals.pendingDocumentMessages.values().next().value?.count).toBe(2);
    expect(internals.pendingGlobalMessages).toBe(2);
    expect(internals.pendingGlobalBytes).toBeGreaterThan(0);

    releaseAuthorization();
    for (
      let attempt = 0;
      attempt < 50 && (
        internals.pendingGlobalMessages !== 0
        || internals.documentMessageTails.size !== 0
      );
      attempt += 1
    ) await Promise.resolve();

    expect(internals.pendingDocumentMessages.size).toBe(0);
    expect(internals.pendingGlobalMessages).toBe(0);
    expect(internals.pendingGlobalBytes).toBe(0);
    expect(internals.documentMessageTails.size).toBe(0);
  });

  test('rejects an oversized raw frame before CBOR decoding with the generic denial', async () => {
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async (tenantContext) => ({
        access: {
          kind: 'canvas',
          orgId: tenantContext.orgId,
          canvasId: 'canvas-a',
        },
        canWrite: true,
      }),
      maxFrameBytes: 256,
    });
    adapters.push(adapter);
    adapter.connect('server-frame-limit' as PeerId);
    const socket = createSocket();
    adapter.open(TENANT_A, socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'client-frame-limit',
      supportedProtocolVersions: ['1'],
    }), socket);

    await adapter.receiveMessage(TENANT_A, new Uint8Array(257), socket);

    expect(socket.terminateCount).toBe(1);
    expect(decodeLastMessage(socket)).toMatchObject({
      type: 'error',
      message: 'Automerge document is unavailable.',
    });
  });

  test('terminates malformed decoded CBOR root shapes without throwing', async () => {
    let admissionCalls = 0;
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async (tenantContext) => {
        admissionCalls += 1;
        return {
          access: {
            kind: 'canvas',
            orgId: tenantContext.orgId,
            canvasId: 'canvas-a',
          },
          canWrite: true,
        };
      },
    });
    adapters.push(adapter);
    adapter.connect('server-malformed-shape' as PeerId);

    for (const malformed of [null, 42, []]) {
      const socket = createSocket();
      adapter.open(TENANT_A, socket);

      await expect(adapter.receiveMessage(
        TENANT_A,
        encode(malformed as never),
        socket,
      )).resolves.toBeUndefined();
      expect(socket.terminateCount).toBe(1);
      expect(socket.sent).toHaveLength(0);
    }
    expect(admissionCalls).toBe(0);
  });

  test('bounds widget-state messages per connection and document without throttling canvas sync', async () => {
    const stateUrl = generateAutomergeUrl();
    const stateDocumentId = parseAutomergeUrl(stateUrl).documentId;
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async (tenantContext, automergeUrl) => (
        automergeUrl === stateUrl
          ? {
            access: {
              kind: 'widget-state',
              orgId: tenantContext.orgId,
              canvasId: 'canvas-a',
              identity: {
                orgId: tenantContext.orgId,
                canvasId: 'canvas-a',
                elementId: 'element-a',
                widgetInstanceId: 'instance-a',
                definitionId: 'definition-a',
                revisionId: 'revision-a',
                stateDocumentId: stateUrl,
              },
            },
            canWrite: true,
          }
          : {
            access: {
              kind: 'canvas',
              orgId: tenantContext.orgId,
              canvasId: 'canvas-a',
            },
            canWrite: true,
          }
      ),
      widgetStateMessageRateLimit: 2,
      widgetStateMessageRateWindowMs: 1_000,
      nowMs: () => 100,
    });
    adapters.push(adapter);
    adapter.connect('server-state-rate' as PeerId);
    const socket = createSocket();
    adapter.open(TENANT_A, socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'client-state-rate',
      supportedProtocolVersions: ['1'],
    }), socket);
    const messages: Array<Record<string, unknown>> = [];
    adapter.on('message', (message) => messages.push(message as unknown as Record<string, unknown>));
    const request = (documentId: string) => encodeClientMessage({
      type: 'request',
      senderId: 'client-state-rate',
      targetId: 'server-state-rate',
      documentId,
      data: new Uint8Array([1]),
    });

    for (let index = 0; index < 5; index += 1) {
      await adapter.receiveMessage(TENANT_A, request('canvas-document'), socket);
    }
    await adapter.receiveMessage(TENANT_A, request(stateDocumentId), socket);
    await adapter.receiveMessage(TENANT_A, request(stateDocumentId), socket);
    await adapter.receiveMessage(TENANT_A, request(stateDocumentId), socket);

    expect(messages).toHaveLength(7);
    expect(socket.terminateCount).toBe(1);
    expect(decodeLastMessage(socket)).toMatchObject({
      type: 'error',
      message: 'Automerge document is unavailable.',
    });
  });

  test('does not emit a stale frame when its preflight completes after close and reconnect', async () => {
    const stateUrl = generateAutomergeUrl();
    const documentId = parseAutomergeUrl(stateUrl).documentId;
    let resolvePreflight!: (admitted: boolean) => void;
    const preflight = new Promise<boolean>((resolve) => { resolvePreflight = resolve; });
    const peerChanges: number[] = [];
    const adapter = new BunWSServerAdapter({
      admitDocument: async (tenantContext) => ({
        access: {
          kind: 'widget-state',
          orgId: tenantContext.orgId,
          canvasId: 'canvas-a',
          identity: {
            orgId: tenantContext.orgId,
            canvasId: 'canvas-a',
            elementId: 'element-a',
            widgetInstanceId: 'instance-a',
            definitionId: 'definition-a',
            revisionId: 'revision-a',
            stateDocumentId: stateUrl,
          },
        },
        canWrite: true,
      }),
      admitWidgetStateSync: async () => preflight,
      onDocumentPeerChange: ({ delta }) => peerChanges.push(delta),
    });
    adapters.push(adapter);
    adapter.connect('server-stale-preflight' as PeerId);
    const socket = createSocket();
    adapter.open(TENANT_A, socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'client-stale-old',
      supportedProtocolVersions: ['1'],
    }), socket);
    const emitted: unknown[] = [];
    adapter.on('message', (message) => emitted.push(message));
    const stale = adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'sync',
      senderId: 'client-stale-old',
      targetId: 'server-stale-preflight',
      documentId,
      data: new Uint8Array([1]),
    }), socket);
    await Promise.resolve();
    await Promise.resolve();

    adapter.close(TENANT_A, socket, 1000, 'reconnect');
    adapter.open(TENANT_A, socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'client-stale-new',
      supportedProtocolVersions: ['1'],
    }), socket);
    resolvePreflight(true);
    await stale;

    expect(emitted).toEqual([]);
    expect(peerChanges).toEqual([]);
    expect(adapter.getTenantMetrics(TENANT_A).admittedPeerDocuments).toBe(0);
  });

  for (const delayedBoundary of ['admission', 'preflight'] as const) {
    test(`bounds queued frames before delayed ${delayedBoundary}`, async () => {
      const stateUrl = generateAutomergeUrl();
      const documentId = parseAutomergeUrl(stateUrl).documentId;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let admissionCalls = 0;
      let preflightCalls = 0;
      const adapter = new BunWSServerAdapter({
        admitDocument: async (tenantContext) => {
          admissionCalls += 1;
          if (delayedBoundary === 'admission') await gate;
          return {
            access: {
              kind: 'widget-state',
              orgId: tenantContext.orgId,
              canvasId: 'canvas-a',
              identity: {
                orgId: tenantContext.orgId,
                canvasId: 'canvas-a',
                elementId: 'element-a',
                widgetInstanceId: 'instance-a',
                definitionId: 'definition-a',
                revisionId: 'revision-a',
                stateDocumentId: stateUrl,
              },
            },
            canWrite: true,
          };
        },
        admitWidgetStateSync: async () => {
          preflightCalls += 1;
          if (delayedBoundary === 'preflight') await gate;
          return true;
        },
        maxPendingDocumentMessages: 2,
        maxPendingDocumentBytes: 1024,
        maxPendingConnectionMessages: 2,
        maxPendingConnectionBytes: 1024,
        maxPendingGlobalMessages: 2,
        maxPendingGlobalBytes: 1024,
      });
      adapters.push(adapter);
      adapter.connect(`server-delayed-${delayedBoundary}` as PeerId);
      const socket = createSocket();
      adapter.open(TENANT_A, socket);
      await adapter.receiveMessage(TENANT_A, encodeClientMessage({
        type: 'join',
        senderId: `client-delayed-${delayedBoundary}`,
        supportedProtocolVersions: ['1'],
      }), socket);
      const frame = encodeClientMessage({
        type: 'sync',
        senderId: `client-delayed-${delayedBoundary}`,
        targetId: `server-delayed-${delayedBoundary}`,
        documentId,
        data: new Uint8Array([1]),
      });
      const pending = [
        adapter.receiveMessage(TENANT_A, frame, socket),
        adapter.receiveMessage(TENANT_A, frame, socket),
      ];
      while (
        admissionCalls === 0
        || (delayedBoundary === 'preflight' && preflightCalls === 0)
      ) await Promise.resolve();
      await adapter.receiveMessage(TENANT_A, frame, socket);
      expect(socket.terminateCount).toBe(1);
      release();
      await Promise.all(pending);

      const internals = adapter as unknown as {
        pendingDocumentMessages: Map<string, unknown>;
        pendingGlobalMessages: number;
        pendingGlobalBytes: number;
      };
      expect(admissionCalls).toBe(1);
      expect(preflightCalls).toBe(delayedBoundary === 'preflight' ? 1 : 0);
      expect(internals.pendingDocumentMessages.size).toBe(0);
      expect(internals.pendingGlobalMessages).toBe(0);
      expect(internals.pendingGlobalBytes).toBe(0);
    });
  }

  test('terminates joined socket on leave message', async () => {
    const adapter = createAdapter();
    adapters.push(adapter);
    adapter.connect('server-1' as PeerId);

    const socket = createSocket();
    adapter.open(TENANT_A, socket);
    const disconnected: string[] = [];
    adapter.on('peer-disconnected', (event) => {
      disconnected.push((event as { peerId: string }).peerId);
    });

    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'join',
      senderId: 'client-1',
      supportedProtocolVersions: ['1'],
    }), socket);
    await adapter.receiveMessage(TENANT_A, encodeClientMessage({
      type: 'leave',
      senderId: 'client-1',
    }), socket);

    expect(socket.terminateCount).toBe(1);
    expect(disconnected).toHaveLength(1);
  });

  for (const sendStatus of [0, -1]) {
    test(`disconnects and releases capacity when Bun send returns ${sendStatus}`, async () => {
      const automergeUrl = generateAutomergeUrl();
      const documentId = parseAutomergeUrl(automergeUrl).documentId;
      const adapter = new BunWSServerAdapter({
        admitWidgetStateSync: async () => true,
        admitDocument: async (tenantContext) => ({
          access: {
            kind: 'canvas',
            orgId: tenantContext.orgId,
            canvasId: 'canvas-backpressure',
          },
          canWrite: true,
        }),
        maxConnections: 1,
        maxConnectionsPerOrganization: 1,
      });
      adapters.push(adapter);
      adapter.connect(`server-backpressure-${sendStatus}` as PeerId);
      const peerCandidates: PeerId[] = [];
      const disconnected: PeerId[] = [];
      adapter.on('peer-candidate', (event) => {
        peerCandidates.push((event as { peerId: PeerId }).peerId);
      });
      adapter.on('peer-disconnected', (event) => {
        disconnected.push((event as { peerId: PeerId }).peerId);
      });

      const firstSocket = createSocket();
      adapter.open(TENANT_A, firstSocket);
      await adapter.receiveMessage(TENANT_A, encodeClientMessage({
        type: 'join',
        senderId: 'backpressured-peer',
        supportedProtocolVersions: ['1'],
      }), firstSocket);
      const firstInternalPeerId = peerCandidates[0];
      if (firstInternalPeerId === undefined) throw new Error('Expected an internal peer id.');
      await adapter.receiveMessage(TENANT_A, encodeClientMessage({
        type: 'request',
        senderId: 'backpressured-peer',
        targetId: `server-backpressure-${sendStatus}`,
        documentId,
        data: createReadOnlySyncMessage(),
      }), firstSocket);

      firstSocket.sendStatus = sendStatus;
      adapter.send({
        type: 'sync',
        senderId: `server-backpressure-${sendStatus}` as PeerId,
        targetId: firstInternalPeerId,
        documentId,
        data: createSyncMessageWithChanges(),
      });
      for (let attempt = 0; attempt < 20 && firstSocket.terminateCount === 0; attempt += 1) {
        await Promise.resolve();
      }

      expect(firstSocket.terminateCount).toBe(1);
      expect(disconnected).toEqual([firstInternalPeerId]);
      expect(adapter.getTenantMetrics(TENANT_A).connectedPeers).toBe(0);

      const replacementSocket = createSocket();
      adapter.open(TENANT_A, replacementSocket);
      await adapter.receiveMessage(TENANT_A, encodeClientMessage({
        type: 'join',
        senderId: 'backpressured-peer',
        supportedProtocolVersions: ['1'],
      }), replacementSocket);

      expect(replacementSocket.terminateCount).toBe(0);
      expect(peerCandidates).toHaveLength(2);
      expect(adapter.getTenantMetrics(TENANT_A).connectedPeers).toBe(1);
    });
  }

  test('enforces the global connection ceiling and releases capacity on close', () => {
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async () => null,
      maxConnections: 2,
      maxConnectionsPerOrganization: 2,
    });
    adapters.push(adapter);
    const first = createSocket();
    const second = createSocket();
    const rejected = createSocket();
    adapter.open(TENANT_A, first);
    adapter.open(TENANT_A, second);
    adapter.open(TENANT_B, rejected);

    expect(first.data.automergeConnectionKey).toBeDefined();
    expect(second.data.automergeConnectionKey).toBeDefined();
    expect(rejected.data.automergeConnectionKey).toBeUndefined();
    expect(rejected.terminateCount).toBe(1);

    adapter.close(TENANT_A, first, 1000, 'release-capacity');
    const replacement = createSocket();
    adapter.open(TENANT_B, replacement);
    expect(replacement.data.automergeConnectionKey).toBeDefined();
    expect(replacement.terminateCount).toBe(0);
  });

  test('isolates per-organization connection ceilings and releases organization capacity', () => {
    const adapter = new BunWSServerAdapter({
      admitWidgetStateSync: async () => true,
      admitDocument: async () => null,
      maxConnections: 3,
      maxConnectionsPerOrganization: 1,
    });
    adapters.push(adapter);
    const firstOrganizationSocket = createSocket();
    const sameOrganizationRejected = createSocket();
    const otherOrganizationSocket = createSocket();
    adapter.open(TENANT_A, firstOrganizationSocket);
    adapter.open(TENANT_A, sameOrganizationRejected);
    adapter.open(TENANT_B, otherOrganizationSocket);

    expect(sameOrganizationRejected.terminateCount).toBe(1);
    expect(otherOrganizationSocket.data.automergeConnectionKey).toBeDefined();
    expect(otherOrganizationSocket.terminateCount).toBe(0);

    adapter.close(TENANT_A, firstOrganizationSocket, 1000, 'release-org-capacity');
    const sameOrganizationReplacement = createSocket();
    adapter.open(TENANT_A, sameOrganizationReplacement);
    expect(sameOrganizationReplacement.data.automergeConnectionKey).toBeDefined();
    expect(sameOrganizationReplacement.terminateCount).toBe(0);
  });

  test('replaces peers through a reconnect burst without retaining stale sockets', async () => {
    const adapter = createAdapter();
    adapters.push(adapter);
    adapter.connect('server-reconnect-baseline' as PeerId);

    const peerCount = 32;
    const reconnectCycles = 3;
    const activePeers = new Set<string>();
    const allSockets: TMockSocket[] = [];
    const latestSockets = new Map<string, TMockSocket>();
    let candidateEvents = 0;
    let disconnectedEvents = 0;
    let maxActivePeers = 0;
    adapter.on('peer-candidate', (event) => {
      const peerId = (event as { peerId: string }).peerId;
      candidateEvents += 1;
      activePeers.add(peerId);
      maxActivePeers = Math.max(maxActivePeers, activePeers.size);
    });
    adapter.on('peer-disconnected', (event) => {
      disconnectedEvents += 1;
      activePeers.delete((event as { peerId: string }).peerId);
    });

    for (let cycle = 0; cycle < reconnectCycles; cycle += 1) {
      for (let peerIndex = 0; peerIndex < peerCount; peerIndex += 1) {
        const peerId = `reconnect-client-${peerIndex}`;
        const socket = createSocket();
        allSockets.push(socket);
        latestSockets.set(peerId, socket);
        adapter.open(TENANT_A, socket);
        await adapter.receiveMessage(TENANT_A, encodeClientMessage({
          type: 'join',
          senderId: peerId,
          supportedProtocolVersions: ['1'],
        }), socket);
      }
    }

    expect(candidateEvents).toBe(peerCount * reconnectCycles);
    expect(disconnectedEvents).toBe(peerCount * (reconnectCycles - 1));
    expect(maxActivePeers).toBe(peerCount);
    expect(activePeers.size).toBe(peerCount);
    expect(allSockets.reduce((sum, socket) => sum + socket.terminateCount, 0))
      .toBe(peerCount * (reconnectCycles - 1));
    expect(allSockets.reduce((sum, socket) => sum + socket.sent.length, 0))
      .toBe(peerCount * reconnectCycles);

    for (const [peerId, socket] of latestSockets) {
      await adapter.receiveMessage(TENANT_A, encodeClientMessage({ type: 'leave', senderId: peerId }), socket);
    }

    expect(activePeers.size).toBe(0);
    expect(disconnectedEvents).toBe(peerCount * reconnectCycles);
    expect(adapter.getTenantMetrics(TENANT_A).connectedPeers).toBe(0);
  });
});
