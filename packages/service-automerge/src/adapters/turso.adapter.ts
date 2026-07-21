import type {
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from '@automerge/automerge-repo';
import type { Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE,
  AUTOMERGE_STORAGE_ADAPTER_ID,
} from '../CONSTANTS';
import {
  fnAutomergeDocumentKeyFromUrl,
  fnAutomergeDocumentScopeKey,
  fnAutomergeUrlFromDocumentKey,
} from '../core/fn.automerge-document';

type TOptions = Readonly<{
  separator?: string;
  maxPendingWrites?: number;
  maxPendingBytes?: number;
}>;

type TData = { chunk_bytes: Uint8Array };
type TRangeData = { chunk_key: string; chunk_bytes: Uint8Array };
type TDocumentData = { id: string };
type TDocumentOwnerCountData = { owner_count: number };
type TSequenceData = { sequence: number };
type TNextSequenceData = { next_sequence: number };
type TPendingWrite = {
  key: StorageKey;
  binary: Uint8Array;
  resolve: () => void;
  reject: (error: Error) => void;
};

type TDocumentAdmission = Readonly<{
  orgId: string;
  documentId: string;
  documentKey: string;
  scopeKey: string;
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
  load: TTursoStatement;
  findSequence: TTursoStatement;
  nextSequence: TTursoStatement;
  insert: TTursoStatement;
  update: TTursoStatement;
  remove: TTursoStatement;
  loadRange: TTursoStatement;
  removeRange: TTursoStatement;
};

export class TursoStorageAdapter implements StorageAdapterInterface {
  private readonly db: Database;
  private readonly separator: string;
  private readonly maxPendingWrites: number;
  private readonly maxPendingBytes: number;
  private readonly admittedDocuments = new Map<string, TDocumentAdmission>();
  private readonly claimedDocuments = new Map<string, TDocumentClaim>();
  private readonly admittedScopeByDocumentKey = new Map<string, string>();
  private readonly pendingWrites = new Map<string, TPendingWrite[]>();
  private readonly documentWriteTails = new Map<string, Promise<void>>();
  private readonly activeWriteOperations = new Set<Promise<void>>();
  private pendingWriteCount = 0;
  private pendingByteCount = 0;
  private setupPromise: Promise<TPreparedStatements> | null = null;
  private writesSealed = false;
  private disposed = false;

  constructor(database: Database, options?: TOptions) {
    this.db = database;
    this.separator = options?.separator ?? '.';
    this.maxPendingWrites = options?.maxPendingWrites ?? 1024;
    this.maxPendingBytes = options?.maxPendingBytes ?? 64 * 1024 * 1024;
  }

  claimDocument(tenantContext: TTenantContext, automergeUrl: string): void {
    this.assertAvailable();
    const claim = this.createClaim(tenantContext, automergeUrl);
    if (!this.bindDocumentKeyToScope(claim.documentKey, claim.scopeKey)) {
      throw this.unavailableError();
    }
    this.claimedDocuments.set(claim.scopeKey, claim);
  }

  async admitDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<boolean> {
    this.assertAvailable();
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    if (!this.bindDocumentKeyToScope(documentKey, scopeKey)) return false;

    const cached = this.admittedDocuments.get(scopeKey);
    if (cached !== undefined) return true;

    const statements = await this.setup();
    const row = await statements.findDocument.get(
      tenantContext.orgId,
      fnAutomergeUrlFromDocumentKey(documentKey),
    ) as TDocumentData | undefined;
    if (row === undefined) {
      this.releaseUnusedDocumentScope(documentKey, scopeKey);
      return false;
    }

    const ownerCount = await statements.findDocumentOwnerCount.get(
      fnAutomergeUrlFromDocumentKey(documentKey),
    ) as TDocumentOwnerCountData | undefined;
    if (ownerCount?.owner_count !== 1) {
      this.releaseUnusedDocumentScope(documentKey, scopeKey);
      return false;
    }

    const admission: TDocumentAdmission = {
      orgId: tenantContext.orgId,
      documentId: row.id,
      documentKey,
      scopeKey,
    };
    this.admittedDocuments.set(scopeKey, admission);
    this.claimedDocuments.delete(scopeKey);
    await this.flushPendingWrites(statements, admission);
    return true;
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

    this.admittedDocuments.delete(scopeKey);
    this.claimedDocuments.delete(scopeKey);
    for (const write of this.takePendingWrites(scopeKey)) write.reject(this.unavailableError());
    this.admittedScopeByDocumentKey.delete(documentKey);
  }

  releaseDocument(tenantContext: TTenantContext, automergeUrl: string): void {
    const documentKey = fnAutomergeDocumentKeyFromUrl(automergeUrl);
    const scopeKey = fnAutomergeDocumentScopeKey(tenantContext.orgId, automergeUrl);
    if (this.admittedScopeByDocumentKey.get(documentKey) !== scopeKey) return;
    if (this.pendingWrites.has(scopeKey)) return;

    this.admittedDocuments.delete(scopeKey);
    this.claimedDocuments.delete(scopeKey);
    this.admittedScopeByDocumentKey.delete(documentKey);
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
    await statements.remove.run(
      admission.orgId,
      admission.documentId,
      this.keyToString(keyArray),
    );
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
    await statements.removeRange.run(
      admission.orgId,
      admission.documentId,
      `${prefix}*`,
    );
  }

  dispose(cause: unknown = new Error('Automerge storage stopped before document registration.')): void {
    this.sealWrites();
    this.disposed = true;
    const error = this.toError(cause);
    for (const scopeKey of [...this.pendingWrites.keys()]) {
      for (const write of this.takePendingWrites(scopeKey)) write.reject(error);
    }
    this.admittedDocuments.clear();
    this.claimedDocuments.clear();
    this.admittedScopeByDocumentKey.clear();
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
      SELECT id
      FROM collaboration_documents
      WHERE org_id = ? AND automerge_url = ?
    `);
    const findDocumentOwnerCount = await this.db.prepare(`
      SELECT count(*) AS owner_count
      FROM collaboration_documents
      WHERE automerge_url = ?
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
      load,
      findSequence,
      nextSequence,
      insert,
      update,
      remove,
      loadRange,
      removeRange,
    };
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
    const flushes = pending.map(async (write) => {
      try {
        await this.persistSerialized(statements, admission, write.key, write.binary);
        write.resolve();
      } catch (error) {
        const failure = this.toError(error);
        write.reject(failure);
        throw failure;
      }
    });
    await Promise.all(flushes);
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
    const persist = this.db.transaction(async () => {
      const existing = await statements.findSequence.get(
        admission.orgId,
        admission.documentId,
        chunkKey,
      ) as TSequenceData | undefined;
      if (existing !== undefined) {
        await statements.update.run(binary, admission.orgId, admission.documentId, chunkKey);
        return;
      }

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
    });
    await persist();
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
}
