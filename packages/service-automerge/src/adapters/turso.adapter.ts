import * as Automerge from '@automerge/automerge';
import type {
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from '@automerge/automerge-repo';
import { isValidAutomergeUrl } from '@automerge/automerge-repo';
import type { Database } from '@tursodatabase/database';
import { txRunSerializedOperation } from '@vibecanvas/shared-functions/tx.run-serialized-operation';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE,
  AUTOMERGE_STORAGE_ADAPTER_ID,
  MAX_AUTOMERGE_DOCUMENT_WRITE_AUTHORITIES,
  MAX_WIDGET_STATE_MUTATION_RESERVATIONS_PER_DOCUMENT,
  MAX_WIDGET_STATE_MUTATION_RATE_LEDGERS,
  WIDGET_STATE_MUTATION_RATE_LIMIT,
  WIDGET_STATE_MUTATION_RESERVATION_TTL_MS,
  WIDGET_STATE_MUTATION_RATE_WINDOW_MS,
} from '../CONSTANTS';
import {
  fnAutomergeDocumentKeyFromUrl,
  fnAutomergeDocumentScopeKey,
  fnAutomergeUrlFromDocumentKey,
} from '../core/fn.automerge-document';
import {
  fnAssertWidgetCollaborativeStateEncodedQuota,
  fnAssertWidgetCollaborativeStateDocument,
  fnWidgetCollaborativeStateIdentitiesMatch,
} from '../core/fn.widget-collaborative-state';
import type { TWidgetCollaborativeStateChunkByteLength } from '../core/fn.widget-collaborative-state';
import type {
  TAutomergeDocumentAccess,
  TAutomergeDocumentAuthorization,
  TWidgetCollaborativeStateIdentity,
} from '../types/widget-state.types';

export type TAutomergeStorageDocumentVersion = Readonly<{
  orgId: string;
  documentId: string;
  canvasId: string | null;
  automergeUrl: string;
  contentVersion: number;
}>;

export type TAutomergeStorageDocumentContent = TAutomergeStorageDocumentVersion & Readonly<{
  contentBytes: Uint8Array;
  contentKind: 'snapshot' | 'incremental';
}>;

export type TAutomergeStorageAdapterOptions = Readonly<{
  separator?: string;
  maxPendingWrites?: number;
  maxPendingBytes?: number;
  widgetStateMutationRateLimit?: number;
  widgetStateMutationRateWindowMs?: number;
  maxWidgetStateMutationRateLedgers?: number;
  widgetStateMutationReservationTtlMs?: number;
  maxWidgetStateMutationReservationsPerDocument?: number;
  nowMs?: () => number;
  onDocumentContentVersion?: (version: TAutomergeStorageDocumentContent) => void;
}>;

type TData = { chunk_bytes: Uint8Array };
type TRangeData = { chunk_key: string; chunk_bytes: Uint8Array };
type TDocumentData = {
  id: string;
  document_canvas_id: string | null;
  widget_instance_id: string | null;
  automerge_url: string;
  content_version: number;
  owner_canvas_id: string;
  member_role: string;
  element_id: string | null;
  definition_id: string | null;
  revision_id: string | null;
};
type TDocumentChunkData = {
  chunk_key: string;
  chunk_bytes: Uint8Array;
  sequence: number;
};
type TDocumentOwnerCountData = { owner_count: number };
type TSequenceData = { sequence: number };
type TNextSequenceData = { next_sequence: number };
type TContentVersionData = { content_version: number };
type TPendingWrite = {
  key: StorageKey;
  binary: Uint8Array;
  resolve: () => void;
  reject: (error: Error) => void;
};

type TWidgetStateMutationCharge = Readonly<{
  timestamp: number;
  changeCount: number;
  reservedChangeHashes: readonly string[];
}>;

type TWidgetStateMutationReservation = Readonly<{
  timestamp: number;
}>;

type TDocumentAdmission = TAutomergeStorageDocumentVersion & Readonly<{
  documentKey: string;
  scopeKey: string;
  hasPersistedContent: boolean;
  access: TAutomergeDocumentAccess;
}>;

type TDocumentWriteAuthority = Readonly<{
  accountId: string;
  canvasFence: string | null;
}>;

type TDocumentClaim = Readonly<{
  orgId: string;
  documentKey: string;
  scopeKey: string;
}>;

export type TAutomergeStorageTenantMetrics = Readonly<{
  pendingWrites: number;
  pendingBytes: number;
}>;

type TTursoStatement = Awaited<ReturnType<Database['prepare']>>;

type TPreparedStatements = {
  findDocument: TTursoStatement;
  findDocumentOwnerCount: TTursoStatement;
  listDocumentChunks: TTursoStatement;
  load: TTursoStatement;
  findSequence: TTursoStatement;
  nextSequence: TTursoStatement;
  insert: TTursoStatement;
  update: TTursoStatement;
  incrementContentVersion: TTursoStatement;
  remove: TTursoStatement;
  loadRange: TTursoStatement;
  removeRange: TTursoStatement;
};

export class TursoStorageAdapter implements StorageAdapterInterface {
  private readonly db: Database;
  private readonly separator: string;
  private readonly maxPendingWrites: number;
  private readonly maxPendingBytes: number;
  private readonly widgetStateMutationRateLimit: number;
  private readonly widgetStateMutationRateWindowMs: number;
  private readonly maxWidgetStateMutationRateLedgers: number;
  private readonly widgetStateMutationReservationTtlMs: number;
  private readonly maxWidgetStateMutationReservationsPerDocument: number;
  private readonly nowMs: () => number;
  private readonly onDocumentContentVersion:
    | ((version: TAutomergeStorageDocumentContent) => void)
    | undefined;
  private readonly admittedDocuments = new Map<string, TDocumentAdmission>();
  private readonly claimedDocuments = new Map<string, TDocumentClaim>();
  private readonly admittedScopeByDocumentKey = new Map<string, string>();
  private readonly documentWriteAuthorities = new Map<string, Map<string, TDocumentWriteAuthority>>();
  private readonly documentAdmissionTails = new Map<string, Promise<unknown>>();
  private readonly pendingWrites = new Map<string, TPendingWrite[]>();
  private readonly documentWriteTails = new Map<string, Promise<void>>();
  private readonly activeWriteOperations = new Set<Promise<void>>();
  private readonly widgetStateDocuments = new Map<string, Automerge.Doc<unknown>>();
  private readonly widgetStateMutationTimes = new Map<string, number[]>();
  private readonly widgetStateLastClock = new Map<string, number>();
  private readonly widgetStateReservedChangeHashes = new Map<
    string,
    Map<string, TWidgetStateMutationReservation>
  >();
  private pendingWriteCount = 0;
  private pendingByteCount = 0;
  private setupPromise: Promise<TPreparedStatements> | null = null;
  private writesSealed = false;
  private disposed = false;

  constructor(database: Database, options?: TAutomergeStorageAdapterOptions) {
    this.db = database;
    this.separator = options?.separator ?? '.';
    this.maxPendingWrites = options?.maxPendingWrites ?? 1024;
    this.maxPendingBytes = options?.maxPendingBytes ?? 64 * 1024 * 1024;
    this.widgetStateMutationRateLimit = this.requirePositiveInteger(
      options?.widgetStateMutationRateLimit ?? WIDGET_STATE_MUTATION_RATE_LIMIT,
      'widgetStateMutationRateLimit',
    );
    this.widgetStateMutationRateWindowMs = this.requirePositiveInteger(
      options?.widgetStateMutationRateWindowMs ?? WIDGET_STATE_MUTATION_RATE_WINDOW_MS,
      'widgetStateMutationRateWindowMs',
    );
    this.maxWidgetStateMutationRateLedgers = this.requirePositiveInteger(
      options?.maxWidgetStateMutationRateLedgers ?? MAX_WIDGET_STATE_MUTATION_RATE_LEDGERS,
      'maxWidgetStateMutationRateLedgers',
    );
    this.widgetStateMutationReservationTtlMs = this.requirePositiveInteger(
      options?.widgetStateMutationReservationTtlMs
        ?? WIDGET_STATE_MUTATION_RESERVATION_TTL_MS,
      'widgetStateMutationReservationTtlMs',
    );
    this.maxWidgetStateMutationReservationsPerDocument = this.requirePositiveInteger(
      options?.maxWidgetStateMutationReservationsPerDocument
        ?? MAX_WIDGET_STATE_MUTATION_RESERVATIONS_PER_DOCUMENT,
      'maxWidgetStateMutationReservationsPerDocument',
    );
    this.nowMs = options?.nowMs ?? Date.now;
    this.onDocumentContentVersion = options?.onDocumentContentVersion;
  }

  claimDocument(tenantContext: TTenantContext, automergeUrl: string): void {
    this.assertAvailable();
    if (!this.isCanonicalAutomergeUrl(automergeUrl)) throw this.unavailableError();
    const claim = this.createClaim(tenantContext, automergeUrl);
    if (!this.bindDocumentKeyToScope(claim.documentKey, claim.scopeKey)) {
      throw this.unavailableError();
    }
    this.claimedDocuments.set(claim.scopeKey, claim);
  }

  async admitDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<boolean> {
    return await this.admitDocumentAccess(tenantContext, automergeUrl) !== null;
  }

  async admitDocumentAccess(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<TAutomergeDocumentAuthorization | null> {
    this.assertAvailable();
    if (!this.isCanonicalAutomergeUrl(automergeUrl)) return null;
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    return await this.runDocumentAdmission(scopeKey, async () => {
      this.assertAvailable();
      return await this.admitDocumentSerialized(
        tenantContext,
        documentKey,
        scopeKey,
      );
    });
  }

  private async admitDocumentSerialized(
    tenantContext: TTenantContext,
    documentKey: string,
    scopeKey: string,
  ): Promise<TAutomergeDocumentAuthorization | null> {
    if (!this.bindDocumentKeyToScope(documentKey, scopeKey)) return null;

    const statements = await this.setup();
    const canonicalAutomergeUrl = fnAutomergeUrlFromDocumentKey(documentKey);
    const row = await this.findAuthorizedDocument(
      statements,
      tenantContext,
      canonicalAutomergeUrl,
    );
    if (row === undefined) {
      this.forgetDocumentWriteAuthority(scopeKey, tenantContext.accountId);
      this.releaseUnusedDocumentScope(documentKey, scopeKey);
      return null;
    }

    const ownerCount = await statements.findDocumentOwnerCount.get(
      canonicalAutomergeUrl,
    ) as TDocumentOwnerCountData | undefined;
    if (ownerCount?.owner_count !== 1) {
      this.forgetDocumentWriteAuthority(scopeKey, tenantContext.accountId);
      this.releaseUnusedDocumentScope(documentKey, scopeKey);
      return null;
    }

    const access = this.toDocumentAccess(row, tenantContext.orgId);
    if (access === null) {
      this.forgetDocumentWriteAuthority(scopeKey, tenantContext.accountId);
      this.releaseUnusedDocumentScope(documentKey, scopeKey);
      return null;
    }
    const authorization = this.toDocumentAuthorization(row, access);
    if (access.kind === 'widget-state') {
      this.pruneExpiredWidgetStateRateLedgers(this.nowMs());
    }

    const cached = this.admittedDocuments.get(scopeKey);
    if (cached !== undefined) {
      if (!this.documentAccessMatches(cached.access, access)) {
        this.forgetDocumentWriteAuthority(scopeKey, tenantContext.accountId);
        return null;
      }
      this.rememberDocumentWriteAuthority(scopeKey, tenantContext, authorization.canWrite);
      return authorization;
    }

    const contentVersion = Number(row.content_version);
    if (!Number.isSafeInteger(contentVersion) || contentVersion < 0) {
      this.releaseUnusedDocumentScope(documentKey, scopeKey);
      throw new Error('Automerge document content version is invalid.');
    }
    const chunks = await statements.listDocumentChunks.all(
      tenantContext.orgId,
      row.id,
    ) as TDocumentChunkData[];
    const hasPersistedContent = chunks.some(({ chunk_key: chunkKey }) => {
      const key = this.stringToKey(chunkKey);
      return key[0] === documentKey && (key[1] === 'snapshot' || key[1] === 'incremental');
    });
    const admission: TDocumentAdmission = Object.freeze({
      orgId: tenantContext.orgId,
      documentId: row.id,
      canvasId: row.document_canvas_id,
      automergeUrl: row.automerge_url,
      contentVersion,
      documentKey,
      scopeKey,
      hasPersistedContent,
      access,
    });

    if (access.kind === 'widget-state') {
      const replica = this.loadWidgetStateReplica(chunks, admission, access.identity);
      if (replica === null) {
        this.releaseUnusedDocumentScope(documentKey, scopeKey);
        return null;
      }
      this.widgetStateDocuments.set(scopeKey, replica);
    }
    this.admittedDocuments.set(scopeKey, admission);
    this.rememberDocumentWriteAuthority(scopeKey, tenantContext, authorization.canWrite);
    this.claimedDocuments.delete(scopeKey);
    try {
      await this.flushPendingWrites(statements, admission);
    } catch (error) {
      this.releaseAdmission(scopeKey, true);
      this.releaseUnusedDocumentScope(documentKey, scopeKey);
      throw error;
    }
    return authorization;
  }

  async notifyDocumentRegistered(tenantContext: TTenantContext, automergeUrl: string): Promise<void> {
    if (!await this.admitDocument(tenantContext, automergeUrl)) {
      throw this.unavailableError();
    }
  }

  failDocumentRegistration(
    tenantContext: TTenantContext,
    automergeUrl: string,
    cause: unknown,
  ): void {
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    if (this.admittedScopeByDocumentKey.get(documentKey) !== scopeKey) return;

    const error = this.toError(cause);
    for (const write of this.takePendingWrites(scopeKey)) write.reject(error);
    this.claimedDocuments.delete(scopeKey);
    this.releaseUnusedDocumentScope(documentKey, scopeKey);
  }

  forgetDocument(tenantContext: TTenantContext, automergeUrl: string): void {
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    if (this.admittedScopeByDocumentKey.get(documentKey) !== scopeKey) return;

    this.releaseAdmission(scopeKey);
    this.claimedDocuments.delete(scopeKey);
    for (const write of this.takePendingWrites(scopeKey)) write.reject(this.unavailableError());
    this.admittedScopeByDocumentKey.delete(documentKey);
  }

  releaseDocument(tenantContext: TTenantContext, automergeUrl: string): void {
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    if (this.admittedScopeByDocumentKey.get(documentKey) !== scopeKey) return;
    if (this.pendingWrites.has(scopeKey)) return;

    this.releaseAdmission(scopeKey, true);
    this.claimedDocuments.delete(scopeKey);
    this.admittedScopeByDocumentKey.delete(documentKey);
  }

  releaseDocumentAccess(tenantContext: TTenantContext, automergeUrl: string): void {
    this.forgetDocumentWriteAuthority(
      fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
      tenantContext.accountId,
    );
  }

  isDocumentAdmitted(tenantContext: TTenantContext, automergeUrl: string): boolean {
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    return this.admittedDocuments.has(scopeKey) || this.claimedDocuments.has(scopeKey);
  }

  isDocumentRegistered(tenantContext: TTenantContext, automergeUrl: string): boolean {
    return this.admittedDocuments.has(fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl));
  }

  getDocumentOrganizationId(automergeUrl: string): string | undefined {
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    const scopeKey = this.admittedScopeByDocumentKey.get(documentKey);
    if (scopeKey === undefined) return undefined;
    return this.admittedDocuments.get(scopeKey)?.orgId ?? this.claimedDocuments.get(scopeKey)?.orgId;
  }

  getAdmittedDocumentIdentity(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): TAutomergeStorageDocumentVersion | undefined {
    const admission = this.admittedDocuments.get(
      fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
    );
    return admission === undefined ? undefined : this.toDocumentVersion(admission);
  }

  getAdmittedDocumentAccess(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): TAutomergeDocumentAccess | undefined {
    return this.admittedDocuments.get(
      fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
    )?.access;
  }

  async cloneAdmittedWidgetStateDocument(
    tenantContext: TTenantContext,
    automergeUrl: string,
  ): Promise<Automerge.Doc<unknown> | undefined> {
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    const statements = await this.setup();
    return await txRunSerializedOperation({ scope: this.db }, {
      operation: async () => {
        const admission = this.admittedDocuments.get(scopeKey);
        const document = this.widgetStateDocuments.get(scopeKey);
        if (admission?.access.kind !== 'widget-state' || document === undefined) return undefined;
        const row = await this.findAuthorizedDocument(
          statements,
          tenantContext,
          admission.automergeUrl,
        );
        const access = row === undefined ? null : this.toDocumentAccess(row, admission.orgId);
        if (access === null || !this.documentAccessMatches(admission.access, access)) return undefined;
        return Automerge.clone(document);
      },
    });
  }

  async preflightWidgetStateSync(
    tenantContext: TTenantContext,
    automergeUrl: string,
    prospectiveDocument: Automerge.Doc<unknown>,
    incomingChanges: readonly Automerge.Change[],
  ): Promise<void> {
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    const statements = await this.setup();
    await txRunSerializedOperation({ scope: this.db }, {
      operation: async () => {
        const admission = this.admittedDocuments.get(scopeKey);
        const durableDocument = this.widgetStateDocuments.get(scopeKey);
        if (
          admission?.access.kind !== 'widget-state'
          || durableDocument === undefined
        ) throw this.unavailableError();
        const currentRow = await this.findAuthorizedDocument(statements, {
          orgId: admission.orgId,
          accountId: tenantContext.accountId,
          ...(tenantContext.canvasId === undefined ? {} : { canvasId: tenantContext.canvasId }),
        }, admission.automergeUrl);
        const currentAccess = currentRow === undefined
          ? null
          : this.toDocumentAccess(currentRow, admission.orgId);
        const ownerCount = await statements.findDocumentOwnerCount.get(
          admission.automergeUrl,
        ) as TDocumentOwnerCountData | undefined;
        if (
          currentRow === undefined
          || currentRow.id !== admission.documentId
          || ownerCount?.owner_count !== 1
          || currentAccess === null
          || !this.toDocumentAuthorization(currentRow, currentAccess).canWrite
          || !this.documentAccessMatches(admission.access, currentAccess)
        ) throw this.unavailableError();

        const missingDurableHeads = Automerge.getMissingDeps(
          prospectiveDocument,
          Automerge.getHeads(durableDocument),
        );
        if (missingDurableHeads.length > 0) {
          throw new Error('Widget collaborative state history cannot discard durable changes.');
        }
        fnAssertWidgetCollaborativeStateDocument(
          prospectiveDocument,
          admission.access.identity,
        );
        const chunks = await statements.listDocumentChunks.all(
          admission.orgId,
          admission.documentId,
        ) as TDocumentChunkData[];
        this.assertWidgetStateEncodedQuota(chunks, admission.documentKey, prospectiveDocument);

        if (incomingChanges.length === 0) return;
        const snapshot = Automerge.save(prospectiveDocument);
        this.assertWidgetStateEncodedQuota([
          ...chunks,
          {
            chunk_key: this.keyToString([
              admission.documentKey,
              'snapshot',
              'remote-preflight',
            ]),
            chunk_bytes: snapshot,
            sequence: Number.MAX_SAFE_INTEGER,
          },
        ], admission.documentKey);
        if (admission.hasPersistedContent) {
          const incremental = Automerge.saveSince(
            prospectiveDocument,
            Automerge.getHeads(durableDocument),
          );
          this.assertWidgetStateEncodedQuota([
            ...chunks,
            {
              chunk_key: this.keyToString([
                admission.documentKey,
                'incremental',
                'remote-preflight',
              ]),
              chunk_bytes: incremental,
              sequence: Number.MAX_SAFE_INTEGER,
            },
          ], admission.documentKey);
        }

        this.reserveWidgetStateMutations(scopeKey, incomingChanges);
      },
    });
  }

  hasAdmittedDocumentContent(tenantContext: TTenantContext, automergeUrl: string): boolean {
    return this.admittedDocuments.get(
      fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
    )?.hasPersistedContent === true;
  }

  getTenantMetrics(tenantContext: TTenantContext): TAutomergeStorageTenantMetrics {
    let pendingWrites = 0;
    let pendingBytes = 0;
    for (const [scopeKey, writes] of this.pendingWrites) {
      const admission = this.admittedDocuments.get(scopeKey) ?? this.claimedDocuments.get(scopeKey);
      if (admission?.orgId !== tenantContext.orgId) continue;
      pendingWrites += writes.length;
      pendingBytes += writes.reduce((total, write) => total + write.binary.byteLength, 0);
    }
    return { pendingWrites, pendingBytes };
  }

  async load(keyArray: StorageKey): Promise<Uint8Array | undefined> {
    if (this.isStorageAdapterIdKey(keyArray)) {
      return new TextEncoder().encode(AUTOMERGE_STORAGE_ADAPTER_ID);
    }
    const admission = this.findAdmission(keyArray);
    if (admission === undefined) return undefined;
    const statements = await this.setup();
    const result = await statements.load.get(
      admission.orgId,
      admission.documentId,
      this.keyToString(keyArray),
    ) as TData | undefined;
    return result?.chunk_bytes;
  }

  async save(keyArray: StorageKey, binary: Uint8Array): Promise<void> {
    if (this.isStorageAdapterIdKey(keyArray)) return;
    if (this.writesSealed) return;
    this.assertAvailable();
    const operation = this.saveAvailable(keyArray, binary);
    this.activeWriteOperations.add(operation);
    try {
      await operation;
    } finally {
      this.activeWriteOperations.delete(operation);
    }
  }

  sealWrites(): void {
    this.writesSealed = true;
  }

  async drainWrites(): Promise<void> {
    let firstFailure: unknown;
    while (this.activeWriteOperations.size > 0) {
      const operations = [...this.activeWriteOperations];
      const results = await Promise.allSettled(operations);
      for (const [index, result] of results.entries()) {
        this.activeWriteOperations.delete(operations[index]!);
        if (result.status === 'rejected' && firstFailure === undefined) {
          firstFailure = result.reason;
        }
      }
    }
    if (firstFailure !== undefined) throw firstFailure;
  }

  private async saveAvailable(keyArray: StorageKey, binary: Uint8Array): Promise<void> {
    const documentKey = this.requireDocumentKey(keyArray);
    const scopeKey = this.admittedScopeByDocumentKey.get(documentKey);
    if (scopeKey === undefined) throw this.unavailableError();

    const statements = await this.setup();
    const admission = this.admittedDocuments.get(scopeKey);
    if (admission !== undefined) {
      await this.persistSerialized(statements, admission, keyArray, binary);
      return;
    }

    if (!this.claimedDocuments.has(scopeKey)) throw this.unavailableError();
    await this.enqueuePendingWrite(scopeKey, keyArray, binary);
  }

  async remove(keyArray: string[]): Promise<void> {
    if (this.isStorageAdapterIdKey(keyArray)) return;
    if (this.writesSealed) return;
    const admission = this.findAdmission(keyArray);
    if (admission === undefined) return;
    const statements = await this.setup();
    await txRunSerializedOperation({ scope: this.db }, {
      operation: () => statements.remove.run(
        admission.orgId,
        admission.documentId,
        this.keyToString(keyArray),
      ).then(() => undefined),
    });
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const admission = this.findAdmission(keyPrefix);
    if (admission === undefined) return [];
    const statements = await this.setup();
    const prefix = this.keyToString(keyPrefix);
    const result = await statements.loadRange.all(
      admission.orgId,
      admission.documentId,
      `${prefix}*`,
    ) as TRangeData[];
    return result.map(({ chunk_key, chunk_bytes }) => ({
      key: this.stringToKey(chunk_key),
      data: chunk_bytes,
    }));
  }

  async removeRange(keyPrefix: string[]): Promise<void> {
    if (this.writesSealed) return;
    const admission = this.findAdmission(keyPrefix);
    if (admission === undefined) return;
    const statements = await this.setup();
    const prefix = this.keyToString(keyPrefix);
    await txRunSerializedOperation({ scope: this.db }, {
      operation: () => statements.removeRange.run(
        admission.orgId,
        admission.documentId,
        `${prefix}*`,
      ).then(() => undefined),
    });
  }

  dispose(cause: unknown = new Error('Automerge storage stopped before document registration.')): void {
    this.sealWrites();
    this.disposed = true;
    const error = this.toError(cause);
    for (const scopeKey of [...this.pendingWrites.keys()]) {
      for (const write of this.takePendingWrites(scopeKey)) write.reject(error);
    }
    for (const scopeKey of [...this.admittedDocuments.keys()]) this.releaseAdmission(scopeKey);
    this.claimedDocuments.clear();
    this.admittedScopeByDocumentKey.clear();
    this.documentWriteAuthorities.clear();
    this.widgetStateMutationTimes.clear();
    this.widgetStateLastClock.clear();
    this.widgetStateReservedChangeHashes.clear();
  }

  private setup(): Promise<TPreparedStatements> {
    this.setupPromise ??= this.setupStatements().catch((error) => {
      this.setupPromise = null;
      throw error;
    });
    return this.setupPromise;
  }

  private async setupStatements(): Promise<TPreparedStatements> {
    const findDocument = await this.db.prepare(`
      SELECT
        document.id,
        document.canvas_id AS document_canvas_id,
        document.widget_instance_id,
        document.automerge_url,
        document.content_version,
        COALESCE(document.canvas_id, instance.canvas_id) AS owner_canvas_id,
        member.role AS member_role,
        instance.element_id,
        instance.definition_id,
        instance.revision_id
      FROM collaboration_documents AS document
      LEFT JOIN widget_instances AS instance
        ON instance.org_id = document.org_id
        AND instance.id = document.widget_instance_id
      INNER JOIN canvas_members AS member
        ON member.org_id = document.org_id
        AND member.canvas_id = COALESCE(document.canvas_id, instance.canvas_id)
        AND member.account_id = ?
      WHERE document.org_id = ? AND document.automerge_url = ?
        AND (? IS NULL OR COALESCE(document.canvas_id, instance.canvas_id) = ?)
        AND (
          (
            document.canvas_id IS NOT NULL
            AND document.widget_instance_id IS NULL
          )
          OR (
            document.canvas_id IS NULL
            AND document.widget_instance_id IS NOT NULL
            AND instance.status = 'active'
            AND EXISTS (
              SELECT 1
              FROM collaboration_documents AS canvas_document
              INNER JOIN widget_instance_projection_heads AS projection_head
                ON projection_head.org_id = canvas_document.org_id
                AND projection_head.canvas_id = canvas_document.canvas_id
                AND projection_head.source_sequence = canvas_document.content_version
              WHERE canvas_document.org_id = document.org_id
                AND canvas_document.canvas_id = instance.canvas_id
                AND canvas_document.widget_instance_id IS NULL
            )
          )
        )
    `);
    const findDocumentOwnerCount = await this.db.prepare(`
      SELECT count(*) AS owner_count
      FROM collaboration_documents
      WHERE automerge_url = ?
    `);
    const listDocumentChunks = await this.db.prepare(`
      SELECT chunk_key, chunk_bytes, sequence
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ?
      ORDER BY sequence ASC
    `);
    const load = await this.db.prepare(`
      SELECT chunk_bytes
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ? AND chunk_key = ?
    `);
    const findSequence = await this.db.prepare(`
      SELECT sequence
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ? AND chunk_key = ?
    `);
    const nextSequence = await this.db.prepare(`
      SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ?
    `);
    const insert = await this.db.prepare(`
      INSERT INTO collaboration_chunks (
        org_id, document_id, chunk_key, sequence, chunk_bytes, created_at_ms
      )
      VALUES (?, ?, ?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER))
    `);
    const update = await this.db.prepare(`
      UPDATE collaboration_chunks
      SET chunk_bytes = ?
      WHERE org_id = ? AND document_id = ? AND chunk_key = ?
    `);
    const incrementContentVersion = await this.db.prepare(`
      UPDATE collaboration_documents
      SET content_version = content_version + 1
      WHERE org_id = ? AND id = ?
      RETURNING content_version
    `);
    const remove = await this.db.prepare(`
      DELETE FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ? AND chunk_key = ?
    `);
    const loadRange = await this.db.prepare(`
      SELECT chunk_key, chunk_bytes
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ? AND chunk_key GLOB ?
      ORDER BY sequence ASC
    `);
    const removeRange = await this.db.prepare(`
      DELETE FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ? AND chunk_key GLOB ?
    `);

    return {
      findDocument,
      findDocumentOwnerCount,
      listDocumentChunks,
      load,
      findSequence,
      nextSequence,
      insert,
      update,
      incrementContentVersion,
      remove,
      loadRange,
      removeRange,
    };
  }

  private async findAuthorizedDocument(
    statements: TPreparedStatements,
    tenantContext: Pick<TTenantContext, 'orgId' | 'accountId' | 'canvasId'>,
    canonicalAutomergeUrl: string,
  ): Promise<TDocumentData | undefined> {
    return await statements.findDocument.get(
      tenantContext.accountId,
      tenantContext.orgId,
      canonicalAutomergeUrl,
      tenantContext.canvasId ?? null,
      tenantContext.canvasId ?? null,
    ) as TDocumentData | undefined;
  }

  private toDocumentAccess(
    row: TDocumentData,
    orgId: string,
  ): TAutomergeDocumentAccess | null {
    if (
      row.document_canvas_id !== null
      && row.widget_instance_id === null
      && typeof row.owner_canvas_id === 'string'
      && row.owner_canvas_id === row.document_canvas_id
    ) {
      return Object.freeze({
        kind: 'canvas',
        orgId,
        canvasId: row.document_canvas_id,
      });
    }
    if (
      row.document_canvas_id !== null
      || typeof row.widget_instance_id !== 'string'
      || typeof row.owner_canvas_id !== 'string'
      || typeof row.element_id !== 'string'
      || typeof row.definition_id !== 'string'
      || typeof row.revision_id !== 'string'
      || !isValidAutomergeUrl(row.automerge_url)
      || row.automerge_url.includes('#')
    ) return null;
    const identity: TWidgetCollaborativeStateIdentity = Object.freeze({
      orgId,
      canvasId: row.owner_canvas_id,
      elementId: row.element_id,
      widgetInstanceId: row.widget_instance_id,
      definitionId: row.definition_id,
      revisionId: row.revision_id,
      stateDocumentId: row.automerge_url,
    });
    return Object.freeze({
      kind: 'widget-state',
      orgId,
      canvasId: row.owner_canvas_id,
      identity,
    });
  }

  private documentAccessMatches(
    left: TAutomergeDocumentAccess,
    right: TAutomergeDocumentAccess,
  ): boolean {
    if (left.kind !== right.kind || left.orgId !== right.orgId || left.canvasId !== right.canvasId) {
      return false;
    }
    return left.kind === 'canvas'
      || (
        right.kind === 'widget-state'
        && fnWidgetCollaborativeStateIdentitiesMatch(left.identity, right.identity)
      );
  }

  private toDocumentAuthorization(
    row: TDocumentData,
    access: TAutomergeDocumentAccess,
  ): TAutomergeDocumentAuthorization {
    return Object.freeze({
      access,
      canWrite: row.member_role === 'owner' || row.member_role === 'editor',
    });
  }

  private rememberDocumentWriteAuthority(
    scopeKey: string,
    tenantContext: TTenantContext,
    canWrite: boolean,
  ): void {
    const authorities = this.documentWriteAuthorities.get(scopeKey) ?? new Map();
    authorities.delete(tenantContext.accountId);
    if (!canWrite) {
      if (authorities.size === 0) this.documentWriteAuthorities.delete(scopeKey);
      return;
    }
    if (authorities.size >= MAX_AUTOMERGE_DOCUMENT_WRITE_AUTHORITIES) {
      const oldestAccountId = authorities.keys().next().value;
      if (oldestAccountId !== undefined) authorities.delete(oldestAccountId);
    }
    authorities.set(tenantContext.accountId, Object.freeze({
      accountId: tenantContext.accountId,
      canvasFence: tenantContext.canvasId ?? null,
    }));
    this.documentWriteAuthorities.set(scopeKey, authorities);
  }

  private forgetDocumentWriteAuthority(scopeKey: string, accountId: string): void {
    const authorities = this.documentWriteAuthorities.get(scopeKey);
    if (authorities === undefined) return;
    authorities.delete(accountId);
    if (authorities.size === 0) this.documentWriteAuthorities.delete(scopeKey);
  }

  private async findAuthorizedDocumentFromCachedAuthorities(
    statements: TPreparedStatements,
    admission: TDocumentAdmission,
  ): Promise<Readonly<{
    row: TDocumentData;
    access: TAutomergeDocumentAccess;
  }> | null> {
    const authorities = this.documentWriteAuthorities.get(admission.scopeKey);
    if (authorities === undefined) return null;
    for (const [accountId, authority] of authorities) {
      const row = await this.findAuthorizedDocument(statements, {
        orgId: admission.orgId,
        accountId: authority.accountId,
        ...(authority.canvasFence === null ? {} : { canvasId: authority.canvasFence }),
      }, admission.automergeUrl);
      const access = row === undefined ? null : this.toDocumentAccess(row, admission.orgId);
      if (
        row === undefined
        || access === null
        || !this.toDocumentAuthorization(row, access).canWrite
        || !this.documentAccessMatches(admission.access, access)
      ) {
        authorities.delete(accountId);
        continue;
      }
      return Object.freeze({ row, access });
    }
    if (authorities.size === 0) this.documentWriteAuthorities.delete(admission.scopeKey);
    return null;
  }

  private loadWidgetStateReplica(
    chunks: readonly TDocumentChunkData[],
    admission: TDocumentAdmission,
    expectedIdentity: TWidgetCollaborativeStateIdentity,
  ): Automerge.Doc<unknown> | null {
    try {
      this.assertWidgetStateEncodedQuota(chunks, admission.documentKey);
    } catch {
      return null;
    }
    const contentChunks = this.orderWidgetStateContentChunks(chunks, admission.documentKey);
    if (
      (admission.contentVersion === 0 && contentChunks.length > 0)
      || (admission.contentVersion > 0 && contentChunks.length === 0)
    ) return null;
    const replica = Automerge.init<unknown>();
    if (contentChunks.length === 0) return replica;
    try {
      let current = replica;
      for (const chunk of contentChunks) {
        current = Automerge.loadIncremental(current, chunk.chunk_bytes);
      }
      this.assertWidgetStateEncodedQuota(chunks, admission.documentKey, current);
      fnAssertWidgetCollaborativeStateDocument(current, expectedIdentity);
      return current;
    } catch {
      Automerge.free(replica);
      return null;
    }
  }

  private createProspectiveWidgetStateReplica(
    chunks: readonly TDocumentChunkData[],
    admission: TDocumentAdmission,
  ): Automerge.Doc<unknown> {
    if (admission.access.kind !== 'widget-state') {
      throw new Error('Widget collaborative state access is unavailable.');
    }
    const contentChunks = this.orderWidgetStateContentChunks(
      chunks,
      admission.documentKey,
    );
    const replica = Automerge.init<unknown>();
    try {
      let current = replica;
      for (const chunk of contentChunks) {
        current = Automerge.loadIncremental(current, chunk.chunk_bytes);
      }
      this.assertWidgetStateEncodedQuota(chunks, admission.documentKey, current);
      fnAssertWidgetCollaborativeStateDocument(current, admission.access.identity);
      return current;
    } catch (error) {
      Automerge.free(replica);
      throw error;
    }
  }

  private orderWidgetStateContentChunks(
    chunks: readonly TDocumentChunkData[],
    documentKey: string,
  ): TDocumentChunkData[] {
    const bySequence = (left: TDocumentChunkData, right: TDocumentChunkData) => (
      Number(left.sequence) - Number(right.sequence)
    );
    const snapshots: TDocumentChunkData[] = [];
    const incrementals: TDocumentChunkData[] = [];
    for (const chunk of chunks) {
      const key = this.stringToKey(chunk.chunk_key);
      if (key[0] !== documentKey) continue;
      if (key[1] === 'snapshot') snapshots.push(chunk);
      if (key[1] === 'incremental') incrementals.push(chunk);
    }
    return [...snapshots.sort(bySequence), ...incrementals.sort(bySequence)];
  }

  private createProspectiveWidgetStateChunks(
    chunks: readonly TDocumentChunkData[],
    chunkKey: string,
    binary: Uint8Array,
  ): TDocumentChunkData[] {
    const existing = chunks.find((chunk) => chunk.chunk_key === chunkKey);
    const nextSequence = chunks.reduce(
      (maximum, chunk) => Math.max(maximum, Number(chunk.sequence)),
      -1,
    ) + 1;
    return [
      ...chunks.filter((chunk) => chunk.chunk_key !== chunkKey),
      {
        chunk_key: chunkKey,
        chunk_bytes: binary,
        sequence: existing?.sequence ?? nextSequence,
      },
    ];
  }

  private assertWidgetStateEncodedQuota(
    chunks: readonly TDocumentChunkData[],
    documentKey: string,
    replica?: Automerge.Doc<unknown>,
  ): void {
    const quotaChunks: TWidgetCollaborativeStateChunkByteLength[] = chunks.map((chunk) => {
      const key = this.stringToKey(chunk.chunk_key);
      const contentKind = key[0] === documentKey
        && (key[1] === 'incremental' || key[1] === 'snapshot')
        ? key[1]
        : null;
      return Object.freeze({
        byteLength: chunk.chunk_bytes.byteLength,
        contentKind,
      });
    });
    const encodedChangeByteLengths = replica === undefined
      ? []
      : Automerge.getAllChanges(replica).map((change) => change.byteLength);
    fnAssertWidgetCollaborativeStateEncodedQuota(quotaChunks, encodedChangeByteLengths);
  }

  private prospectiveWidgetStateChanges(
    admission: TDocumentAdmission,
    prospectiveReplica: Automerge.Doc<unknown>,
  ): Automerge.Change[] {
    const previous = this.widgetStateDocuments.get(admission.scopeKey);
    if (previous === undefined) throw this.unavailableError();
    const missingDurableHeads = Automerge.getMissingDeps(
      prospectiveReplica,
      Automerge.getHeads(previous),
    );
    if (missingDurableHeads.length > 0) {
      throw new Error('Widget collaborative state history cannot discard durable changes.');
    }
    return Automerge.getChanges(previous, prospectiveReplica);
  }

  private admitWidgetStateMutation(
    scopeKey: string,
    changes: readonly Automerge.Change[],
    timestamp?: number,
  ): TWidgetStateMutationCharge {
    const now = timestamp ?? this.readWidgetStateMutationClock(scopeKey);
    const reserved = this.widgetStateReservedChangeHashes.get(scopeKey);
    const reservedChangeHashes: string[] = [];
    let changeCount = 0;
    for (const change of changes) {
      const hash = Automerge.decodeChange(change).hash;
      if (reserved?.has(hash)) reservedChangeHashes.push(hash);
      else changeCount += 1;
    }
    const mutationTimes = this.widgetStateMutationTimes.get(scopeKey) ?? [];
    if (
      !Number.isSafeInteger(changeCount)
      || changeCount < 0
      || mutationTimes.length + changeCount > this.widgetStateMutationRateLimit
    ) {
      throw new Error('Widget collaborative state mutation rate limit exceeded.');
    }
    if (
      changeCount > 0
      && !this.widgetStateMutationTimes.has(scopeKey)
      && this.widgetStateMutationTimes.size >= this.maxWidgetStateMutationRateLedgers
    ) {
      throw new Error('Widget collaborative state mutation authority capacity exceeded.');
    }
    return Object.freeze({ timestamp: now, changeCount, reservedChangeHashes });
  }

  private reserveWidgetStateMutations(
    scopeKey: string,
    changes: readonly Automerge.Change[],
  ): void {
    const now = this.readWidgetStateMutationClock(scopeKey);
    const reservations = this.widgetStateReservedChangeHashes.get(scopeKey)
      ?? new Map<string, TWidgetStateMutationReservation>();
    const hashes = new Set<string>();
    const unreservedChanges: Automerge.Change[] = [];
    for (const change of changes) {
      const hash = Automerge.decodeChange(change).hash;
      if (reservations.has(hash) || hashes.has(hash)) continue;
      hashes.add(hash);
      unreservedChanges.push(change);
    }
    if (
      reservations.size + hashes.size
      > this.maxWidgetStateMutationReservationsPerDocument
    ) {
      throw new Error('Widget collaborative state mutation reservation capacity exceeded.');
    }
    if (
      hashes.size > 0
      && !this.widgetStateReservedChangeHashes.has(scopeKey)
      && this.widgetStateReservedChangeHashes.size >= this.maxWidgetStateMutationRateLedgers
    ) {
      throw new Error('Widget collaborative state mutation authority capacity exceeded.');
    }
    const charge = this.admitWidgetStateMutation(scopeKey, unreservedChanges, now);
    this.commitWidgetStateMutationCharge(scopeKey, charge);
    for (const hash of hashes) {
      reservations.set(hash, Object.freeze({ timestamp: charge.timestamp }));
    }
    if (reservations.size > 0) this.widgetStateReservedChangeHashes.set(scopeKey, reservations);
  }

  private commitWidgetStateMutation(
    admission: TDocumentAdmission,
    replica: Automerge.Doc<unknown>,
    charge: TWidgetStateMutationCharge,
  ): void {
    const previous = this.widgetStateDocuments.get(admission.scopeKey);
    this.widgetStateDocuments.set(admission.scopeKey, replica);
    if (previous !== undefined) Automerge.free(previous);
    const reservations = this.widgetStateReservedChangeHashes.get(admission.scopeKey);
    for (const hash of charge.reservedChangeHashes) reservations?.delete(hash);
    if (reservations?.size === 0) this.widgetStateReservedChangeHashes.delete(admission.scopeKey);
    this.commitWidgetStateMutationCharge(admission.scopeKey, charge);
  }

  private commitWidgetStateMutationCharge(
    scopeKey: string,
    charge: TWidgetStateMutationCharge,
  ): void {
    if (charge.changeCount > 0) {
      const mutationTimes = this.widgetStateMutationTimes.get(scopeKey) ?? [];
      for (let index = 0; index < charge.changeCount; index += 1) {
        mutationTimes.push(charge.timestamp);
      }
      this.widgetStateMutationTimes.set(scopeKey, mutationTimes);
      this.widgetStateLastClock.set(scopeKey, charge.timestamp);
    }
  }

  private releaseAdmission(scopeKey: string, preserveMutationWindow = false): void {
    this.admittedDocuments.delete(scopeKey);
    this.documentWriteAuthorities.delete(scopeKey);
    const replica = this.widgetStateDocuments.get(scopeKey);
    if (replica !== undefined) Automerge.free(replica);
    this.widgetStateDocuments.delete(scopeKey);
    this.widgetStateReservedChangeHashes.delete(scopeKey);
    if (preserveMutationWindow) {
      this.pruneExpiredWidgetStateRateLedgers(this.nowMs());
      return;
    }
    this.widgetStateMutationTimes.delete(scopeKey);
    this.widgetStateLastClock.delete(scopeKey);
  }

  private pruneExpiredWidgetStateRateLedgers(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) return;
    const cutoff = now - this.widgetStateMutationRateWindowMs;
    for (const [scopeKey, mutationTimes] of this.widgetStateMutationTimes) {
      while (mutationTimes.length > 0 && mutationTimes[0]! <= cutoff) mutationTimes.shift();
      if (mutationTimes.length > 0) continue;
      this.widgetStateMutationTimes.delete(scopeKey);
      if (!this.admittedDocuments.has(scopeKey)) this.widgetStateLastClock.delete(scopeKey);
    }
    const reservationCutoff = now - this.widgetStateMutationReservationTtlMs;
    for (const [scopeKey, reservations] of this.widgetStateReservedChangeHashes) {
      for (const [hash, reservation] of reservations) {
        if (reservation.timestamp <= reservationCutoff) reservations.delete(hash);
      }
      if (reservations.size === 0) this.widgetStateReservedChangeHashes.delete(scopeKey);
    }
  }

  private readWidgetStateMutationClock(scopeKey: string): number {
    const now = this.nowMs();
    const previousNow = this.widgetStateLastClock.get(scopeKey);
    if (!Number.isSafeInteger(now) || now < 0 || (previousNow !== undefined && now < previousNow)) {
      throw new Error('Widget collaborative state authority clock is invalid.');
    }
    this.pruneExpiredWidgetStateRateLedgers(now);
    return now;
  }

  private findAdmission(key: readonly string[]): TDocumentAdmission | undefined {
    const documentKey = key[0];
    if (documentKey === undefined) return undefined;
    const scopeKey = this.admittedScopeByDocumentKey.get(documentKey);
    return scopeKey === undefined ? undefined : this.admittedDocuments.get(scopeKey);
  }

  private createClaim(tenantContext: TTenantContext, automergeUrl: string): TDocumentClaim {
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    return {
      orgId: tenantContext.orgId,
      documentKey,
      scopeKey: fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl),
    };
  }

  private bindDocumentKeyToScope(documentKey: string, scopeKey: string): boolean {
    const existingScope = this.admittedScopeByDocumentKey.get(documentKey);
    if (existingScope !== undefined && existingScope !== scopeKey) return false;
    this.admittedScopeByDocumentKey.set(documentKey, scopeKey);
    return true;
  }

  private releaseUnusedDocumentScope(documentKey: string, scopeKey: string): void {
    if (this.admittedDocuments.has(scopeKey) || this.claimedDocuments.has(scopeKey)) return;
    if (this.pendingWrites.has(scopeKey)) return;
    if (this.admittedScopeByDocumentKey.get(documentKey) === scopeKey) {
      this.admittedScopeByDocumentKey.delete(documentKey);
    }
  }

  private async flushPendingWrites(
    statements: TPreparedStatements,
    admission: TDocumentAdmission,
  ): Promise<void> {
    const pending = this.takePendingWrites(admission.scopeKey);
    let firstFailure: Error | undefined;
    for (const write of pending) {
      if (firstFailure !== undefined) {
        write.reject(firstFailure);
        continue;
      }
      try {
        await this.persistSerialized(statements, admission, write.key, write.binary);
        write.resolve();
      } catch (error) {
        firstFailure = this.toError(error);
        write.reject(firstFailure);
      }
    }
    if (firstFailure !== undefined) throw firstFailure;
  }

  private enqueuePendingWrite(
    scopeKey: string,
    key: StorageKey,
    binary: Uint8Array,
  ): Promise<void> {
    if (
      this.pendingWriteCount >= this.maxPendingWrites
      || this.pendingByteCount + binary.byteLength > this.maxPendingBytes
    ) {
      return Promise.reject(new Error('Automerge pending storage queue capacity exceeded.'));
    }

    const storedBinary = binary.slice();
    this.pendingWriteCount += 1;
    this.pendingByteCount += storedBinary.byteLength;
    return new Promise<void>((resolve, reject) => {
      const writes = this.pendingWrites.get(scopeKey) ?? [];
      writes.push({ key: [...key], binary: storedBinary, resolve, reject });
      this.pendingWrites.set(scopeKey, writes);
    });
  }

  private takePendingWrites(scopeKey: string): TPendingWrite[] {
    const pending = this.pendingWrites.get(scopeKey) ?? [];
    this.pendingWrites.delete(scopeKey);
    this.pendingWriteCount -= pending.length;
    this.pendingByteCount -= pending.reduce((total, write) => total + write.binary.byteLength, 0);
    return pending;
  }

  private runDocumentAdmission<T>(
    scopeKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.documentAdmissionTails.get(scopeKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.documentAdmissionTails.set(scopeKey, current);
    void current.finally(() => {
      if (this.documentAdmissionTails.get(scopeKey) === current) {
        this.documentAdmissionTails.delete(scopeKey);
      }
    }).catch(() => undefined);
    return current;
  }

  private persistSerialized(
    statements: TPreparedStatements,
    admission: TDocumentAdmission,
    key: readonly string[],
    binary: Uint8Array,
  ): Promise<void> {
    const previous = this.documentWriteTails.get(admission.scopeKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.persist(statements, admission, key, binary));
    this.documentWriteTails.set(admission.scopeKey, current);
    void current.finally(() => {
      if (this.documentWriteTails.get(admission.scopeKey) === current) {
        this.documentWriteTails.delete(admission.scopeKey);
      }
    }).catch(() => undefined);
    return current;
  }

  private async persist(
    statements: TPreparedStatements,
    admission: TDocumentAdmission,
    key: readonly string[],
    binary: Uint8Array,
  ): Promise<void> {
    const chunkKey = this.keyToString(key);
    const contentKind = key[1] === 'snapshot' || key[1] === 'incremental'
      ? key[1]
      : null;
    const committed = await txRunSerializedOperation({ scope: this.db }, {
      operation: async () => {
        let prospectiveReplica: Automerge.Doc<unknown> | undefined;
        let mutationCharge: TWidgetStateMutationCharge | undefined;
        try {
          const requiresCurrentWriteAuthority = contentKind !== null
            || admission.access.kind === 'widget-state';
          const currentAuthority = requiresCurrentWriteAuthority
            ? await this.findAuthorizedDocumentFromCachedAuthorities(statements, admission)
            : null;
          if (requiresCurrentWriteAuthority) {
            const ownerCount = await statements.findDocumentOwnerCount.get(
              admission.automergeUrl,
            ) as TDocumentOwnerCountData | undefined;
            if (
              currentAuthority?.row.id !== admission.documentId
              || ownerCount?.owner_count !== 1
            ) throw this.unavailableError();
          }

          if (admission.access.kind === 'widget-state') {
            const chunks = await statements.listDocumentChunks.all(
              admission.orgId,
              admission.documentId,
            ) as TDocumentChunkData[];
            const prospectiveChunks = this.createProspectiveWidgetStateChunks(
              chunks,
              chunkKey,
              binary,
            );
            this.assertWidgetStateEncodedQuota(prospectiveChunks, admission.documentKey);
            if (contentKind !== null) {
              prospectiveReplica = this.createProspectiveWidgetStateReplica(
                prospectiveChunks,
                admission,
              );
              const changes = this.prospectiveWidgetStateChanges(
                admission,
                prospectiveReplica,
              );
              mutationCharge = this.admitWidgetStateMutation(admission.scopeKey, changes);
            }
          }

          const persist = this.db.transaction(async (): Promise<TContentVersionData | null> => {
            const existing = await statements.findSequence.get(
              admission.orgId,
              admission.documentId,
              chunkKey,
            ) as TSequenceData | undefined;
            if (existing !== undefined) {
              await statements.update.run(binary, admission.orgId, admission.documentId, chunkKey);
            } else {
              const next = await statements.nextSequence.get(
                admission.orgId,
                admission.documentId,
              ) as TNextSequenceData | undefined;
              await statements.insert.run(
                admission.orgId,
                admission.documentId,
                chunkKey,
                next?.next_sequence ?? 0,
                binary,
              );
            }

            if (contentKind === null) return null;
            const version = await statements.incrementContentVersion.get(
              admission.orgId,
              admission.documentId,
            ) as TContentVersionData | undefined;
            if (version === undefined) {
              throw new Error('Automerge document disappeared while saving content.');
            }
            return version;
          });
          const result = await persist();
          if (prospectiveReplica !== undefined && mutationCharge !== undefined) {
            this.commitWidgetStateMutation(admission, prospectiveReplica, mutationCharge);
            prospectiveReplica = undefined;
          }
          return result;
        } finally {
          if (prospectiveReplica !== undefined) Automerge.free(prospectiveReplica);
        }
      },
    });
    if (committed === null || contentKind === null) return;
    const contentVersion = Number(committed.content_version);
    if (!Number.isSafeInteger(contentVersion) || contentVersion < 0) {
      throw new Error('Automerge document content version is invalid after save.');
    }

    const currentAdmission = this.admittedDocuments.get(admission.scopeKey);
    const committedAdmission = Object.freeze({
      ...(currentAdmission ?? admission),
      contentVersion,
      hasPersistedContent: true,
    });
    if (currentAdmission?.documentId === admission.documentId) {
      this.admittedDocuments.set(admission.scopeKey, committedAdmission);
    }
    this.onDocumentContentVersion?.(Object.freeze({
      ...this.toDocumentVersion(committedAdmission),
      contentBytes: binary.slice(),
      contentKind,
    }));
  }

  private toDocumentVersion(
    admission: TDocumentAdmission,
  ): TAutomergeStorageDocumentVersion {
    return Object.freeze({
      orgId: admission.orgId,
      documentId: admission.documentId,
      canvasId: admission.canvasId,
      automergeUrl: admission.automergeUrl,
      contentVersion: admission.contentVersion,
    });
  }

  private requireDocumentKey(key: readonly string[]): string {
    const documentKey = key[0];
    if (documentKey === undefined || documentKey.length === 0) {
      throw new Error('Automerge storage key is missing a document identifier.');
    }
    return documentKey;
  }

  private isStorageAdapterIdKey(key: readonly string[]): boolean {
    return key.length === 1 && key[0] === 'storage-adapter-id';
  }

  private isCanonicalAutomergeUrl(value: string): boolean {
    return isValidAutomergeUrl(value) && !value.includes('#');
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Automerge storage adapter is stopped.');
  }

  private unavailableError(): Error {
    return new Error(AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE);
  }

  private toError(cause: unknown): Error {
    return cause instanceof Error ? cause : new Error(String(cause));
  }

  private keyToString(key: readonly string[]): string {
    return key.join(this.separator);
  }

  private stringToKey(key: string): StorageKey {
    return key.split(this.separator);
  }

  private requirePositiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${label} must be a positive integer.`);
    }
    return value;
  }
}
