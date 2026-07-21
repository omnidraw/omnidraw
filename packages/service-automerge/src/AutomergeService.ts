import {
  Repo,
  type DocHandle,
  type DocHandleChangePayload,
  type DocumentId,
  type PeerId,
} from '@automerge/automerge-repo';
import type { Database as TursoDatabase } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  AUTOMERGE_CAPACITY_UNAVAILABLE_MESSAGE,
  AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE,
  DEFAULT_AUTOMERGE_DOCUMENT_IDLE_MS,
  DEFAULT_AUTOMERGE_LIFECYCLE_SWEEP_MS,
  DEFAULT_AUTOMERGE_MAX_ACTIVE_DOCUMENTS,
} from './CONSTANTS';
import { TursoStorageAdapter } from './adapters/turso.adapter';
import {
  BunWSServerAdapter,
  type TAutomergePeerDocumentEvent,
  type WebSocketWithIsAlive,
} from './adapters/websocket.adapter';
import {
  fnAutomergeDocumentKeyFromUrl,
  fnAutomergeDocumentScopeKey,
  fnAutomergeOrganizationScopeKey,
} from './core/fn.automerge-document';
import type { IAutomergeService } from './IAutomergeService';
import type {
  TAutomergeElementEvent as TAutomergeElementEventBase,
  TAutomergeServiceOptions,
  TAutomergeTenantMetrics,
} from './types/automerge-service.types';
import type { TCanvasDoc, TElement } from './types/canvas-doc.types';

export type TAutomergeStorageConfig = TursoDatabase | { type: 'turso'; database: TursoDatabase };
export type TAutomergeElementEvent = TAutomergeElementEventBase<TElement>;

export type TAutomergeCallbacks = {
  authorizeDocument: (tenantContext: TTenantContext, automergeUrl: string) => boolean | Promise<boolean>;
  onElementDelete: (event: TAutomergeElementEvent, handle: DocHandle<TCanvasDoc>) => void | Promise<void>;
  onElementCreate: (event: TAutomergeElementEvent, handle: DocHandle<TCanvasDoc>) => void | Promise<void>;
};

type TDocumentRecord = {
  scopeKey: string;
  orgId: string;
  automergeUrl: string;
  tenantContext: TTenantContext;
  lastAccessAt: number;
  peerCount: number;
  handle?: DocHandle<TCanvasDoc>;
  changeListener?: (payload: DocHandleChangePayload<TCanvasDoc>) => void;
};

export class AutomergeService implements IAutomergeService {
  readonly name = 'automerge' as const;
  private repoInstance: Repo | null = null;
  private storageAdapter: TursoStorageAdapter | null = null;
  private readonly wsAdapter: BunWSServerAdapter;
  private readonly documentRecords = new Map<string, TDocumentRecord>();
  private readonly evictionsByTenant = new Map<string, number>();
  private readonly denialsByTenant = new Map<string, number>();
  private lifecycleTail: Promise<void> = Promise.resolve();
  private lifecycleSweepInterval: ReturnType<typeof setInterval> | null = null;
  private readonly authorizeDocument: TAutomergeCallbacks['authorizeDocument'];
  private readonly onElementDelete: TAutomergeCallbacks['onElementDelete'];
  private readonly onElementCreate: TAutomergeCallbacks['onElementCreate'];
  private readonly maxActiveDocuments: number;
  private readonly documentIdleMs: number;
  private readonly lifecycleSweepMs: number;

  constructor(
    private readonly database: TAutomergeStorageConfig,
    callbacks: TAutomergeCallbacks,
    options: TAutomergeServiceOptions = {},
  ) {
    this.authorizeDocument = callbacks.authorizeDocument;
    this.onElementDelete = callbacks.onElementDelete;
    this.onElementCreate = callbacks.onElementCreate;
    this.maxActiveDocuments = this.requirePositiveInteger(
      options.maxActiveDocuments ?? DEFAULT_AUTOMERGE_MAX_ACTIVE_DOCUMENTS,
      'maxActiveDocuments',
    );
    this.documentIdleMs = this.requireNonNegativeInteger(
      options.documentIdleMs ?? DEFAULT_AUTOMERGE_DOCUMENT_IDLE_MS,
      'documentIdleMs',
    );
    this.lifecycleSweepMs = this.requirePositiveInteger(
      options.lifecycleSweepMs ?? DEFAULT_AUTOMERGE_LIFECYCLE_SWEEP_MS,
      'lifecycleSweepMs',
    );
    this.wsAdapter = new BunWSServerAdapter({
      admitDocument: (tenantContext, automergeUrl) => this.admitDocument(tenantContext, automergeUrl),
      onDocumentPeerChange: (event) => this.handleDocumentPeerChange(event),
      onDocumentDenied: (tenantContext) => this.incrementTenantCounter(this.denialsByTenant, tenantContext.orgId),
    });
  }

  start(): void {
    if (this.repoInstance !== null) return;

    const storage = this.createStorageAdapter(this.database);
    this.storageAdapter = storage;
    const repo = new Repo({
      storage,
      network: [this.wsAdapter],
      peerId: `server-${Date.now()}` as PeerId,
      shareConfig: {
        announce: async () => false,
        access: async (peerId, documentId) => this.wsAdapter.isPeerAuthorizedForDocument(peerId, documentId),
      },
    });
    this.repoInstance = repo;
    repo.on('document', ({ handle }) => {
      this.trackDiscoveredHandle(handle as DocHandle<TCanvasDoc>);
    });
    this.wsAdapter.connect(repo.peerId);
    this.lifecycleSweepInterval = setInterval(() => {
      void this.runLifecycleTask(async () => this.evictIdleDocuments()).catch(() => undefined);
    }, this.lifecycleSweepMs);
  }

  async createDocument<T>(
    tenantContext: TTenantContext,
    initialValue?: T,
  ): Promise<DocHandle<T>> {
    const frozenTenantContext = this.rememberTenantContext(tenantContext);
    return this.runLifecycleTask(async () => {
      await this.ensureDocumentCapacity();
      const handle = this.repo.create<T>(initialValue);
      try {
        this.storage.claimDocument(frozenTenantContext, handle.url);
        const record = this.createDocumentRecord(frozenTenantContext, handle.url);
        this.documentRecords.set(record.scopeKey, record);
        this.attachHandle(record, handle as unknown as DocHandle<TCanvasDoc>);
        return handle;
      } catch (error) {
        this.repo.delete(handle.documentId);
        throw error;
      }
    });
  }

  async findDocument<T>(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<DocHandle<T>> {
    if (!await this.admitDocument(tenantContext, automergeUrl)) {
      this.incrementTenantCounter(this.denialsByTenant, tenantContext.orgId);
      throw this.unavailableError();
    }

    return this.runLifecycleTask(async () => {
      const record = this.requireDocumentRecord(tenantContext, automergeUrl);
      const handle = await this.repo.find<T>(automergeUrl as never);
      this.attachHandle(record, handle as unknown as DocHandle<TCanvasDoc>);
      record.lastAccessAt = Date.now();
      return handle;
    });
  }

  async deleteDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<void> {
    const frozenTenantContext = fnFreezeTenantContext(tenantContext);
    if (!await this.isDocumentAuthorized(frozenTenantContext, automergeUrl)) {
      this.incrementTenantCounter(this.denialsByTenant, frozenTenantContext.orgId);
      throw this.unavailableError();
    }
    const alreadyAdmitted = this.storage.isDocumentAdmitted(frozenTenantContext, automergeUrl);
    if (!alreadyAdmitted && !await this.admitDocument(frozenTenantContext, automergeUrl)) {
      this.incrementTenantCounter(this.denialsByTenant, frozenTenantContext.orgId);
      throw this.unavailableError();
    }

    await this.runLifecycleTask(async () => {
      const scopeKey = fnAutomergeDocumentScopeKey(frozenTenantContext.orgId, automergeUrl);
      const record = this.documentRecords.get(scopeKey);
      if (record !== undefined) this.detachHandle(record);
      this.repo.delete(automergeUrl as never);
      this.documentRecords.delete(scopeKey);
      this.storage.forgetDocument(frozenTenantContext, automergeUrl);
    });
  }

  async admitDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<boolean> {
    const frozenTenantContext = this.rememberTenantContext(tenantContext);
    if (!await this.isDocumentAuthorized(frozenTenantContext, automergeUrl)) return false;
    if (!await this.storage.admitDocument(frozenTenantContext, automergeUrl)) return false;

    try {
      await this.runLifecycleTask(async () => {
        const scopeKey = fnAutomergeDocumentScopeKey(frozenTenantContext.orgId, automergeUrl);
        const existing = this.documentRecords.get(scopeKey);
        if (existing !== undefined) {
          existing.lastAccessAt = Date.now();
          return;
        }
        await this.ensureDocumentCapacity();
        const record = this.createDocumentRecord(frozenTenantContext, automergeUrl);
        this.documentRecords.set(record.scopeKey, record);
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === AUTOMERGE_CAPACITY_UNAVAILABLE_MESSAGE) {
        this.storage.releaseDocument(frozenTenantContext, automergeUrl);
        return false;
      }
      throw error;
    }
  }

  async releaseDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<void> {
    const frozenTenantContext = fnFreezeTenantContext(tenantContext);
    if (!await this.isDocumentAuthorized(frozenTenantContext, automergeUrl)) return;
    await this.runLifecycleTask(async () => {
      const record = this.documentRecords.get(
        fnAutomergeDocumentScopeKey(frozenTenantContext.orgId, automergeUrl),
      );
      if (record === undefined) return;
      record.lastAccessAt = 0;
      if (record.peerCount === 0) await this.evictRecord(record);
    });
  }

  async notifyDocumentRegistered(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<void> {
    const frozenTenantContext = this.rememberTenantContext(tenantContext);
    if (!await this.isDocumentAuthorized(frozenTenantContext, automergeUrl)) {
      throw this.unavailableError();
    }
    await this.storage.notifyDocumentRegistered(frozenTenantContext, automergeUrl);
    await this.runLifecycleTask(async () => {
      const scopeKey = fnAutomergeDocumentScopeKey(frozenTenantContext.orgId, automergeUrl);
      const existing = this.documentRecords.get(scopeKey);
      if (existing !== undefined) {
        existing.lastAccessAt = Date.now();
        return;
      }
      await this.ensureDocumentCapacity();
      const record = this.createDocumentRecord(frozenTenantContext, automergeUrl);
      this.documentRecords.set(record.scopeKey, record);
    });
  }

  failDocumentRegistration(
    tenantContext: TTenantContext,
    automergeUrl: string,
    cause: unknown,
  ): void {
    const current = this.documentRecords.get(
      fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
    );
    if (
      current !== undefined
      && (
        current.tenantContext.accountId !== tenantContext.accountId
        || current.tenantContext.cellId !== tenantContext.cellId
        || current.tenantContext.placementEpoch !== tenantContext.placementEpoch
      )
    ) return;
    this.storageAdapter?.failDocumentRegistration(tenantContext, automergeUrl, cause);
    void this.runLifecycleTask(async () => {
      const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
      const record = this.documentRecords.get(scopeKey);
      if (record !== undefined) this.detachHandle(record);
      this.documentRecords.delete(scopeKey);
      if (this.repoInstance?.handles[fnAutomergeDocumentKeyFromUrl(automergeUrl) as DocumentId]) {
        this.repoInstance.delete(automergeUrl as never);
      }
    }).catch(() => undefined);
  }

  openConnection(tenantContext: TTenantContext, socket: WebSocketWithIsAlive): void {
    this.repo;
    this.wsAdapter.open(tenantContext, socket);
  }

  receiveConnectionMessage(
    tenantContext: TTenantContext,
    socket: WebSocketWithIsAlive,
    message: string | Buffer,
  ): Promise<void> {
    this.repo;
    return this.wsAdapter.message(tenantContext, socket, message);
  }

  closeConnection(
    tenantContext: TTenantContext,
    socket: WebSocketWithIsAlive,
    code: number,
    reason: string,
  ): void {
    this.wsAdapter.close(tenantContext, socket, code, reason);
  }

  pongConnection(tenantContext: TTenantContext, socket: WebSocketWithIsAlive, data: Buffer): void {
    this.wsAdapter.pong(tenantContext, socket, data);
  }

  getTenantMetrics(tenantContext: TTenantContext): TAutomergeTenantMetrics {
    let activeDocuments = 0;
    for (const record of this.documentRecords.values()) {
      if (record.orgId === tenantContext.orgId) activeDocuments += 1;
    }
    const socketMetrics = this.wsAdapter.getTenantMetrics(tenantContext);
    const storageMetrics = this.storageAdapter?.getTenantMetrics(tenantContext) ?? {
      pendingWrites: 0,
      pendingBytes: 0,
    };
    const tenantKey = fnAutomergeOrganizationScopeKey(tenantContext.orgId);
    return {
      activeDocuments,
      connectedPeers: socketMetrics.connectedPeers,
      admittedPeerDocuments: socketMetrics.admittedPeerDocuments,
      pendingWrites: storageMetrics.pendingWrites,
      pendingBytes: storageMetrics.pendingBytes,
      evictedDocuments: this.evictionsByTenant.get(tenantKey) ?? 0,
      deniedDocuments: this.denialsByTenant.get(tenantKey) ?? 0,
    };
  }

  async stop(): Promise<void> {
    if (this.lifecycleSweepInterval !== null) {
      clearInterval(this.lifecycleSweepInterval);
      this.lifecycleSweepInterval = null;
    }
    this.wsAdapter.disconnect();
    await this.lifecycleTail.catch(() => undefined);

    const repo = this.repoInstance;
    const storage = this.storageAdapter;
    let stopFailure: unknown;
    if (repo !== null) {
      for (const record of [...this.documentRecords.values()]) {
        if (storage?.isDocumentRegistered(record.tenantContext, record.automergeUrl) !== false) continue;
        storage.failDocumentRegistration(
          record.tenantContext,
          record.automergeUrl,
          new Error('Automerge service stopped before document registration.'),
        );
        this.detachHandle(record);
        if (repo.handles[fnAutomergeDocumentKeyFromUrl(record.automergeUrl) as DocumentId]) {
          repo.delete(record.automergeUrl as never);
        }
        this.documentRecords.delete(record.scopeKey);
      }
      const cachedDocumentIds = [...this.documentRecords.values()]
        .flatMap((record) => record.handle === undefined ? [] : [record.handle.documentId]);
      for (const record of this.documentRecords.values()) this.detachHandle(record);
      const shutdown = repo.shutdown();
      storage?.sealWrites();
      try {
        await shutdown;
      } catch (error) {
        stopFailure = error;
      }
      try {
        await storage?.drainWrites();
      } catch (error) {
        stopFailure ??= error;
      }
      const cacheRemovalResults = await Promise.allSettled(
        cachedDocumentIds.map(async (documentId) => repo.removeFromCache(documentId)),
      );
      for (const result of cacheRemovalResults) {
        if (result.status === 'rejected') stopFailure ??= result.reason;
      }
    }
    storage?.dispose();
    this.documentRecords.clear();
    this.repoInstance = null;
    this.storageAdapter = null;
    if (stopFailure !== undefined) throw stopFailure;
  }

  private get repo(): Repo {
    if (this.repoInstance === null) {
      throw new Error('AutomergeService accessed before service start');
    }
    return this.repoInstance;
  }

  private get storage(): TursoStorageAdapter {
    if (this.storageAdapter === null) {
      throw new Error('AutomergeService storage accessed before service start');
    }
    return this.storageAdapter;
  }

  private createStorageAdapter(database: TAutomergeStorageConfig): TursoStorageAdapter {
    if ('type' in database) return new TursoStorageAdapter(database.database);
    return new TursoStorageAdapter(database);
  }

  private rememberTenantContext(tenantContext: TTenantContext): TTenantContext {
    return fnFreezeTenantContext(tenantContext);
  }

  private async isDocumentAuthorized(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<boolean> {
    return await this.authorizeDocument(tenantContext, automergeUrl);
  }

  private createDocumentRecord(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): TDocumentRecord {
    return {
      scopeKey: fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
      orgId: tenantContext.orgId,
      automergeUrl,
      tenantContext,
      lastAccessAt: Date.now(),
      peerCount: 0,
    };
  }

  private requireDocumentRecord(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): TDocumentRecord {
    const record = this.documentRecords.get(
      fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
    );
    if (record === undefined) throw this.unavailableError();
    return record;
  }

  private trackDiscoveredHandle(handle: DocHandle<TCanvasDoc>): void {
    const orgId = this.storageAdapter?.getDocumentOrganizationId(handle.url);
    if (orgId === undefined) return;
    const record = this.documentRecords.get(fnAutomergeDocumentScopeKey(orgId, handle.url));
    if (record === undefined) return;
    this.attachHandle(record, handle);
  }

  private attachHandle(record: TDocumentRecord, handle: DocHandle<TCanvasDoc>): void {
    if (record.handle === handle && record.changeListener !== undefined) return;
    this.detachHandle(record);
    const listener = ({ patchInfo }: DocHandleChangePayload<TCanvasDoc>) => {
      record.lastAccessAt = Date.now();
      const before = patchInfo.before as TCanvasDoc | undefined;
      const after = patchInfo.after as TCanvasDoc | undefined;
      const canvasDocId = after?.id ?? before?.id ?? handle.documentId;
      const beforeElements = before?.elements ?? {};
      const afterElements = after?.elements ?? {};

      for (const [elementId, element] of Object.entries(beforeElements)) {
        if (elementId in afterElements) continue;
        void Promise.resolve(this.onElementDelete({
          tenantContext: record.tenantContext,
          canvasDocId,
          automergeUrl: handle.url,
          element,
        }, handle)).catch(() => undefined);
      }

      for (const [elementId, element] of Object.entries(afterElements)) {
        if (elementId in beforeElements) continue;
        void Promise.resolve(this.onElementCreate({
          tenantContext: record.tenantContext,
          canvasDocId,
          automergeUrl: handle.url,
          element,
        }, handle)).catch(() => undefined);
      }
    };
    record.handle = handle;
    record.changeListener = listener;
    handle.on('change', listener);
  }

  private detachHandle(record: TDocumentRecord): void {
    if (record.handle !== undefined && record.changeListener !== undefined) {
      record.handle.off('change', record.changeListener);
    }
    record.handle = undefined;
    record.changeListener = undefined;
  }

  private handleDocumentPeerChange(event: TAutomergePeerDocumentEvent): void {
    const record = this.documentRecords.get(
      fnAutomergeDocumentScopeKey(event.tenantContext.orgId, event.automergeUrl),
    );
    if (record === undefined) return;
    record.peerCount = Math.max(0, record.peerCount + event.delta);
    record.lastAccessAt = Date.now();
  }

  private async ensureDocumentCapacity(): Promise<void> {
    if (this.documentRecords.size < this.maxActiveDocuments) return;
    const candidates = [...this.documentRecords.values()]
      .filter((record) => record.peerCount === 0 && this.canEvictHandle(record))
      .sort((left, right) => left.lastAccessAt - right.lastAccessAt);
    const candidate = candidates[0];
    if (candidate === undefined) throw new Error(AUTOMERGE_CAPACITY_UNAVAILABLE_MESSAGE);
    await this.evictRecord(candidate);
    if (this.documentRecords.size >= this.maxActiveDocuments) {
      throw new Error(AUTOMERGE_CAPACITY_UNAVAILABLE_MESSAGE);
    }
  }

  private async evictIdleDocuments(): Promise<void> {
    const cutoff = Date.now() - this.documentIdleMs;
    const candidates = [...this.documentRecords.values()]
      .filter((record) => record.peerCount === 0)
      .filter((record) => record.lastAccessAt <= cutoff)
      .filter((record) => this.canEvictHandle(record));
    for (const record of candidates) await this.evictRecord(record);
  }

  private canEvictHandle(record: TDocumentRecord): boolean {
    return this.storageAdapter?.isDocumentRegistered(record.tenantContext, record.automergeUrl) === true
      && (record.handle === undefined || record.handle.isReady());
  }

  private async evictRecord(record: TDocumentRecord): Promise<void> {
    if (
      this.documentRecords.get(record.scopeKey) !== record
      || record.peerCount > 0
      || !this.canEvictHandle(record)
    ) return;
    const handle = record.handle;
    if (handle !== undefined && handle.isReady()) {
      if (this.storage.isDocumentRegistered(record.tenantContext, record.automergeUrl)) {
        await this.repo.flush([handle.documentId]);
      }
      this.detachHandle(record);
      await this.repo.removeFromCache(handle.documentId);
    } else {
      this.detachHandle(record);
    }
    this.documentRecords.delete(record.scopeKey);
    this.storage.releaseDocument(record.tenantContext, record.automergeUrl);
    this.incrementTenantCounter(this.evictionsByTenant, record.orgId);
  }

  private runLifecycleTask<T>(task: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.catch(() => undefined).then(task);
    this.lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private incrementTenantCounter(target: Map<string, number>, orgId: string): void {
    const key = fnAutomergeOrganizationScopeKey(orgId);
    target.set(key, (target.get(key) ?? 0) + 1);
  }

  private unavailableError(): Error {
    return new Error(AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE);
  }

  private requirePositiveInteger(value: number, name: string): number {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
    return value;
  }

  private requireNonNegativeInteger(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
    return value;
  }
}
