import * as Automerge from '@automerge/automerge';
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
import {
  AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE,
  MAX_AUTOMERGE_PENDING_CONNECTION_BYTES,
  MAX_AUTOMERGE_PENDING_CONNECTION_MESSAGES,
  MAX_AUTOMERGE_PENDING_DOCUMENT_BYTES,
  MAX_AUTOMERGE_PENDING_DOCUMENT_MESSAGES,
  MAX_AUTOMERGE_PENDING_GLOBAL_BYTES,
  MAX_AUTOMERGE_PENDING_GLOBAL_MESSAGES,
  MAX_AUTOMERGE_PEER_ID_LENGTH,
  MAX_AUTOMERGE_WEBSOCKET_CONNECTIONS,
  MAX_AUTOMERGE_WEBSOCKET_CONNECTIONS_PER_ORGANIZATION,
  MAX_AUTOMERGE_WEBSOCKET_FRAME_BYTES,
  WIDGET_STATE_MUTATION_RATE_LIMIT,
  WIDGET_STATE_MUTATION_RATE_WINDOW_MS,
} from '../CONSTANTS';
import {
  fnAutomergeConnectionScopeKey,
  fnAutomergeDocumentKeyFromUrl,
  fnAutomergeDocumentScopeKey,
  fnAutomergePeerScopeKey,
  fnAutomergeUrlFromDocumentKey,
} from '../core/fn.automerge-document';
import { fnWidgetCollaborativeStateIdentitiesMatch } from '../core/fn.widget-collaborative-state';
import type {
  TAutomergeDocumentAccess,
  TAutomergeDocumentAuthorization,
} from '../types/widget-state.types';

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
  send(data: ArrayBuffer): number;
  terminate(): void;
};

export type TAutomergePeerDocumentEvent = Readonly<{
  tenantContext: TTenantContext;
  automergeUrl: string;
  delta: 1 | -1;
}>;

export type TAutomergeManagedDocumentAdmission = Readonly<{
  authorization: TAutomergeDocumentAuthorization;
  retainPeer: (alreadyRetained: boolean) => boolean;
  release: () => void | Promise<void>;
}>;

export type TAutomergeDocumentAdmission =
  | TAutomergeDocumentAuthorization
  | TAutomergeManagedDocumentAdmission;

export type TBunWSServerAdapterOptions = Readonly<{
  admitDocument: (
    tenantContext: TTenantContext,
    automergeUrl: string,
    signal?: AbortSignal,
  ) => Promise<TAutomergeDocumentAdmission | null>;
  admitWidgetStateSync: (
    tenantContext: TTenantContext,
    automergeUrl: string,
    syncMessage: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  onDocumentPeerChange?: (event: TAutomergePeerDocumentEvent) => boolean | void;
  onDocumentDenied?: (tenantContext: TTenantContext) => void;
  maxFrameBytes?: number;
  maxConnections?: number;
  maxConnectionsPerOrganization?: number;
  maxPendingDocumentMessages?: number;
  maxPendingDocumentBytes?: number;
  maxPendingConnectionMessages?: number;
  maxPendingConnectionBytes?: number;
  maxPendingGlobalMessages?: number;
  maxPendingGlobalBytes?: number;
  widgetStateMessageRateLimit?: number;
  widgetStateMessageRateWindowMs?: number;
  nowMs?: () => number;
}>;

export type TAutomergeWebSocketTenantMetrics = Readonly<{
  connectedPeers: number;
  admittedPeerDocuments: number;
}>;

type TProtocolVersion = '1';
const PROTOCOL_V1: TProtocolVersion = '1';
const MAX_ADVERTISED_PROTOCOL_VERSIONS = 16;
const MAX_PROTOCOL_VERSION_LENGTH = 16;

type TConnection = {
  key: string;
  tenantContext: TTenantContext;
  socket: WebSocketWithIsAlive;
  lifetime: AbortController;
  publicPeerId?: PeerId;
  internalPeerId?: PeerId;
  documentAccessByUrl: Map<string, TAutomergeDocumentAccess>;
  widgetStateMessageTimes: Map<string, number[]>;
  widgetStateLastClock: Map<string, number>;
  pendingMessages: number;
  pendingBytes: number;
};

type TPendingDocumentMessages = {
  count: number;
  bytes: number;
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
  private readonly maxFrameBytes: number;
  private readonly maxConnections: number;
  private readonly maxConnectionsPerOrganization: number;
  private readonly maxPendingDocumentMessages: number;
  private readonly maxPendingDocumentBytes: number;
  private readonly maxPendingConnectionMessages: number;
  private readonly maxPendingConnectionBytes: number;
  private readonly maxPendingGlobalMessages: number;
  private readonly maxPendingGlobalBytes: number;
  private readonly widgetStateMessageRateLimit: number;
  private readonly widgetStateMessageRateWindowMs: number;
  private readonly nowMs: () => number;
  private readonly connections = new Map<string, TConnection>();
  private readonly connectionCountsByOrganization = new Map<string, number>();
  private readonly connectionKeyByInternalPeer = new Map<string, string>();
  private readonly documentMessageTails = new Map<string, Promise<void>>();
  private readonly pendingDocumentMessages = new Map<string, TPendingDocumentMessages>();
  private pendingGlobalMessages = 0;
  private pendingGlobalBytes = 0;
  private keepAliveInterval = 5000;
  private keepAliveId: Timer | undefined;
  private connectionSequence = 0;
  private _isReady = false;
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;

  constructor(options: TBunWSServerAdapterOptions) {
    super();
    this.options = options;
    this.maxFrameBytes = this.requirePositiveInteger(
      options.maxFrameBytes ?? MAX_AUTOMERGE_WEBSOCKET_FRAME_BYTES,
      'maxFrameBytes',
    );
    this.maxConnections = this.requirePositiveInteger(
      options.maxConnections ?? MAX_AUTOMERGE_WEBSOCKET_CONNECTIONS,
      'maxConnections',
    );
    this.maxConnectionsPerOrganization = this.requirePositiveInteger(
      options.maxConnectionsPerOrganization
        ?? MAX_AUTOMERGE_WEBSOCKET_CONNECTIONS_PER_ORGANIZATION,
      'maxConnectionsPerOrganization',
    );
    this.maxPendingDocumentMessages = this.requirePositiveInteger(
      options.maxPendingDocumentMessages ?? MAX_AUTOMERGE_PENDING_DOCUMENT_MESSAGES,
      'maxPendingDocumentMessages',
    );
    this.maxPendingDocumentBytes = this.requirePositiveInteger(
      options.maxPendingDocumentBytes ?? MAX_AUTOMERGE_PENDING_DOCUMENT_BYTES,
      'maxPendingDocumentBytes',
    );
    this.maxPendingConnectionMessages = this.requirePositiveInteger(
      options.maxPendingConnectionMessages ?? MAX_AUTOMERGE_PENDING_CONNECTION_MESSAGES,
      'maxPendingConnectionMessages',
    );
    this.maxPendingConnectionBytes = this.requirePositiveInteger(
      options.maxPendingConnectionBytes ?? MAX_AUTOMERGE_PENDING_CONNECTION_BYTES,
      'maxPendingConnectionBytes',
    );
    this.maxPendingGlobalMessages = this.requirePositiveInteger(
      options.maxPendingGlobalMessages ?? MAX_AUTOMERGE_PENDING_GLOBAL_MESSAGES,
      'maxPendingGlobalMessages',
    );
    this.maxPendingGlobalBytes = this.requirePositiveInteger(
      options.maxPendingGlobalBytes ?? MAX_AUTOMERGE_PENDING_GLOBAL_BYTES,
      'maxPendingGlobalBytes',
    );
    this.widgetStateMessageRateLimit = this.requirePositiveInteger(
      options.widgetStateMessageRateLimit ?? WIDGET_STATE_MUTATION_RATE_LIMIT,
      'widgetStateMessageRateLimit',
    );
    this.widgetStateMessageRateWindowMs = this.requirePositiveInteger(
      options.widgetStateMessageRateWindowMs ?? WIDGET_STATE_MUTATION_RATE_WINDOW_MS,
      'widgetStateMessageRateWindowMs',
    );
    this.nowMs = options.nowMs ?? Date.now;
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

  async drainDocumentMessages(): Promise<void> {
    while (this.documentMessageTails.size > 0) {
      await Promise.allSettled([...this.documentMessageTails.values()]);
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
    if (!connection?.publicPeerId || connection.internalPeerId === undefined) return;

    const documentId = 'documentId' in message ? message.documentId : undefined;
    if (message.type === 'doc-unavailable' || documentId === undefined) {
      this.sendToConnection(connection, message);
      return;
    }
    if (typeof documentId !== 'string' || documentId.length === 0) return;

    const automergeUrl = fnAutomergeUrlFromDocumentKey(
      fnAutomergeDocumentKeyFromUrl(documentId),
    );
    if (!connection.documentAccessByUrl.has(automergeUrl)) return;
    const capturedInternalPeerId = connection.internalPeerId;
    const scopeKey = fnAutomergeDocumentScopeKey(
      connection.tenantContext.orgId,
      automergeUrl,
    );
    const encoded = this.encodeForConnection(connection, message);
    if (encoded === null || encoded.byteLength > this.maxFrameBytes) {
      this.terminateConnection(connection);
      return;
    }
    if (!this.reserveDocumentMessage(connection, scopeKey, encoded.byteLength)) {
      this.terminateConnection(connection);
      return;
    }
    void this.runDocumentMessage(scopeKey, async () => {
      try {
        if (!await this.reauthorizeDocumentAccess(
          connection,
          capturedInternalPeerId,
          automergeUrl,
        )) return;
        this.sendEncodedToConnection(connection, encoded);
      } finally {
        this.releaseDocumentMessage(connection, scopeKey, encoded.byteLength);
      }
    }).catch(() => undefined);
  }

  open(tenantContext: TTenantContext, socket: WebSocketWithIsAlive): void {
    const existingKey = socket.data.automergeConnectionKey;
    if (existingKey !== undefined) {
      const existing = this.connections.get(existingKey);
      if (existing !== undefined) this.removeConnection(existing);
      else delete socket.data.automergeConnectionKey;
    }

    const frozenTenantContext = fnFreezeTenantContext(tenantContext);
    const organizationConnectionCount = this.connectionCountsByOrganization.get(
      frozenTenantContext.orgId,
    ) ?? 0;
    if (
      this.connections.size >= this.maxConnections
      || organizationConnectionCount >= this.maxConnectionsPerOrganization
    ) {
      socket.data.isAlive = false;
      socket.terminate();
      return;
    }
    const connectionId = String(this.connectionSequence++);
    const key = fnAutomergeConnectionScopeKey(frozenTenantContext.orgId, connectionId);
    const connection: TConnection = {
      key,
      tenantContext: frozenTenantContext,
      socket,
      lifetime: new AbortController(),
      documentAccessByUrl: new Map(),
      widgetStateMessageTimes: new Map(),
      widgetStateLastClock: new Map(),
      pendingMessages: 0,
      pendingBytes: 0,
    };
    socket.data.isAlive = true;
    socket.data.automergeConnectionKey = key;
    this.connections.set(key, connection);
    this.connectionCountsByOrganization.set(
      frozenTenantContext.orgId,
      organizationConnectionCount + 1,
    );

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
    if (messageBytes.byteLength > this.maxFrameBytes) {
      this.denyDocument(connection);
      return;
    }

    let message: FromClientMessage;
    try {
      message = decode(messageBytes) as FromClientMessage;
    } catch {
      this.terminateConnection(connection);
      return;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      this.terminateConnection(connection);
      return;
    }

    const { senderId } = message;
    const myPeerId = this.peerId;
    if (
      !myPeerId
      || typeof senderId !== 'string'
      || senderId.length === 0
      || senderId.length > MAX_AUTOMERGE_PEER_ID_LENGTH
    ) {
      this.terminateConnection(connection);
      return;
    }

    if (isJoinMessage(message)) {
      if (
        connection.publicPeerId !== undefined
        || connection.internalPeerId !== undefined
      ) {
        this.terminateConnection(connection);
        return;
      }
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
    const scopeKey = fnAutomergeDocumentScopeKey(connection.tenantContext.orgId, automergeUrl);
    const capturedInternalPeerId = connection.internalPeerId;
    if (!this.reserveDocumentMessage(connection, scopeKey, messageBytes.byteLength)) {
      this.denyDocument(connection);
      return;
    }
    try {
      await this.runDocumentMessage(scopeKey, async () => {
        if (!this.connectionGenerationMatches(connection, capturedInternalPeerId)) return;
        let admission: TAutomergeDocumentAdmission | null = null;
        let retainedAdmission = false;
        try {
          admission = await this.options.admitDocument(
            connection.tenantContext,
            automergeUrl,
            connection.lifetime.signal,
          );
        } catch {
          admission = null;
        }
        const managedAdmission = this.managedAdmission(admission);
        try {
          if (!this.connectionGenerationMatches(connection, capturedInternalPeerId)) return;
          if (admission === null) {
            this.denyDocument(connection);
            return;
          }
          const authorization = this.admissionAuthorization(admission);
          const { access } = authorization;
          if (
            !authorization.canWrite
            && (message.type === 'sync' || message.type === 'request')
            && !this.isReadOnlySyncMessage(message.data)
          ) {
            this.denyDocument(connection);
            return;
          }
          if (access.kind === 'widget-state') {
            if (!this.admitWidgetStateMessage(connection, automergeUrl)) {
              this.denyDocument(connection);
              return;
            }
            if (message.type === 'sync' || message.type === 'request') {
              const admitted = message.data instanceof Uint8Array
                && await this.awaitConnectionBoolean(connection, this.options.admitWidgetStateSync(
                  connection.tenantContext,
                  automergeUrl,
                  message.data,
                  connection.lifetime.signal,
                ));
              if (!this.connectionGenerationMatches(connection, capturedInternalPeerId)) return;
              if (!admitted) {
                this.denyDocument(connection);
                return;
              }
            }
          }

          if (!this.markDocumentAccess(connection, automergeUrl, access, managedAdmission)) {
            this.denyDocument(connection);
            return;
          }
          retainedAdmission = managedAdmission !== null;
          this.emit('message', {
            ...message,
            senderId: capturedInternalPeerId,
          });
        } finally {
          if (managedAdmission !== null && !retainedAdmission) {
            await managedAdmission.release();
          }
        }
      });
    } finally {
      this.releaseDocumentMessage(connection, scopeKey, messageBytes.byteLength);
    }
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
    await this.receiveMessage(
      tenantContext,
      new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
      socket,
    );
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

  async isPeerAuthorizedForDocument(peerId: PeerId, documentId: string): Promise<boolean> {
    const connectionKey = this.connectionKeyByInternalPeer.get(peerId);
    const connection = connectionKey === undefined ? undefined : this.connections.get(connectionKey);
    if (connection === undefined) return false;
    const documentKey = fnAutomergeDocumentKeyFromUrl(documentId);
    const automergeUrl = fnAutomergeUrlFromDocumentKey(documentKey);
    return await this.reauthorizeDocumentAccess(connection, peerId, automergeUrl);
  }

  getTenantMetrics(tenantContext: TTenantContext): TAutomergeWebSocketTenantMetrics {
    let connectedPeers = 0;
    let admittedPeerDocuments = 0;
    for (const connection of this.connections.values()) {
      if (connection.tenantContext.orgId !== tenantContext.orgId) continue;
      if (connection.internalPeerId !== undefined) connectedPeers += 1;
      admittedPeerDocuments += connection.documentAccessByUrl.size;
    }
    return { connectedPeers, admittedPeerDocuments };
  }

  private receiveJoin(
    connection: TConnection,
    message: FromClientMessage & { type: 'join' },
  ): void {
    const { senderId } = message;
    const supportedProtocolVersions = 'supportedProtocolVersions' in message
      ? message.supportedProtocolVersions
      : undefined;
    const selectedProtocolVersion = this.selectProtocol(supportedProtocolVersions);
    if (selectedProtocolVersion === null) {
      this.sendJoinError(connection, senderId, 'unsupported protocol version');
      this.terminateConnection(connection);
      return;
    }

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

    connection.publicPeerId = senderId;
    connection.internalPeerId = internalPeerId;
    this.connectionKeyByInternalPeer.set(internalPeerId, connection.key);
    this.emit('peer-candidate', {
      peerId: internalPeerId,
      peerMetadata: { isEphemeral: true },
    });

    this.send({
      type: 'peer',
      senderId: this.peerId!,
      peerMetadata: this.peerMetadata ?? {},
      selectedProtocolVersion,
      targetId: internalPeerId,
    });
  }

  private selectProtocol(versions: unknown): TProtocolVersion | null {
    if (versions === undefined) return PROTOCOL_V1;
    if (
      !Array.isArray(versions)
      || versions.length > MAX_ADVERTISED_PROTOCOL_VERSIONS
      || versions.some((version) => (
        typeof version !== 'string'
        || version.length < 1
        || version.length > MAX_PROTOCOL_VERSION_LENGTH
      ))
    ) return null;
    if (versions.includes(PROTOCOL_V1)) return PROTOCOL_V1;
    return null;
  }

  private sendJoinError(
    connection: TConnection,
    publicPeerId: string,
    message: string,
  ): void {
    let encoded: Uint8Array;
    try {
      encoded = encode({
        type: 'error',
        senderId: this.peerId!,
        message,
        targetId: publicPeerId,
      });
    } catch {
      return;
    }
    this.sendEncodedToConnection(connection, encoded);
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

  private markDocumentAccess(
    connection: TConnection,
    automergeUrl: string,
    access: TAutomergeDocumentAccess,
    managedAdmission: TAutomergeManagedDocumentAdmission | null = null,
  ): boolean {
    const existing = connection.documentAccessByUrl.get(automergeUrl);
    if (existing !== undefined) {
      return this.documentAccessMatches(existing, access)
        && (managedAdmission?.retainPeer(true) ?? true);
    }
    if (managedAdmission !== null && !managedAdmission.retainPeer(false)) return false;
    if (
      managedAdmission === null
      && this.options.onDocumentPeerChange?.({
        tenantContext: connection.tenantContext,
        automergeUrl,
        delta: 1,
      }) === false
    ) return false;
    connection.documentAccessByUrl.set(automergeUrl, access);
    return true;
  }

  private unmarkDocumentAccess(connection: TConnection, automergeUrl: string): void {
    if (!connection.documentAccessByUrl.delete(automergeUrl)) return;
    connection.widgetStateMessageTimes.delete(automergeUrl);
    connection.widgetStateLastClock.delete(automergeUrl);
    this.options.onDocumentPeerChange?.({
      tenantContext: connection.tenantContext,
      automergeUrl,
      delta: -1,
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
    if (!this.connections.has(connection.key)) return;
    this.removeConnection(connection);
    connection.socket.terminate();
  }

  private removeConnection(connection: TConnection): void {
    if (!this.connections.has(connection.key)) return;
    connection.lifetime.abort();
    this.removePeer(connection);
    for (const automergeUrl of connection.documentAccessByUrl.keys()) {
      this.options.onDocumentPeerChange?.({
        tenantContext: connection.tenantContext,
        automergeUrl,
        delta: -1,
      });
    }
    connection.documentAccessByUrl.clear();
    connection.widgetStateMessageTimes.clear();
    connection.widgetStateLastClock.clear();
    this.connections.delete(connection.key);
    const organizationConnectionCount = this.connectionCountsByOrganization.get(
      connection.tenantContext.orgId,
    ) ?? 0;
    if (organizationConnectionCount <= 1) {
      this.connectionCountsByOrganization.delete(connection.tenantContext.orgId);
    } else {
      this.connectionCountsByOrganization.set(
        connection.tenantContext.orgId,
        organizationConnectionCount - 1,
      );
    }
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

  private admitWidgetStateMessage(connection: TConnection, automergeUrl: string): boolean {
    const now = this.nowMs();
    const previousNow = connection.widgetStateLastClock.get(automergeUrl);
    if (!Number.isSafeInteger(now) || now < 0 || (previousNow !== undefined && now < previousNow)) {
      return false;
    }
    const cutoff = now - this.widgetStateMessageRateWindowMs;
    const messageTimes = connection.widgetStateMessageTimes.get(automergeUrl) ?? [];
    while (messageTimes.length > 0 && messageTimes[0]! <= cutoff) messageTimes.shift();
    if (messageTimes.length >= this.widgetStateMessageRateLimit) return false;
    messageTimes.push(now);
    connection.widgetStateMessageTimes.set(automergeUrl, messageTimes);
    connection.widgetStateLastClock.set(automergeUrl, now);
    return true;
  }

  private async runDocumentMessage(
    scopeKey: string,
    operation: () => void | Promise<void>,
  ): Promise<void> {
    const previous = this.documentMessageTails.get(scopeKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(operation);
    this.documentMessageTails.set(scopeKey, current);
    try {
      await current;
    } finally {
      if (this.documentMessageTails.get(scopeKey) === current) {
        this.documentMessageTails.delete(scopeKey);
      }
    }
  }

  private connectionGenerationMatches(
    connection: TConnection,
    internalPeerId: PeerId,
  ): boolean {
    return this.connections.get(connection.key) === connection
      && connection.internalPeerId === internalPeerId;
  }

  private async reauthorizeDocumentAccess(
    connection: TConnection,
    internalPeerId: PeerId,
    automergeUrl: string,
  ): Promise<boolean> {
    const admittedAccess = connection.documentAccessByUrl.get(automergeUrl);
    if (
      admittedAccess === undefined
      || !this.connectionGenerationMatches(connection, internalPeerId)
    ) return false;

    let admission: TAutomergeDocumentAdmission | null = null;
    let retainedAdmission = false;
    try {
      admission = await this.options.admitDocument(
        connection.tenantContext,
        automergeUrl,
        connection.lifetime.signal,
      );
    } catch {
      admission = null;
    }
    const managedAdmission = this.managedAdmission(admission);
    try {
      if (
        !this.connectionGenerationMatches(connection, internalPeerId)
        || !connection.documentAccessByUrl.has(automergeUrl)
      ) return false;
      const authorization = admission === null
        ? null
        : this.admissionAuthorization(admission);
      if (
        authorization === null
        || !this.documentAccessMatches(admittedAccess, authorization.access)
        || (managedAdmission !== null && !managedAdmission.retainPeer(true))
      ) {
        this.unmarkDocumentAccess(connection, automergeUrl);
        return false;
      }
      retainedAdmission = managedAdmission !== null;
      return true;
    } finally {
      if (managedAdmission !== null && !retainedAdmission) {
        await managedAdmission.release();
      }
    }
  }

  private managedAdmission(
    admission: TAutomergeDocumentAdmission | null,
  ): TAutomergeManagedDocumentAdmission | null {
    return admission !== null && 'authorization' in admission ? admission : null;
  }

  private admissionAuthorization(
    admission: TAutomergeDocumentAdmission,
  ): TAutomergeDocumentAuthorization {
    return 'authorization' in admission ? admission.authorization : admission;
  }

  private async awaitConnectionBoolean(
    connection: TConnection,
    operation: Promise<boolean>,
  ): Promise<boolean> {
    const signal = connection.lifetime.signal;
    if (signal.aborted) return false;
    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const settle = (result: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        result();
      };
      const onAbort = (): void => settle(() => resolve(false));
      signal.addEventListener('abort', onAbort, { once: true });
      void operation.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  private documentAccessMatches(
    left: TAutomergeDocumentAccess,
    right: TAutomergeDocumentAccess,
  ): boolean {
    if (
      left.kind !== right.kind
      || left.orgId !== right.orgId
      || left.canvasId !== right.canvasId
    ) return false;
    return left.kind === 'canvas'
      || (
        right.kind === 'widget-state'
        && fnWidgetCollaborativeStateIdentitiesMatch(left.identity, right.identity)
      );
  }

  private isReadOnlySyncMessage(data: unknown): boolean {
    if (!(data instanceof Uint8Array)) return false;
    try {
      return Automerge.decodeSyncMessage(data).changes.length === 0;
    } catch {
      return false;
    }
  }

  private sendToConnection(connection: TConnection, message: FromServerMessage): void {
    const encoded = this.encodeForConnection(connection, message);
    if (encoded === null) return;
    this.sendEncodedToConnection(connection, encoded);
  }

  private encodeForConnection(
    connection: TConnection,
    message: FromServerMessage,
  ): Uint8Array | null {
    if (connection.publicPeerId === undefined) return null;
    try {
      return encode({
        ...message,
        targetId: connection.publicPeerId,
      });
    } catch {
      return null;
    }
  }

  private sendEncodedToConnection(connection: TConnection, encoded: Uint8Array): void {
    let status: number;
    try {
      status = connection.socket.send(toArrayBuffer(encoded));
    } catch {
      this.terminateConnection(connection);
      return;
    }
    if (!Number.isFinite(status) || status <= 0) this.terminateConnection(connection);
  }

  private reserveDocumentMessage(
    connection: TConnection,
    scopeKey: string,
    byteLength: number,
  ): boolean {
    const documentPending = this.pendingDocumentMessages.get(scopeKey) ?? {
      count: 0,
      bytes: 0,
    };
    if (
      documentPending.count >= this.maxPendingDocumentMessages
      || documentPending.bytes + byteLength > this.maxPendingDocumentBytes
      || connection.pendingMessages >= this.maxPendingConnectionMessages
      || connection.pendingBytes + byteLength > this.maxPendingConnectionBytes
      || this.pendingGlobalMessages >= this.maxPendingGlobalMessages
      || this.pendingGlobalBytes + byteLength > this.maxPendingGlobalBytes
    ) return false;
    documentPending.count += 1;
    documentPending.bytes += byteLength;
    this.pendingDocumentMessages.set(scopeKey, documentPending);
    connection.pendingMessages += 1;
    connection.pendingBytes += byteLength;
    this.pendingGlobalMessages += 1;
    this.pendingGlobalBytes += byteLength;
    return true;
  }

  private releaseDocumentMessage(
    connection: TConnection,
    scopeKey: string,
    byteLength: number,
  ): void {
    const documentPending = this.pendingDocumentMessages.get(scopeKey);
    if (documentPending !== undefined) {
      documentPending.count = Math.max(0, documentPending.count - 1);
      documentPending.bytes = Math.max(0, documentPending.bytes - byteLength);
      if (documentPending.count === 0) this.pendingDocumentMessages.delete(scopeKey);
    }
    connection.pendingMessages = Math.max(0, connection.pendingMessages - 1);
    connection.pendingBytes = Math.max(0, connection.pendingBytes - byteLength);
    this.pendingGlobalMessages = Math.max(0, this.pendingGlobalMessages - 1);
    this.pendingGlobalBytes = Math.max(0, this.pendingGlobalBytes - byteLength);
  }

  private requirePositiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${label} must be a positive integer.`);
    }
    return value;
  }
}
