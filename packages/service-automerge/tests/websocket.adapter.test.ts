import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { PeerId } from '@automerge/automerge-repo';
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

type TMockSocket = WebSocketWithIsAlive & {
  sent: ArrayBuffer[];
  pingCount: number;
  closeCount: number;
  terminateCount: number;
};

function createSocket(): TMockSocket {
  return {
    data: { isAlive: false },
    readyState: WebSocket.OPEN,
    sent: [],
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
      this.sent.push(data);
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

function createAdapter(
  admitDocument: (tenantContext: TTenantContext, automergeUrl: string) => Promise<boolean> = async () => true,
): BunWSServerAdapter {
  return new BunWSServerAdapter({ admitDocument });
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

  test('namespaces identical peer ids by organization while preserving the public protocol id', async () => {
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
      peerMetadata: { role: 'client' },
      supportedProtocolVersions: ['1'],
    });
    await adapter.receiveMessage(TENANT_A, join, socketA);
    await adapter.receiveMessage(TENANT_B, join, socketB);

    expect(peerCandidates).toHaveLength(2);
    expect(peerCandidates[0]?.peerId).not.toBe(peerCandidates[1]?.peerId);
    expect(peerCandidates.map(({ peerMetadata }) => peerMetadata)).toEqual([
      { role: 'client' },
      { role: 'client' },
    ]);
    expect(decodeLastMessage(socketA).targetId).toBe('same-client-id');
    expect(decodeLastMessage(socketB).targetId).toBe('same-client-id');
    expect(adapter.getTenantMetrics(TENANT_A).connectedPeers).toBe(1);
    expect(adapter.getTenantMetrics(TENANT_B).connectedPeers).toBe(1);
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
