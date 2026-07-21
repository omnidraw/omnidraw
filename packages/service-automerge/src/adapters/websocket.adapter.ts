import {
  NetworkAdapter,
  type PeerId,
  type PeerMetadata,
} from '@automerge/automerge-repo';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import type {
  FromClientMessage,
  FromServerMessage,
} from '@automerge/automerge-repo-network-websocket';
import { AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE } from '../CONSTANTS';
import {
  fnAutomergeConnectionScopeKey,
  fnAutomergeDocumentKeyFromUrl,
  fnAutomergePeerScopeKey,
  fnAutomergeUrlFromDocumentKey,
} from '../core/fn.automerge-document';

// @ts-ignore - internal module
import { decode, encode } from '@automerge/automerge-repo/helpers/cbor.js';

export type WebSocketWithIsAlive = {
  data: {
    isAlive: boolean;
    automergeConnectionKey?: string;
  };
  readyState: number;
  ping(): void;
  close(): void;
  send(data: ArrayBuffer): void;
  terminate(): void;
};

export type TAutomergePeerDocumentEvent = Readonly<{
  tenantContext: TTenantContext;
  automergeUrl: string;
  delta: 1 | -1;
}>;

export type TBunWSServerAdapterOptions = Readonly<{
  admitDocument: (tenantContext: TTenantContext, automergeUrl: string) => Promise<boolean>;
  onDocumentPeerChange?: (event: TAutomergePeerDocumentEvent) => void;
  onDocumentDenied?: (tenantContext: TTenantContext) => void;
}>;

export type TAutomergeWebSocketTenantMetrics = Readonly<{
  connectedPeers: number;
  admittedPeerDocuments: number;
}>;

type TProtocolVersion = '1';
const PROTOCOL_V1: TProtocolVersion = '1';

type TConnection = {
  key: string;
  tenantContext: TTenantContext;
  socket: WebSocketWithIsAlive;
  publicPeerId?: PeerId;
  internalPeerId?: PeerId;
  documentUrls: Set<string>;
};

function isJoinMessage(message: FromClientMessage): message is FromClientMessage & { type: 'join' } {
  return message.type === 'join';
}

function isLeaveMessage(message: FromClientMessage): message is FromClientMessage & { type: 'leave' } {
  return message.type === 'leave';
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

export class BunWSServerAdapter extends NetworkAdapter {
  private readonly options: TBunWSServerAdapterOptions;
  private readonly connections = new Map<string, TConnection>();
  private readonly connectionKeyByInternalPeer = new Map<string, string>();
  private keepAliveInterval = 5000;
  private keepAliveId: Timer | undefined;
  private connectionSequence = 0;
  private _isReady = false;
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;

  constructor(options: TBunWSServerAdapterOptions) {
    super();
    this.options = options;
    this._readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  isReady(): boolean {
    return this._isReady;
  }

  whenReady(): Promise<void> {
    return this._readyPromise;
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    if (!this._isReady) {
      this._isReady = true;
      this._resolveReady();
    }

    if (this.keepAliveId) clearInterval(this.keepAliveId);
    this.keepAliveId = setInterval(() => {
      for (const connection of this.connections.values()) {
        const { socket } = connection;
        if (socket.data.isAlive) {
          socket.data.isAlive = false;
          socket.ping();
        } else {
          this.terminateConnection(connection);
        }
      }
    }, this.keepAliveInterval);
  }

  disconnect(): void {
    clearInterval(this.keepAliveId);
    for (const connection of [...this.connections.values()]) {
      this.terminateConnection(connection);
    }
  }

  send(message: FromServerMessage): void {
    if (!('targetId' in message) || message.targetId === undefined) return;
    if ('data' in message && message.data?.byteLength === 0) {
      throw new Error('Tried to send a zero-length message');
    }

    const senderId = this.peerId;
    if (!senderId) return;

    const connectionKey = this.connectionKeyByInternalPeer.get(message.targetId);
    const connection = connectionKey === undefined ? undefined : this.connections.get(connectionKey);
    if (!connection?.publicPeerId) return;

    const encoded = encode({
      ...message,
      targetId: connection.publicPeerId,
    });
    connection.socket.send(toArrayBuffer(encoded));
  }

  open(tenantContext: TTenantContext, socket: WebSocketWithIsAlive): void {
    const existingKey = socket.data.automergeConnectionKey;
    if (existingKey !== undefined) {
      const existing = this.connections.get(existingKey);
      if (existing !== undefined) this.removeConnection(existing);
    }

    const frozenTenantContext = fnFreezeTenantContext(tenantContext);
    const connectionId = String(this.connectionSequence++);
    const key = fnAutomergeConnectionScopeKey(frozenTenantContext.orgId, connectionId);
    const connection: TConnection = {
      key,
      tenantContext: frozenTenantContext,
      socket,
      documentUrls: new Set(),
    };
    socket.data.isAlive = true;
    socket.data.automergeConnectionKey = key;
    this.connections.set(key, connection);

    if (!this._isReady) {
      this._isReady = true;
      this._resolveReady();
    }
  }

  async receiveMessage(
    tenantContext: TTenantContext,
    messageBytes: Uint8Array,
    socket: WebSocketWithIsAlive,
  ): Promise<void> {
    const connection = this.findConnection(tenantContext, socket);
    if (connection === undefined) return;

    let message: FromClientMessage;
    try {
      message = decode(messageBytes) as FromClientMessage;
    } catch {
      this.terminateConnection(connection);
      return;
    }

    const { senderId } = message;
    const myPeerId = this.peerId;
    if (!myPeerId || typeof senderId !== 'string' || senderId.length === 0) {
      this.terminateConnection(connection);
      return;
    }

    if (isJoinMessage(message)) {
      this.receiveJoin(connection, message);
      return;
    }

    if (
      connection.publicPeerId === undefined
      || connection.internalPeerId === undefined
      || connection.publicPeerId !== senderId
    ) {
      this.terminateConnection(connection);
      return;
    }

    if (isLeaveMessage(message)) {
      this.terminateConnection(connection);
      return;
    }

    if ('targetId' in message && message.targetId !== myPeerId) {
      this.terminateConnection(connection);
      return;
    }

    const documentId = 'documentId' in message ? message.documentId : undefined;
    if (typeof documentId !== 'string' || documentId.length === 0) {
      this.denyDocument(connection);
      return;
    }

    const automergeUrl = fnAutomergeUrlFromDocumentKey(documentId);
    let admitted = false;
    try {
      admitted = await this.options.admitDocument(connection.tenantContext, automergeUrl);
    } catch {
      admitted = false;
    }
    if (!admitted) {
      this.denyDocument(connection);
      return;
    }

    this.markDocumentAccess(connection, automergeUrl);
    this.emit('message', {
      ...message,
      senderId: connection.internalPeerId,
    });
  }

  async message(
    tenantContext: TTenantContext,
    socket: WebSocketWithIsAlive,
    message: string | Buffer,
  ): Promise<void> {
    const connection = this.findConnection(tenantContext, socket);
    if (connection === undefined) return;
    socket.data.isAlive = true;
    if (typeof message === 'string') return;
    await this.receiveMessage(tenantContext, new Uint8Array(message), socket);
  }

  close(
    tenantContext: TTenantContext,
    socket: WebSocketWithIsAlive,
    _code: number,
    _reason: string,
  ): void {
    const connection = this.findConnection(tenantContext, socket);
    if (connection === undefined) return;
    socket.data.isAlive = false;
    this.removeConnection(connection);
  }

  pong(tenantContext: TTenantContext, socket: WebSocketWithIsAlive, _data: Buffer): void {
    const connection = this.findConnection(tenantContext, socket);
    if (connection === undefined) return;
    socket.data.isAlive = true;
  }

  isPeerAuthorizedForDocument(peerId: PeerId, documentId: string): boolean {
    const connectionKey = this.connectionKeyByInternalPeer.get(peerId);
    const connection = connectionKey === undefined ? undefined : this.connections.get(connectionKey);
    if (connection === undefined) return false;
    const documentKey = fnAutomergeDocumentKeyFromUrl(documentId);
    return connection.documentUrls.has(fnAutomergeUrlFromDocumentKey(documentKey));
  }

  getTenantMetrics(tenantContext: TTenantContext): TAutomergeWebSocketTenantMetrics {
    let connectedPeers = 0;
    let admittedPeerDocuments = 0;
    for (const connection of this.connections.values()) {
      if (connection.tenantContext.orgId !== tenantContext.orgId) continue;
      if (connection.internalPeerId !== undefined) connectedPeers += 1;
      admittedPeerDocuments += connection.documentUrls.size;
    }
    return { connectedPeers, admittedPeerDocuments };
  }

  private receiveJoin(
    connection: TConnection,
    message: FromClientMessage & { type: 'join' },
  ): void {
    const { senderId } = message;
    const internalPeerId = fnAutomergePeerScopeKey(
      connection.tenantContext.orgId,
      senderId,
    ) as PeerId;
    const existingConnectionKey = this.connectionKeyByInternalPeer.get(internalPeerId);
    const existingConnection = existingConnectionKey === undefined
      ? undefined
      : this.connections.get(existingConnectionKey);
    if (existingConnection !== undefined && existingConnection !== connection) {
      this.terminateConnection(existingConnection);
    }
    if (connection.internalPeerId !== undefined && connection.internalPeerId !== internalPeerId) {
      this.removePeer(connection);
    }

    const peerMetadata = 'peerMetadata' in message
      ? message.peerMetadata as PeerMetadata | undefined
      : undefined;
    const supportedProtocolVersions = 'supportedProtocolVersions' in message
      ? message.supportedProtocolVersions as TProtocolVersion[] | undefined
      : undefined;
    connection.publicPeerId = senderId;
    connection.internalPeerId = internalPeerId;
    this.connectionKeyByInternalPeer.set(internalPeerId, connection.key);
    this.emit('peer-candidate', { peerId: internalPeerId, peerMetadata: peerMetadata ?? {} });

    const selectedProtocolVersion = this.selectProtocol(supportedProtocolVersions);
    if (selectedProtocolVersion === null) {
      this.send({
        type: 'error',
        senderId: this.peerId!,
        message: 'unsupported protocol version',
        targetId: internalPeerId,
      });
      this.terminateConnection(connection);
      return;
    }

    this.send({
      type: 'peer',
      senderId: this.peerId!,
      peerMetadata: this.peerMetadata ?? {},
      selectedProtocolVersion: PROTOCOL_V1,
      targetId: internalPeerId,
    });
  }

  private selectProtocol(versions?: TProtocolVersion[]): TProtocolVersion | null {
    if (versions === undefined || versions.includes(PROTOCOL_V1)) return PROTOCOL_V1;
    return null;
  }

  private findConnection(
    tenantContext: TTenantContext,
    socket: WebSocketWithIsAlive,
  ): TConnection | undefined {
    const key = socket.data.automergeConnectionKey;
    const connection = key === undefined ? undefined : this.connections.get(key);
    if (connection === undefined || connection.socket !== socket) return undefined;
    if (!this.contextMatchesConnection(tenantContext, connection.tenantContext)) {
      this.terminateConnection(connection);
      return undefined;
    }
    return connection;
  }

  private contextMatchesConnection(left: TTenantContext, right: TTenantContext): boolean {
    return left.orgId === right.orgId
      && left.accountId === right.accountId
      && left.cellId === right.cellId
      && left.placementEpoch === right.placementEpoch
      && left.requestId === right.requestId;
  }

  private markDocumentAccess(connection: TConnection, automergeUrl: string): void {
    if (connection.documentUrls.has(automergeUrl)) return;
    connection.documentUrls.add(automergeUrl);
    this.options.onDocumentPeerChange?.({
      tenantContext: connection.tenantContext,
      automergeUrl,
      delta: 1,
    });
  }

  private denyDocument(connection: TConnection): void {
    this.options.onDocumentDenied?.(connection.tenantContext);
    if (connection.internalPeerId !== undefined) {
      this.send({
        type: 'error',
        senderId: this.peerId!,
        message: AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE,
        targetId: connection.internalPeerId,
      });
    }
    this.terminateConnection(connection);
  }

  private terminateConnection(connection: TConnection): void {
    this.removeConnection(connection);
    connection.socket.terminate();
  }

  private removeConnection(connection: TConnection): void {
    if (!this.connections.has(connection.key)) return;
    this.removePeer(connection);
    for (const automergeUrl of connection.documentUrls) {
      this.options.onDocumentPeerChange?.({
        tenantContext: connection.tenantContext,
        automergeUrl,
        delta: -1,
      });
    }
    connection.documentUrls.clear();
    this.connections.delete(connection.key);
    if (connection.socket.data.automergeConnectionKey === connection.key) {
      delete connection.socket.data.automergeConnectionKey;
    }
  }

  private removePeer(connection: TConnection): void {
    if (connection.internalPeerId === undefined) return;
    this.emit('peer-disconnected', { peerId: connection.internalPeerId });
    if (this.connectionKeyByInternalPeer.get(connection.internalPeerId) === connection.key) {
      this.connectionKeyByInternalPeer.delete(connection.internalPeerId);
    }
    connection.internalPeerId = undefined;
    connection.publicPeerId = undefined;
  }
}
