import * as Automerge from '@automerge/automerge';
import {
  isValidAutomergeUrl,
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
import type { TAutomergeStorageDocumentContent } from './adapters/turso.adapter';
import {
  BunWSServerAdapter,
  type TAutomergeManagedDocumentAdmission,
  type TAutomergePeerDocumentEvent,
  type WebSocketWithIsAlive,
} from './adapters/websocket.adapter';
import {
  fnAutomergeDocumentKeyFromUrl,
  fnAutomergeDocumentScopeKey,
  fnAutomergeOrganizationScopeKey,
  fnAutomergeScopedKey,
} from './core/fn.automerge-document';
import { fnAssertWidgetCollaborativeStateEncodedQuota } from './core/fn.widget-collaborative-state';
import type { IAutomergeService } from './IAutomergeService';
import type {
  TAutomergeElementEvent as TAutomergeElementEventBase,
  TAutomergeServiceOptions,
  TAutomergeTenantMetrics,
} from './types/automerge-service.types';
import type { TCanvasDoc, TElement } from './types/canvas-doc.types';
import type { TAutomergeDocumentAuthorization } from './types/widget-state.types';

export type TAutomergeStorageConfig = TursoDatabase | { type: 'turso'; database: TursoDatabase };
export type TAutomergeElementEvent = TAutomergeElementEventBase<TElement>;

export type TAutomergeDocumentSnapshotEvent = Readonly<{
  tenantContext: TTenantContext;
  automergeUrl: string;
  canvasId: string;
  sourceSequence: number;
  elements: TCanvasDoc['elements'];
}>;

export type TAutomergeDocumentReleaseEvent = Readonly<{
  tenantContext: TTenantContext;
  automergeUrl: string;
  canvasId: string;
}>;

export type TAutomergeCallbacks = {
  authorizeDocument: (tenantContext: TTenantContext, automergeUrl: string) => boolean | Promise<boolean>;
  onElementDelete: (event: TAutomergeElementEvent, handle: DocHandle<TCanvasDoc>) => void | Promise<void>;
  onElementCreate: (event: TAutomergeElementEvent, handle: DocHandle<TCanvasDoc>) => void | Promise<void>;
  onDocumentSnapshot?: (event: TAutomergeDocumentSnapshotEvent) => void;
  onDocumentRelease?: (event: TAutomergeDocumentReleaseEvent) => void | Promise<void>;
};

type TDocumentRecord = {
  scopeKey: string;
  orgId: string;
  automergeUrl: string;
  tenantContext: TTenantContext;
  lastAccessAt: number;
  peerCount: number;
  localLeaseCount: number;
  localLeaseCountsByTenant: Map<string, number>;
  pendingAdmissionIds: Set<number>;
  retained: boolean;
  deleting: boolean;
  evictWhenUnreserved: boolean;
  handle?: DocHandle<TCanvasDoc>;
  changeListener?: (payload: DocHandleChangePayload<TCanvasDoc>) => void;
};

type TDocumentAdmissionReservation = Readonly<{
  id: number;
  record: TDocumentRecord;
  tenantContext: TTenantContext;
  automergeUrl: string;
  authorization: TAutomergeDocumentAuthorization;
}>;

export class AutomergeService implements IAutomergeService {
  readonly name = 'automerge' as const;
  private repoInstance: Repo | null = null;
  private storageAdapter: TursoStorageAdapter | null = null;
  private readonly wsAdapter: BunWSServerAdapter;
  private readonly documentRecords = new Map<string, TDocumentRecord>();
  private admissionReservationSequence = 0;
  private stopping = false;
  private admissionAbortController = new AbortController();
  private readonly pendingAdmissionTasks = new Set<Promise<unknown>>();
  private readonly pendingPreflightTasks = new Set<Promise<unknown>>();
  private readonly evictionsByTenant = new Map<string, number>();
  private readonly denialsByTenant = new Map<string, number>();
  private readonly persistedProjectionDocuments = new Map<DocumentId, Automerge.Doc<TCanvasDoc>>();
  private projectionReplicationFailure: unknown = null;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private lifecycleSweepInterval: ReturnType<typeof setInterval> | null = null;
  private lifecycleSweepTask: Promise<void> | null = null;
  private readonly authorizeDocument: TAutomergeCallbacks['authorizeDocument'];
  private readonly onElementDelete: TAutomergeCallbacks['onElementDelete'];
  private readonly onElementCreate: TAutomergeCallbacks['onElementCreate'];
  private readonly onDocumentSnapshot: NonNullable<TAutomergeCallbacks['onDocumentSnapshot']>;
  private readonly onDocumentRelease: NonNullable<TAutomergeCallbacks['onDocumentRelease']>;
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
    this.onDocumentSnapshot = callbacks.onDocumentSnapshot ?? (() => undefined);
    this.onDocumentRelease = callbacks.onDocumentRelease ?? (() => undefined);
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
      admitDocument: (tenantContext, automergeUrl, signal) => (
        this.reserveManagedDocumentAdmission(tenantContext, automergeUrl, signal)
      ),
      admitWidgetStateSync: (tenantContext, automergeUrl, syncMessage, signal) => (
        this.preflightWidgetStateSync(tenantContext, automergeUrl, syncMessage, signal)
      ),
      onDocumentPeerChange: (event) => this.handleDocumentPeerChange(event),
      onDocumentDenied: (tenantContext) => this.incrementTenantCounter(this.denialsByTenant, tenantContext.orgId),
    });
  }

  start(): void {
    if (this.repoInstance !== null) return;
    this.stopping = false;
    this.admissionAbortController = new AbortController();

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
      this.scheduleLifecycleSweep();
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
    const frozenTenantContext = this.rememberTenantContext(tenantContext);
    const admission = await this.reserveDocumentAdmission(frozenTenantContext, automergeUrl);
    if (admission === null) {
      this.incrementTenantCounter(this.denialsByTenant, frozenTenantContext.orgId);
      throw this.unavailableError();
    }

    try {
      return await this.runLifecycleTask(async () => {
        const record = this.requireAdmissionReservation(admission);
        const progress = this.repo.findWithProgress<T>(automergeUrl as never);
        this.attachHandle(record, progress.handle as unknown as DocHandle<TCanvasDoc>);
        const handle = await this.repo.find<T>(automergeUrl as never);
        this.attachHandle(record, handle as unknown as DocHandle<TCanvasDoc>);
        if (!this.retainAdmissionAsLocalLease(admission)) throw this.unavailableError();
        record.lastAccessAt = Date.now();
        return handle;
      });
    } catch (error) {
      await this.releaseAdmissionReservation(admission);
      throw error;
    }
  }

  async deleteDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<void> {
    const frozenTenantContext = fnFreezeTenantContext(tenantContext);
    if (!this.isCanonicalAutomergeUrl(automergeUrl)) throw this.unavailableError();
    const admission = await this.reserveDocumentAdmission(frozenTenantContext, automergeUrl);
    if (admission === null) {
      this.incrementTenantCounter(this.denialsByTenant, frozenTenantContext.orgId);
      throw this.unavailableError();
    }

    let deleteStarted = false;
    try {
      await this.runLifecycleTask(async () => {
        const record = this.requireAdmissionReservation(admission);
        deleteStarted = true;
        record.deleting = true;
        const releaseEvent = this.createDocumentReleaseEvent(record);
        const handle = this.cachedHandle(record);
        try {
          if (handle !== undefined && handle.isReady()) {
            await this.repo.flush([handle.documentId]);
          }
          if (releaseEvent !== null) await this.onDocumentRelease(releaseEvent);
          this.detachHandle(record);
          this.repo.delete(automergeUrl as never);
          this.documentRecords.delete(record.scopeKey);
          this.releasePersistedProjectionDocument(
            fnAutomergeDocumentKeyFromUrl(automergeUrl) as DocumentId,
          );
          this.storage.forgetDocument(frozenTenantContext, automergeUrl);
        } catch (error) {
          record.deleting = false;
          record.pendingAdmissionIds.delete(admission.id);
          record.retained = true;
          record.lastAccessAt = Date.now();
          throw error;
        }
      });
    } catch (error) {
      if (!deleteStarted) await this.releaseAdmissionReservation(admission);
      throw error;
    }
  }

  async admitDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<boolean> {
    const admission = await this.reserveDocumentAdmission(tenantContext, automergeUrl);
    if (admission === null) return false;
    if (await this.retainAdmission(admission)) return true;
    await this.releaseAdmissionReservation(admission);
    return false;
  }

  private async reserveManagedDocumentAdmission(
    tenantContext: TTenantContext,
    automergeUrl: string,
    signal?: AbortSignal,
  ): Promise<TAutomergeManagedDocumentAdmission | null> {
    const admission = await this.reserveDocumentAdmission(tenantContext, automergeUrl, signal);
    if (admission === null) return null;
    let settled = false;
    return Object.freeze({
      authorization: admission.authorization,
      retainPeer: (alreadyRetained: boolean): boolean => {
        if (settled) return false;
        const retained = this.retainAdmissionAsPeer(admission, alreadyRetained);
        if (retained) settled = true;
        return retained;
      },
      release: async (): Promise<void> => {
        if (settled) return;
        settled = true;
        await this.releaseAdmissionReservation(admission);
      },
    });
  }

  async releaseDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<void> {
    const frozenTenantContext = fnFreezeTenantContext(tenantContext);
    if (!this.isCanonicalAutomergeUrl(automergeUrl)) return;
    const scopeKey = fnAutomergeDocumentScopeKey(frozenTenantContext.orgId, automergeUrl);
    const leasedRecord = this.documentRecords.get(scopeKey);
    const releasesKnownLease = leasedRecord !== undefined
      && this.hasLocalDocumentLease(leasedRecord, frozenTenantContext);
    const authorizedManualRelease = releasesKnownLease
      ? false
      : await this.admitDocument(frozenTenantContext, automergeUrl);
    if (!releasesKnownLease && !authorizedManualRelease) return;

    await this.runLifecycleTask(async () => {
      const record = this.documentRecords.get(scopeKey);
      if (record === undefined) return;
      if (releasesKnownLease) {
        if (
          record !== leasedRecord
          || !this.releaseLocalDocumentLease(record, frozenTenantContext)
        ) return;
      } else if (!authorizedManualRelease || record.localLeaseCount > 0) {
        return;
      }
      record.lastAccessAt = 0;
      if (record.peerCount === 0) {
        if (record.pendingAdmissionIds.size > 0) record.evictWhenUnreserved = true;
        else await this.evictRecord(record, frozenTenantContext);
      }
    });
  }

  async notifyDocumentRegistered(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<void> {
    const frozenTenantContext = this.rememberTenantContext(tenantContext);
    if (!this.isCanonicalAutomergeUrl(automergeUrl)) throw this.unavailableError();
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
    this.stopping = true;
    this.admissionAbortController.abort();
    if (this.lifecycleSweepInterval !== null) {
      clearInterval(this.lifecycleSweepInterval);
      this.lifecycleSweepInterval = null;
    }
    this.wsAdapter.disconnect();
    await this.wsAdapter.drainDocumentMessages();
    while (this.pendingAdmissionTasks.size > 0 || this.pendingPreflightTasks.size > 0) {
      await Promise.allSettled([
        ...this.pendingAdmissionTasks,
        ...this.pendingPreflightTasks,
      ]);
    }
    await this.lifecycleTail.catch(() => undefined);
    for (const record of this.documentRecords.values()) record.pendingAdmissionIds.clear();

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
    for (const document of this.persistedProjectionDocuments.values()) Automerge.free(document);
    this.persistedProjectionDocuments.clear();
    this.repoInstance = null;
    this.storageAdapter = null;
    stopFailure ??= this.projectionReplicationFailure ?? undefined;
    this.projectionReplicationFailure = null;
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
    const storageDatabase = 'type' in database ? database.database : database;
    return new TursoStorageAdapter(storageDatabase, {
      onDocumentContentVersion: (version) => this.handleDocumentContentVersion(version),
    });
  }

  private rememberTenantContext(tenantContext: TTenantContext): TTenantContext {
    return fnFreezeTenantContext(tenantContext);
  }

  private preflightWidgetStateSync(
    tenantContext: TTenantContext,
    automergeUrl: string,
    syncMessage: Uint8Array,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (this.admissionCancelled(signal)) return Promise.resolve(false);
    const task = this.runWidgetStateSyncPreflight(
      tenantContext,
      automergeUrl,
      syncMessage,
      signal,
    );
    this.pendingPreflightTasks.add(task);
    void task.finally(() => this.pendingPreflightTasks.delete(task)).catch(() => undefined);
    return task;
  }

  private async runWidgetStateSyncPreflight(
    tenantContext: TTenantContext,
    automergeUrl: string,
    syncMessage: Uint8Array,
    signal?: AbortSignal,
  ): Promise<boolean> {
    let base: Automerge.Doc<unknown> | undefined;
    let prospective: Automerge.Doc<unknown> | undefined;
    try {
      const decoded = Automerge.decodeSyncMessage(syncMessage);
      fnAssertWidgetCollaborativeStateEncodedQuota(
        [],
        decoded.changes.map((change) => change.byteLength),
      );
      if (this.admissionCancelled(signal)) return false;
      if (decoded.changes.length === 0) return true;

      const record = this.documentRecords.get(
        fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
      );
      if (record?.handle?.isReady()) {
        base = Automerge.clone(record.handle.doc() as unknown as Automerge.Doc<unknown>);
      } else {
        base = await this.storage.cloneAdmittedWidgetStateDocument(tenantContext, automergeUrl);
      }
      if (this.admissionCancelled(signal)) return false;
      if (base === undefined) return false;
      prospective = Automerge.clone(base);
      [prospective] = Automerge.receiveSyncMessage(
        prospective,
        Automerge.initSyncState(),
        syncMessage,
      );
      const incomingChanges = Automerge.getChanges(base, prospective);
      await this.storage.preflightWidgetStateSync(
        tenantContext,
        automergeUrl,
        prospective,
        incomingChanges,
      );
      return !this.admissionCancelled(signal);
    } catch {
      return false;
    } finally {
      if (prospective !== undefined) Automerge.free(prospective);
      if (base !== undefined) Automerge.free(base);
    }
  }

  private async isDocumentAuthorized(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<boolean> {
    return await this.authorizeDocument(tenantContext, automergeUrl);
  }

  private admissionCancelled(signal?: AbortSignal): boolean {
    return this.stopping
      || this.admissionAbortController.signal.aborted
      || signal?.aborted === true;
  }

  private async resolveAdmissionAuthorization(
    tenantContext: TTenantContext,
    automergeUrl: string,
    signal?: AbortSignal,
  ): Promise<Readonly<{ authorized: boolean; aborted: boolean }>> {
    const serviceSignal = this.admissionAbortController.signal;
    if (this.admissionCancelled(signal)) return { authorized: false, aborted: true };
    const operation = this.isDocumentAuthorized(tenantContext, automergeUrl);
    return await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (result: () => void): void => {
        if (settled) return;
        settled = true;
        serviceSignal.removeEventListener('abort', onAbort);
        signal?.removeEventListener('abort', onAbort);
        result();
      };
      const onAbort = (): void => settle(() => resolve({ authorized: false, aborted: true }));
      serviceSignal.addEventListener('abort', onAbort, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
      void operation.then(
        (authorized) => settle(() => resolve({ authorized, aborted: false })),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  private reserveDocumentAdmission(
    tenantContext: TTenantContext,
    automergeUrl: string,
    signal?: AbortSignal,
  ): Promise<TDocumentAdmissionReservation | null> {
    if (this.admissionCancelled(signal)) return Promise.resolve(null);
    const task = this.runDocumentAdmissionReservation(tenantContext, automergeUrl, signal);
    this.pendingAdmissionTasks.add(task);
    void task.finally(() => this.pendingAdmissionTasks.delete(task)).catch(() => undefined);
    return task;
  }

  private async runDocumentAdmissionReservation(
    tenantContext: TTenantContext,
    automergeUrl: string,
    signal?: AbortSignal,
  ): Promise<TDocumentAdmissionReservation | null> {
    if (!this.isCanonicalAutomergeUrl(automergeUrl)) return null;
    const frozenTenantContext = this.rememberTenantContext(tenantContext);
    const initialPolicy = await this.resolveAdmissionAuthorization(
      frozenTenantContext,
      automergeUrl,
      signal,
    );
    if (!initialPolicy.authorized) return null;
    if (this.admissionCancelled(signal)) return null;
    const initialAuthorization = await this.storage.admitDocumentAccess(
      frozenTenantContext,
      automergeUrl,
    );
    if (initialAuthorization === null || this.admissionCancelled(signal)) {
      if (initialAuthorization !== null) {
        await this.releaseUnreservedDocumentAdmission(frozenTenantContext, automergeUrl);
      }
      return null;
    }

    let pending: Readonly<{ id: number; record: TDocumentRecord }> | null = null;
    try {
      pending = await this.runLifecycleTask(async () => {
        if (this.admissionCancelled(signal)) throw this.unavailableError();
        const scopeKey = fnAutomergeDocumentScopeKey(frozenTenantContext.orgId, automergeUrl);
        let record = this.documentRecords.get(scopeKey);
        if (record === undefined) {
          await this.ensureDocumentCapacity();
          record = this.createDocumentRecord(frozenTenantContext, automergeUrl, false);
          this.documentRecords.set(record.scopeKey, record);
        }
        if (record.deleting) throw this.unavailableError();
        const id = this.admissionReservationSequence++;
        record.pendingAdmissionIds.add(id);
        record.lastAccessAt = Date.now();
        return Object.freeze({ id, record });
      });
      const finalPolicy = await this.resolveAdmissionAuthorization(
        frozenTenantContext,
        automergeUrl,
        signal,
      );
      if (!finalPolicy.authorized) {
        await this.releaseAdmissionReservation({
          ...pending,
          tenantContext: frozenTenantContext,
          automergeUrl,
          authorization: initialAuthorization,
        }, !finalPolicy.aborted);
        return null;
      }
      if (this.admissionCancelled(signal)) {
        await this.releaseAdmissionReservation({
          ...pending,
          tenantContext: frozenTenantContext,
          automergeUrl,
          authorization: initialAuthorization,
        });
        return null;
      }
      const authorization = await this.storage.admitDocumentAccess(
        frozenTenantContext,
        automergeUrl,
      );
      if (authorization === null || this.admissionCancelled(signal)) {
        await this.releaseAdmissionReservation({
          ...pending,
          tenantContext: frozenTenantContext,
          automergeUrl,
          authorization: initialAuthorization,
        }, authorization === null);
        return null;
      }
      return Object.freeze({
        ...pending,
        tenantContext: frozenTenantContext,
        automergeUrl,
        authorization,
      });
    } catch (error) {
      if (pending !== null) {
        await this.releaseAdmissionReservation({
          ...pending,
          tenantContext: frozenTenantContext,
          automergeUrl,
          authorization: initialAuthorization,
        }, !this.admissionCancelled(signal));
      } else {
        await this.releaseUnreservedDocumentAdmission(frozenTenantContext, automergeUrl);
      }
      if (
        error instanceof Error
        && (
          error.message === AUTOMERGE_CAPACITY_UNAVAILABLE_MESSAGE
          || error.message === AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE
        )
      ) return null;
      throw error;
    }
  }

  private async releaseUnreservedDocumentAdmission(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<void> {
    await this.runLifecycleTask(async () => {
      const record = this.documentRecords.get(
        fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
      );
      if (record === undefined) this.storage.releaseDocument(tenantContext, automergeUrl);
    });
  }

  private async releaseAdmissionReservation(
    admission: TDocumentAdmissionReservation,
    revokeAccess = false,
  ): Promise<void> {
    await this.runLifecycleTask(async () => {
      try {
        const record = this.documentRecords.get(admission.record.scopeKey);
        if (
          record !== admission.record
          || !record.pendingAdmissionIds.delete(admission.id)
        ) return;
        if (
          record.pendingAdmissionIds.size === 0
          && record.localLeaseCount === 0
          && record.peerCount === 0
          && (!record.retained || record.evictWhenUnreserved)
        ) await this.evictRecord(record, admission.tenantContext);
      } finally {
        if (revokeAccess) {
          this.storage.releaseDocumentAccess(admission.tenantContext, admission.automergeUrl);
        }
      }
    });
  }

  private async retainAdmission(
    admission: TDocumentAdmissionReservation,
  ): Promise<boolean> {
    return await this.runLifecycleTask(async () => {
      const record = this.documentRecords.get(admission.record.scopeKey);
      if (
        record !== admission.record
        || record.deleting
        || !record.pendingAdmissionIds.delete(admission.id)
      ) return false;
      record.retained = true;
      record.evictWhenUnreserved = false;
      record.lastAccessAt = Date.now();
      return true;
    });
  }

  private retainAdmissionAsLocalLease(
    admission: TDocumentAdmissionReservation,
  ): boolean {
    const record = this.documentRecords.get(admission.record.scopeKey);
    if (
      record !== admission.record
      || record.deleting
      || !record.pendingAdmissionIds.delete(admission.id)
    ) return false;
    record.retained = true;
    record.evictWhenUnreserved = false;
    this.acquireLocalDocumentLease(record, admission.tenantContext);
    return true;
  }

  private retainAdmissionAsPeer(
    admission: TDocumentAdmissionReservation,
    alreadyRetained: boolean,
  ): boolean {
    const record = this.documentRecords.get(admission.record.scopeKey);
    if (
      record !== admission.record
      || record.deleting
      || (alreadyRetained && record.peerCount === 0)
      || !record.pendingAdmissionIds.delete(admission.id)
    ) return false;
    if (!alreadyRetained) record.peerCount += 1;
    record.retained = true;
    record.evictWhenUnreserved = false;
    record.lastAccessAt = Date.now();
    return true;
  }

  private requireAdmissionReservation(
    admission: TDocumentAdmissionReservation,
  ): TDocumentRecord {
    const record = this.documentRecords.get(admission.record.scopeKey);
    if (
      record !== admission.record
      || record.deleting
      || !record.pendingAdmissionIds.has(admission.id)
    ) throw this.unavailableError();
    return record;
  }

  private createDocumentRecord(
    tenantContext: TTenantContext,
    automergeUrl: string,
    retained = true,
  ): TDocumentRecord {
    return {
      scopeKey: fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
      orgId: tenantContext.orgId,
      automergeUrl,
      tenantContext,
      lastAccessAt: Date.now(),
      peerCount: 0,
      localLeaseCount: 0,
      localLeaseCountsByTenant: new Map(),
      pendingAdmissionIds: new Set(),
      retained,
      deleting: false,
      evictWhenUnreserved: false,
    };
  }

  private localDocumentLeaseKey(tenantContext: TTenantContext): string {
    return fnAutomergeScopedKey('automerge-local-document-lease', [
      tenantContext.orgId,
      tenantContext.accountId,
      tenantContext.cellId,
      String(tenantContext.placementEpoch),
      tenantContext.requestId,
      tenantContext.canvasId === undefined ? '0' : '1',
      tenantContext.canvasId ?? '',
      tenantContext.invocationId === undefined ? '0' : '1',
      tenantContext.invocationId ?? '',
    ]);
  }

  private hasLocalDocumentLease(
    record: TDocumentRecord,
    tenantContext: TTenantContext,
  ): boolean {
    return record.localLeaseCountsByTenant.has(this.localDocumentLeaseKey(tenantContext));
  }

  private acquireLocalDocumentLease(
    record: TDocumentRecord,
    tenantContext: TTenantContext,
  ): void {
    const leaseKey = this.localDocumentLeaseKey(tenantContext);
    record.localLeaseCountsByTenant.set(
      leaseKey,
      (record.localLeaseCountsByTenant.get(leaseKey) ?? 0) + 1,
    );
    record.localLeaseCount += 1;
  }

  private releaseLocalDocumentLease(
    record: TDocumentRecord,
    tenantContext: TTenantContext,
  ): boolean {
    const leaseKey = this.localDocumentLeaseKey(tenantContext);
    const leaseCount = record.localLeaseCountsByTenant.get(leaseKey);
    if (leaseCount === undefined) return false;
    if (leaseCount === 1) record.localLeaseCountsByTenant.delete(leaseKey);
    else record.localLeaseCountsByTenant.set(leaseKey, leaseCount - 1);
    record.localLeaseCount -= 1;
    return true;
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
    if (record.handle === handle && record.changeListener !== undefined) {
      this.emitPersistedProjection(record, handle);
      return;
    }
    this.detachHandle(record);
    const listener = ({ patchInfo }: DocHandleChangePayload<TCanvasDoc>) => {
      record.lastAccessAt = Date.now();
      const before = patchInfo.before as TCanvasDoc | undefined;
      const after = patchInfo.after as TCanvasDoc | undefined;
      this.seedPersistedProjectionFromStorageLoad(record, handle, after);
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
    this.emitPersistedProjection(record, handle);
  }

  private seedPersistedProjectionFromStorageLoad(
    record: TDocumentRecord,
    handle: DocHandle<TCanvasDoc>,
    after: TCanvasDoc | undefined,
  ): void {
    if (
      handle.isReady()
      || after === undefined
      || this.persistedProjectionDocuments.has(handle.documentId)
    ) return;
    const identity = this.storageAdapter?.getAdmittedDocumentIdentity(
      record.tenantContext,
      record.automergeUrl,
    );
    if (
      identity === undefined
      || this.storageAdapter?.hasAdmittedDocumentContent(
        record.tenantContext,
        record.automergeUrl,
      ) !== true
    ) return;
    try {
      this.persistedProjectionDocuments.set(
        handle.documentId,
        Automerge.clone(after as Automerge.Doc<TCanvasDoc>),
      );
    } catch (error) {
      this.recordProjectionReplicationFailure(error);
    }
  }

  private handleDocumentContentVersion(version: TAutomergeStorageDocumentContent): void {
    if (version.canvasId === null) return;
    const record = this.documentRecords.get(
      fnAutomergeDocumentScopeKey(version.orgId, version.automergeUrl),
    );
    if (record === undefined) return;
    const documentId = fnAutomergeDocumentKeyFromUrl(version.automergeUrl) as DocumentId;
    const existing = this.persistedProjectionDocuments.get(documentId);
    const previous = existing ?? Automerge.init<TCanvasDoc>();
    try {
      const persistedDocument = Automerge.loadIncremental(previous, version.contentBytes);
      this.persistedProjectionDocuments.set(documentId, persistedDocument);
      this.onDocumentSnapshot(Object.freeze({
        tenantContext: record.tenantContext,
        automergeUrl: version.automergeUrl,
        canvasId: version.canvasId,
        sourceSequence: version.contentVersion,
        elements: persistedDocument.elements,
      }));
    } catch (error) {
      if (existing === undefined) Automerge.free(previous);
      this.recordProjectionReplicationFailure(error);
    }
  }

  private emitPersistedProjection(record: TDocumentRecord, handle: DocHandle<TCanvasDoc>): void {
    const identity = this.storageAdapter?.getAdmittedDocumentIdentity(
      record.tenantContext,
      record.automergeUrl,
    );
    if (identity?.canvasId === null || identity === undefined) return;
    const persistedDocument = this.persistedProjectionDocuments.get(handle.documentId);
    if (persistedDocument === undefined) return;
    try {
      this.onDocumentSnapshot(Object.freeze({
        tenantContext: record.tenantContext,
        automergeUrl: identity.automergeUrl,
        canvasId: identity.canvasId,
        sourceSequence: identity.contentVersion,
        elements: persistedDocument.elements,
      }));
    } catch (error) {
      this.recordProjectionReplicationFailure(error);
    }
  }

  private detachHandle(record: TDocumentRecord): void {
    if (record.handle !== undefined && record.changeListener !== undefined) {
      record.handle.off('change', record.changeListener);
    }
    record.handle = undefined;
    record.changeListener = undefined;
  }

  private handleDocumentPeerChange(event: TAutomergePeerDocumentEvent): boolean {
    const record = this.documentRecords.get(
      fnAutomergeDocumentScopeKey(event.tenantContext.orgId, event.automergeUrl),
    );
    if (record === undefined || (event.delta > 0 && record.deleting)) return false;
    record.peerCount = Math.max(0, record.peerCount + event.delta);
    record.lastAccessAt = Date.now();
    return true;
  }

  private async ensureDocumentCapacity(): Promise<void> {
    if (this.documentRecords.size < this.maxActiveDocuments) return;
    const candidates = [...this.documentRecords.values()]
      .filter((record) => (
        record.peerCount === 0
        && record.localLeaseCount === 0
        && record.pendingAdmissionIds.size === 0
        && !record.deleting
        && this.canEvictHandle(record)
      ))
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
      .filter((record) => (
        record.peerCount === 0
        && record.localLeaseCount === 0
        && record.pendingAdmissionIds.size === 0
        && !record.deleting
      ))
      .filter((record) => record.lastAccessAt <= cutoff)
      .filter((record) => this.canEvictHandle(record));
    for (const record of candidates) await this.evictRecord(record);
  }

  private canEvictHandle(record: TDocumentRecord): boolean {
    const handle = this.cachedHandle(record);
    return this.storageAdapter?.isDocumentRegistered(record.tenantContext, record.automergeUrl) === true
      && (
        handle === undefined
        || handle.isReady()
        || handle.isUnavailable()
        || handle.isUnloaded()
        || handle.isDeleted()
      );
  }

  private async evictRecord(
    record: TDocumentRecord,
    releasingTenantContext?: TTenantContext,
  ): Promise<void> {
    if (
      this.documentRecords.get(record.scopeKey) !== record
      || record.peerCount > 0
      || record.localLeaseCount > 0
      || record.pendingAdmissionIds.size > 0
      || record.deleting
      || !this.canEvictHandle(record)
    ) return;
    const releaseEvent = this.createDocumentReleaseEvent(record);
    const handle = this.cachedHandle(record);
    if (handle !== undefined && handle.isReady()) {
      if (this.storage.isDocumentRegistered(record.tenantContext, record.automergeUrl)) {
        try {
          await this.repo.flush([handle.documentId]);
        } catch (error) {
          if (
            releasingTenantContext === undefined
            || await this.hasCurrentDocumentAuthority(releasingTenantContext, record.automergeUrl)
          ) throw error;
        }
      }
      if (releaseEvent !== null) await this.onDocumentRelease(releaseEvent);
      this.detachHandle(record);
      await this.repo.removeFromCache(handle.documentId);
    } else if (
      handle !== undefined
      && (handle.isUnavailable() || handle.isUnloaded() || handle.isDeleted())
    ) {
      if (releaseEvent !== null) await this.onDocumentRelease(releaseEvent);
      this.detachHandle(record);
      await this.repo.removeFromCache(handle.documentId);
    } else {
      if (releaseEvent !== null) await this.onDocumentRelease(releaseEvent);
      this.detachHandle(record);
    }
    this.documentRecords.delete(record.scopeKey);
    const projectionDocumentId = handle?.documentId
      ?? fnAutomergeDocumentKeyFromUrl(record.automergeUrl) as DocumentId;
    this.releasePersistedProjectionDocument(projectionDocumentId);
    this.storage.releaseDocument(record.tenantContext, record.automergeUrl);
    this.incrementTenantCounter(this.evictionsByTenant, record.orgId);
  }

  private async hasCurrentDocumentAuthority(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<boolean> {
    if (!await this.isDocumentAuthorized(tenantContext, automergeUrl)) return false;
    return await this.storage.admitDocumentAccess(tenantContext, automergeUrl) !== null;
  }

  private cachedHandle(record: TDocumentRecord): DocHandle<TCanvasDoc> | undefined {
    return record.handle ?? this.repoInstance?.handles[
      fnAutomergeDocumentKeyFromUrl(record.automergeUrl) as DocumentId
    ];
  }

  private recordProjectionReplicationFailure(error: unknown): void {
    this.projectionReplicationFailure ??= error instanceof Error
      ? error
      : new Error(String(error));
  }

  private createDocumentReleaseEvent(
    record: TDocumentRecord,
  ): TAutomergeDocumentReleaseEvent | null {
    const identity = this.storage.getAdmittedDocumentIdentity(
      record.tenantContext,
      record.automergeUrl,
    );
    if (identity?.canvasId === null || identity?.canvasId === undefined) return null;
    return Object.freeze({
      tenantContext: record.tenantContext,
      automergeUrl: record.automergeUrl,
      canvasId: identity.canvasId,
    });
  }

  private releasePersistedProjectionDocument(documentId: DocumentId): void {
    const document = this.persistedProjectionDocuments.get(documentId);
    if (document === undefined) return;
    Automerge.free(document);
    this.persistedProjectionDocuments.delete(documentId);
  }

  private scheduleLifecycleSweep(): void {
    if (this.lifecycleSweepTask !== null) return;
    const task = this.runLifecycleTask(async () => this.evictIdleDocuments());
    this.lifecycleSweepTask = task;
    void task.catch(() => undefined).finally(() => {
      if (this.lifecycleSweepTask === task) this.lifecycleSweepTask = null;
    });
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

  private isCanonicalAutomergeUrl(value: string): boolean {
    return isValidAutomergeUrl(value) && !value.includes('#');
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
