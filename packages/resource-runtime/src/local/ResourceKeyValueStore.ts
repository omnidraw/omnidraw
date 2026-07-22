/**
 * @file Host-owned bounded Turso file persistence for KV and secret-store resources.
 */
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  IResourceKeyValuePersistence,
  TResourceJson as TJson,
  TResourceKeyValueCompareAndSetResult,
  TResourceKeyValueDeleteResult,
  TResourceKeyValueEntry,
  TResourceKeyValueEntryMetadata,
  TResourceKeyValueIdentity,
  TResourceKeyValueKind,
  TResourceKeyValuePage,
  TResourceKeyValueCommittedOperation,
  TResourceKeyValueReceiptMutationRequest,
  TResourceKeyValueMutationReceipt,
} from './ResourceKeyValuePersistence';
import type { IResourceWritePermitGuard } from '../interface';
import {
  fnResourceKeyValueEntry,
  fnResourceKeyValueEntryMetadata,
  fnResourceKeyValueHostId,
  fnResourceKeyValueListLimit,
  fnResourceKeyValueParse,
  fnResourceKeyValueSerialize,
} from './fn.resource-key-value';
import { ResourceError } from '../ResourceError';
import type { ISecretStoreKeyProvider } from './SecretStoreKeyProvider';
import type { TResourceIdleSweepScheduler } from './ResourceProviderTypes';

const KV_FORMAT_VERSION = 1;
const SECRET_STORE_FORMAT_VERSION = 2;
const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const COPY_PAGE_SIZE = 100;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'ascii');
const TURSO_ENCRYPTED_HEADER = Buffer.from('Turso\0', 'ascii');

export type TResourceKeyValueDatabaseOptions = Readonly<{
  fileMustExist?: boolean;
  defaultQueryTimeout?: number;
  experimental?: readonly string[];
  encryption?: Readonly<{
    cipher: 'aegis256';
    hexkey: string;
  }>;
}>;

export interface IResourceKeyValueStatement {
  all(...args: readonly unknown[]): Promise<Record<string, unknown>[]>;
  get(...args: readonly unknown[]): Promise<Record<string, unknown> | null | undefined>;
  run(...args: readonly unknown[]): Promise<{ readonly changes: number }>;
}

export interface IResourceKeyValueDatabase {
  connect(): Promise<void>;
  exec(sql: string, options?: Readonly<{ queryTimeout?: number }>): Promise<unknown>;
  prepare(sql: string): Promise<IResourceKeyValueStatement>;
  close(): Promise<void>;
}

type Database = IResourceKeyValueDatabase;

export const RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES = 32;
export const RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS = 60_000;

const RESOURCE_PRAGMAS_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
PRAGMA temp_store = 2;
`;

const RESOURCE_METADATA_SCHEMA_SQL = `
CREATE TABLE \`_vibecanvas_resource_metadata\` (
  \`singleton\` INTEGER PRIMARY KEY CHECK (\`singleton\` = 1),
  \`resource_id\` TEXT NOT NULL,
  \`resource_kind\` TEXT NOT NULL CHECK (\`resource_kind\` IN ('kv', 'secretStore')),
  \`format_version\` INTEGER NOT NULL CHECK (\`format_version\` >= 1)
) STRICT
`;

const RESOURCE_ENTRIES_SCHEMA_SQL = `
CREATE TABLE \`resource_entries\` (
  \`key\` TEXT PRIMARY KEY,
  \`value\` JSON NOT NULL,
  \`revision\` INTEGER NOT NULL DEFAULT 1 CHECK (\`revision\` >= 1),
  \`created_at\` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  \`updated_at\` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT
`;

const RESOURCE_UPDATED_AT_TRIGGER_SQL = `
CREATE TRIGGER \`resource_entries_updated_at_after_update\`
AFTER UPDATE OF \`value\`, \`revision\` ON \`resource_entries\`
FOR EACH ROW
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
  UPDATE \`resource_entries\`
  SET \`updated_at\` = CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > OLD.\`updated_at\`
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', OLD.\`updated_at\`, '+0.001 seconds')
  END
  WHERE \`key\` = OLD.\`key\`;
END
`;

const RESOURCE_OPERATION_RECEIPTS_SCHEMA_SQL = `
CREATE TABLE \`_vibecanvas_function_operation_receipts\` (
  \`invocation_id\` TEXT NOT NULL,
  \`operation_id\` TEXT NOT NULL,
  \`attempt_id\` TEXT NOT NULL,
  \`operation_name\` TEXT NOT NULL CHECK (\`operation_name\` IN ('set', 'delete', 'compareAndSet')),
  \`operation_fingerprint_sha256\` TEXT NOT NULL CHECK (
    length(\`operation_fingerprint_sha256\`) = 64
    AND \`operation_fingerprint_sha256\` = lower(\`operation_fingerprint_sha256\`)
    AND \`operation_fingerprint_sha256\` NOT GLOB '*[^0-9a-f]*'
  ),
  \`output_json\` JSON NOT NULL,
  \`committed_at\` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (\`invocation_id\`, \`operation_id\`)
) STRICT
`;

const RESOURCE_SCHEMA_SQL = `
${RESOURCE_METADATA_SCHEMA_SQL};
${RESOURCE_ENTRIES_SCHEMA_SQL};
${RESOURCE_UPDATED_AT_TRIGGER_SQL};
${RESOURCE_OPERATION_RECEIPTS_SCHEMA_SQL};
`;

function normalizeSchemaSql(sql: string): string {
  return sql
    .replace(/[`\"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=])\s*/g, '$1')
    .replace(/\s*;\s*/g, ';')
    .trim()
    .replace(/;$/, '')
    .toLowerCase();
}

export type TResourceKeyValueDatabaseFactory = (
  databasePath: string,
  options: TResourceKeyValueDatabaseOptions,
) => Database;

export type TSecretStoreConversionCheckpoint =
  | 'temporary-created'
  | 'entries-copied'
  | 'temporary-checkpointed'
  | 'temporary-verified'
  | 'source-closed'
  | 'plaintext-renamed'
  | 'encrypted-renamed'
  | 'final-reopened'
  | 'before-recovery-cleanup';

export type TResourceKeyValueStoreConfig = {
  readonly dataRoot: string;
  readonly kind: TResourceKeyValueKind;
  readonly secretStoreKeyProvider?: ISecretStoreKeyProvider;
  readonly secretStoreConversionCheckpoint?: (
    checkpoint: TSecretStoreConversionCheckpoint,
    resourceId: string,
  ) => void | Promise<void>;
  readonly databaseFactory: TResourceKeyValueDatabaseFactory;
  readonly maxOpenHandles?: number;
  readonly queryTimeoutMs?: number;
  readonly idleHandleTimeoutMs?: number;
  readonly nowMs?: () => number;
  readonly scheduleIdleSweep?: TResourceIdleSweepScheduler;
};

type THandleState = {
  readonly opening: Promise<Database>;
  database: Database | null;
  inFlight: number;
  lastUsed: number;
  idleSinceMs: number | null;
};

type TMetadataRow = {
  readonly singleton: unknown;
  readonly resource_id: unknown;
  readonly resource_kind: unknown;
  readonly format_version: unknown;
};

type TTableInfoRow = {
  readonly name: unknown;
  readonly type: unknown;
  readonly notnull: unknown;
  readonly pk: unknown;
};

type TTableListRow = {
  readonly name: unknown;
  readonly strict: unknown;
  readonly wr: unknown;
};

type TSchemaObjectRow = {
  readonly type: unknown;
  readonly name: unknown;
  readonly tbl_name: unknown;
  readonly sql: unknown;
};

type TCopyEntryRow = {
  readonly key: unknown;
  readonly serialized_value: unknown;
  readonly revision: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
};

type TDatabaseFileState = 'missing' | 'plaintext' | 'encrypted' | 'unknown';

function defaultIdleSweepScheduler(
  callback: () => void | Promise<void>,
  delayMs: number,
): () => void {
  const timer = setTimeout(() => { void callback(); }, delayMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
}

export class ResourceKeyValueStore implements IResourceKeyValuePersistence {
  readonly #dataRoot: string;
  readonly #kind: TResourceKeyValueKind;
  readonly #secretStoreKeyProvider: ISecretStoreKeyProvider | undefined;
  readonly #secretStoreConversionCheckpoint: TResourceKeyValueStoreConfig['secretStoreConversionCheckpoint'];
  readonly #databaseFactory: TResourceKeyValueDatabaseFactory;
  readonly #maxOpenHandles: number;
  readonly #queryTimeoutMs: number;
  readonly #idleHandleTimeoutMs: number;
  readonly #nowMs: () => number;
  readonly #scheduleIdleSweep: TResourceIdleSweepScheduler;
  readonly #handles = new Map<string, THandleState>();
  readonly #failedCloses = new Set<Database>();
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #pendingWrites = new Map<string, number>();
  readonly #inFlight = new Map<string, Set<Promise<unknown>>>();
  readonly #lifecycle = new Set<Promise<unknown>>();
  readonly #resourceLifecycleTails = new Map<string, Promise<void>>();
  readonly #blockedLifecycleCounts = new Map<string, number>();
  readonly #handleCapacityWaiters = new Set<() => void>();
  #handleAdmissionTail = Promise.resolve();
  #cancelIdleSweep: (() => void) | null = null;
  #closingHandleCount = 0;
  #lastUse = 0;
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(config: TResourceKeyValueStoreConfig) {
    const maxOpenHandles = config.maxOpenHandles ?? RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES;
    const queryTimeoutMs = config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    const idleHandleTimeoutMs = config.idleHandleTimeoutMs ?? RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS;
    if (!Number.isInteger(maxOpenHandles) || maxOpenHandles < 1) {
      throw new RangeError('Resource key-value maximum open handles must be a positive integer.');
    }
    if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 1) {
      throw new RangeError('Resource key-value query timeout must be a positive integer.');
    }
    if (!Number.isInteger(idleHandleTimeoutMs) || idleHandleTimeoutMs < 1) {
      throw new RangeError('Resource key-value idle-handle timeout must be a positive integer.');
    }
    this.#dataRoot = config.dataRoot;
    this.#kind = config.kind;
    this.#secretStoreKeyProvider = config.secretStoreKeyProvider;
    this.#secretStoreConversionCheckpoint = config.secretStoreConversionCheckpoint;
    if (config.kind === 'secretStore' && !this.#secretStoreKeyProvider) {
      throw new TypeError('Secret-store persistence requires a host key provider.');
    }
    this.#databaseFactory = config.databaseFactory;
    this.#maxOpenHandles = maxOpenHandles;
    this.#queryTimeoutMs = queryTimeoutMs;
    this.#idleHandleTimeoutMs = idleHandleTimeoutMs;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#scheduleIdleSweep = config.scheduleIdleSweep ?? defaultIdleSweepScheduler;
  }

  get openHandleCount(): number {
    return this.#handles.size + this.#failedCloses.size + this.#closingHandleCount;
  }

  async provision(identity: TResourceKeyValueIdentity): Promise<void> {
    this.#assertAvailable();
    this.#assertIdentity(identity);
    return this.#scheduleLifecycle(identity.resourceId, (resourceId) => this.#provision(resourceId));
  }

  async #provision(resourceIdValue: string): Promise<void> {
    const resourceId = fnResourceKeyValueHostId(resourceIdValue);
    const directory = this.#resourceDirectory(resourceId);
    let directoryCreated = false;
    try {
      const databaseHexKey = await this.#databaseHexKey(resourceId, true);
      await mkdir(this.#dataRoot, { recursive: true });
      await mkdir(directory);
      directoryCreated = true;
      const database = this.#databaseFactory(
        this.#databasePath(resourceId),
        this.#databaseOptions(false, databaseHexKey),
      );
      try {
        await database.connect();
        await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
        await database.exec(RESOURCE_SCHEMA_SQL, { queryTimeout: this.#queryTimeoutMs });
        await (await database.prepare(`
          INSERT INTO _vibecanvas_resource_metadata (singleton, resource_id, resource_kind, format_version)
          VALUES (1, ?, ?, ?)
        `)).run(resourceId, this.#kind, this.#formatVersion());
      } finally {
        await this.#closeDatabase(database);
      }
      if (this.#kind === 'secretStore') await this.#syncResourceDirectory(resourceId);
      await this.#verifyStandalone(resourceId, databaseHexKey);
    } catch (error) {
      if (directoryCreated) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async verify(identity: TResourceKeyValueIdentity): Promise<void> {
    this.#assertAvailable();
    this.#assertIdentity(identity);
    return this.#scheduleLifecycle(identity.resourceId, (resourceId) => this.#verifyResource(resourceId));
  }

  async #verifyResource(resourceIdValue: string): Promise<void> {
    const resourceId = fnResourceKeyValueHostId(resourceIdValue);
    await this.#drain(resourceId);
    await this.#closeHandle(resourceId);
    await this.#verifyStandalone(resourceId);
  }

  async deleteResource(identity: TResourceKeyValueIdentity): Promise<void> {
    this.#assertAvailable();
    this.#assertIdentity(identity);
    return this.#scheduleLifecycle(identity.resourceId, (resourceId) => this.#deleteResource(resourceId));
  }

  async #deleteResource(resourceIdValue: string): Promise<void> {
    const resourceId = fnResourceKeyValueHostId(resourceIdValue);
    await this.#drain(resourceId);
    await this.#writeTails.get(resourceId);
    await this.#closeHandle(resourceId);
    await rm(this.#resourceDirectory(resourceId), { recursive: true, force: true });
  }

  async get(args: { readonly resourceId: string; readonly key: string }): Promise<TResourceKeyValueEntry | null> {
    const resourceId = this.#operationResourceId(args.resourceId);
    return this.#track(resourceId, this.#getEntry(resourceId, args.key));
  }

  async getMetadata(args: {
    readonly resourceId: string;
    readonly key: string;
  }): Promise<TResourceKeyValueEntryMetadata | null> {
    const resourceId = this.#operationResourceId(args.resourceId);
    return this.#track(resourceId, this.#getEntryMetadata(resourceId, args.key));
  }

  async has(args: { readonly resourceId: string; readonly key: string }): Promise<boolean> {
    const resourceId = this.#operationResourceId(args.resourceId);
    return this.#track(resourceId, this.#withHandle(resourceId, async (database) => {
      const row = await (await database.prepare(`
        SELECT 1 AS present
        FROM resource_entries
        WHERE key = ?
      `)).get(args.key);
      return row !== null && row !== undefined;
    }));
  }

  async count(args: { readonly resourceId: string; readonly prefix?: string; readonly search?: string }): Promise<number> {
    const resourceId = this.#operationResourceId(args.resourceId);
    return this.#track(resourceId, this.#withHandle(resourceId, async (database) => {
      const prefix = args.prefix ?? null;
      const search = args.search ?? null;
      const row = await (await database.prepare(`
        SELECT COUNT(*) AS count
        FROM resource_entries
        WHERE (? IS NULL OR substr(key, 1, length(?)) = ?)
          AND (? IS NULL OR instr(key, ?) > 0)
      `)).get(prefix, prefix, prefix, search, search) as { count?: unknown } | null | undefined;
      return Number(row?.count ?? 0);
    }));
  }

  async list(args: {
    readonly resourceId: string;
    readonly prefix?: string;
    readonly search?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<TResourceKeyValuePage> {
    const resourceId = this.#operationResourceId(args.resourceId);
    const limit = fnResourceKeyValueListLimit(args.limit);
    return this.#track(resourceId, this.#withHandle(resourceId, async (database) => {
      const prefix = args.prefix ?? null;
      const search = args.search ?? null;
      const cursor = args.cursor ?? null;
      const rows = await (await database.prepare(`
        SELECT key, value, revision, created_at, updated_at
        FROM resource_entries
        WHERE (? IS NULL OR substr(key, 1, length(?)) = ?)
          AND (? IS NULL OR instr(key, ?) > 0)
          AND (? IS NULL OR key > ?)
        ORDER BY key ASC
        LIMIT ?
      `)).all(prefix, prefix, prefix, search, search, cursor, cursor, limit + 1);
      const parsed = rows.map(fnResourceKeyValueEntry);
      const entries = parsed.slice(0, limit);
      return {
        entries,
        nextCursor: parsed.length > limit ? entries.at(-1)?.key ?? null : null,
      };
    }));
  }

  async listMetadata(args: {
    readonly resourceId: string;
    readonly prefix?: string;
    readonly search?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<TResourceKeyValuePage<TResourceKeyValueEntryMetadata>> {
    const resourceId = this.#operationResourceId(args.resourceId);
    const limit = fnResourceKeyValueListLimit(args.limit);
    return this.#track(resourceId, this.#withHandle(resourceId, async (database) => {
      const prefix = args.prefix ?? null;
      const search = args.search ?? null;
      const cursor = args.cursor ?? null;
      const rows = await (await database.prepare(`
        SELECT key, revision, created_at, updated_at
        FROM resource_entries
        WHERE (? IS NULL OR substr(key, 1, length(?)) = ?)
          AND (? IS NULL OR instr(key, ?) > 0)
          AND (? IS NULL OR key > ?)
        ORDER BY key ASC
        LIMIT ?
      `)).all(prefix, prefix, prefix, search, search, cursor, cursor, limit + 1);
      const parsed = rows.map(fnResourceKeyValueEntryMetadata);
      const entries = parsed.slice(0, limit);
      return {
        entries,
        nextCursor: parsed.length > limit ? entries.at(-1)?.key ?? null : null,
      };
    }));
  }

  async set(args: { readonly resourceId: string; readonly key: string; readonly value: TJson }): Promise<TResourceKeyValueEntry> {
    const resourceId = this.#operationResourceId(args.resourceId);
    const serialized = fnResourceKeyValueSerialize(args.value);
    return this.#scheduleWrite(resourceId, async () => {
      await this.#withHandle(resourceId, async (database) => {
        await (await database.prepare(`
          INSERT INTO resource_entries (key, value)
          VALUES (?, ?)
          ON CONFLICT (key) DO UPDATE SET
            value = excluded.value,
            revision = resource_entries.revision + 1
        `)).run(args.key, serialized);
      });
      const entry = await this.#getEntry(resourceId, args.key);
      if (!entry) throw new Error('Resource key-value set succeeded without a persisted entry.');
      return entry;
    });
  }

  async delete(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly expectedRevision?: number;
  }): Promise<TResourceKeyValueDeleteResult> {
    const resourceId = this.#operationResourceId(args.resourceId);
    if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1)) {
      throw new RangeError('Expected revision must be a positive integer.');
    }
    return this.#scheduleWrite(resourceId, () => this.#withHandle(resourceId, async (database) => {
      const result = await (await database.prepare(`
        DELETE FROM resource_entries
        WHERE key = ? AND (? IS NULL OR revision = ?)
      `)).run(args.key, args.expectedRevision ?? null, args.expectedRevision ?? null);
      return { deleted: result.changes > 0 };
    }));
  }

  async compareAndSet(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly expectedRevision: number | null;
    readonly value: TJson;
  }): Promise<TResourceKeyValueCompareAndSetResult> {
    const resourceId = this.#operationResourceId(args.resourceId);
    if (args.expectedRevision !== null && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1)) {
      throw new RangeError('Expected revision must be null or a positive integer.');
    }
    const serialized = fnResourceKeyValueSerialize(args.value);
    return this.#scheduleWrite(resourceId, async () => {
      const changes = await this.#withHandle(resourceId, async (database) => {
        const result = args.expectedRevision === null
          ? await (await database.prepare(`
              INSERT INTO resource_entries (key, value)
              VALUES (?, ?)
              ON CONFLICT (key) DO NOTHING
            `)).run(args.key, serialized)
          : await (await database.prepare(`
              UPDATE resource_entries
              SET value = ?, revision = revision + 1
              WHERE key = ? AND revision = ?
            `)).run(serialized, args.key, args.expectedRevision);
        return result.changes;
      });
      const current = await this.#getEntry(resourceId, args.key);
      if (changes === 0) {
        return {
          ok: false,
          expectedRevision: args.expectedRevision,
          currentRevision: current?.revision ?? null,
        };
      }
      if (!current) throw new Error('Resource key-value CAS succeeded without a persisted entry.');
      return { ok: true, entry: current };
    });
  }

  async mutateWithReceipt(
    request: TResourceKeyValueReceiptMutationRequest,
    guard: IResourceWritePermitGuard,
  ): Promise<TResourceKeyValueMutationReceipt> {
    const resourceId = this.#operationResourceId(request.resourceId);
    if (
      request.invocationId.length === 0
      || request.attemptId.length === 0
      || request.operationId.length === 0
      || !/^[0-9a-f]{64}$/.test(request.operationFingerprintSha256)
    ) {
      throw new TypeError('Resource operation receipt identity is invalid.');
    }
    const mutation = request.mutation;
    const serializedValue = mutation.operation === 'delete'
      ? null
      : fnResourceKeyValueSerialize(mutation.value);
    if (
      mutation.operation === 'delete'
      && mutation.expectedRevision !== undefined
      && (!Number.isInteger(mutation.expectedRevision) || mutation.expectedRevision < 1)
    ) throw new RangeError('Expected revision must be a positive integer.');
    if (
      mutation.operation === 'compareAndSet'
      && mutation.expectedRevision !== null
      && (!Number.isInteger(mutation.expectedRevision) || mutation.expectedRevision < 1)
    ) throw new RangeError('Expected revision must be null or a positive integer.');

    return this.#scheduleWrite(resourceId, () => this.#withHandle(resourceId, async (database) => {
      await database.exec('BEGIN IMMEDIATE;', { queryTimeout: this.#queryTimeoutMs });
      try {
        const prior = await (await database.prepare(`
          SELECT operation_name, operation_fingerprint_sha256, output_json
          FROM _vibecanvas_function_operation_receipts
          WHERE invocation_id = ? AND operation_id = ?
        `)).get(request.invocationId, request.operationId) as Record<string, unknown> | null | undefined;
        if (prior) {
          if (
            prior.operation_name !== mutation.operation
            || prior.operation_fingerprint_sha256 !== request.operationFingerprintSha256
          ) {
            throw new Error('Resource operation receipt identity conflicts with its persisted mutation.');
          }
          const output = fnResourceKeyValueParse(prior.output_json);
          await guard.assertCanCommit();
          await database.exec('COMMIT;', { queryTimeout: this.#queryTimeoutMs });
          return { output, committed: true, replayed: true };
        }

        let output: TJson;
        if (mutation.operation === 'set') {
          await (await database.prepare(`
            INSERT INTO resource_entries (key, value)
            VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET
              value = excluded.value,
              revision = resource_entries.revision + 1
          `)).run(mutation.key, serializedValue);
          const entry = await this.#getEntryFromDatabase(database, mutation.key);
          if (!entry) throw new Error('Resource set succeeded without a persisted entry.');
          output = this.#kind === 'kv'
            ? { value: entry.value, revision: entry.revision }
            : { name: entry.key, revision: entry.revision };
        } else if (mutation.operation === 'delete') {
          const result = await (await database.prepare(`
            DELETE FROM resource_entries
            WHERE key = ? AND (? IS NULL OR revision = ?)
          `)).run(
            mutation.key,
            mutation.expectedRevision ?? null,
            mutation.expectedRevision ?? null,
          );
          output = { deleted: result.changes > 0 };
        } else {
          const result = mutation.expectedRevision === null
            ? await (await database.prepare(`
                INSERT INTO resource_entries (key, value)
                VALUES (?, ?)
                ON CONFLICT (key) DO NOTHING
              `)).run(mutation.key, serializedValue)
            : await (await database.prepare(`
                UPDATE resource_entries
                SET value = ?, revision = revision + 1
                WHERE key = ? AND revision = ?
              `)).run(serializedValue, mutation.key, mutation.expectedRevision);
          const current = await this.#getEntryFromDatabase(database, mutation.key);
          output = result.changes === 0
            ? { ok: false, currentRevision: current?.revision ?? null }
            : current === null
              ? (() => { throw new Error('Resource CAS succeeded without a persisted entry.'); })()
              : this.#kind === 'kv'
                ? { ok: true, entry: { value: current.value, revision: current.revision } }
                : { ok: true, entry: { name: current.key, revision: current.revision } };
        }
        const outputJson = fnResourceKeyValueSerialize(output);
        await guard.assertCanCommit();
        await (await database.prepare(`
          INSERT INTO _vibecanvas_function_operation_receipts (
            invocation_id, operation_id, attempt_id, operation_name,
            operation_fingerprint_sha256, output_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)).run(
          request.invocationId,
          request.operationId,
          request.attemptId,
          mutation.operation,
          request.operationFingerprintSha256,
          outputJson,
        );
        await database.exec('COMMIT;', { queryTimeout: this.#queryTimeoutMs });
        return { output, committed: true, replayed: false };
      } catch (error) {
        await database.exec('ROLLBACK;', { queryTimeout: this.#queryTimeoutMs }).catch(() => undefined);
        throw error;
      }
    }));
  }

  async readCommittedOperation(args: {
    readonly resourceId: string;
    readonly invocationId: string;
    readonly operationId: string;
  }): Promise<TResourceKeyValueCommittedOperation | null> {
    const resourceId = this.#operationResourceId(args.resourceId);
    if (args.invocationId.length === 0 || args.operationId.length === 0) {
      throw new TypeError('Resource operation receipt identity is invalid.');
    }
    return this.#withHandle(resourceId, async (database) => {
      const row = await (await database.prepare(`
        SELECT invocation_id, operation_id, attempt_id, operation_name,
          operation_fingerprint_sha256, output_json
        FROM _vibecanvas_function_operation_receipts
        WHERE invocation_id = ? AND operation_id = ?
      `)).get(args.invocationId, args.operationId) as Record<string, unknown> | null | undefined;
      if (!row) return null;
      if (
        typeof row.invocation_id !== 'string'
        || typeof row.operation_id !== 'string'
        || typeof row.attempt_id !== 'string'
        || typeof row.operation_name !== 'string'
        || typeof row.operation_fingerprint_sha256 !== 'string'
      ) throw new Error('Resource operation receipt is invalid.');
      return {
        invocationId: row.invocation_id,
        operationId: row.operation_id,
        attemptId: row.attempt_id,
        operationName: row.operation_name,
        operationFingerprintSha256: row.operation_fingerprint_sha256,
        output: fnResourceKeyValueParse(row.output_json),
      };
    });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#cancelIdleSweep?.();
    this.#cancelIdleSweep = null;
    const closing = (async () => {
      await this.#handleAdmissionTail;
      await Promise.allSettled([...this.#lifecycle]);
      await Promise.allSettled([...this.#inFlight.values()].flatMap((calls) => [...calls]));
      await Promise.allSettled([...this.#writeTails.values()]);
      const handles = [...this.#handles.entries()];
      const results = await Promise.allSettled(handles.map(([resourceId]) => this.#closeHandle(resourceId)));
      const failures = results.flatMap((result, index) => (
        result.status === 'rejected'
          && (handles[index]![1].database === null || !this.#failedCloses.has(handles[index]![1].database!))
          ? [result.reason]
          : []
      ));
      const retryResults = await Promise.allSettled([...this.#failedCloses].map((database) => this.#closeDatabase(database)));
      failures.push(...retryResults
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason));
      if (failures.length > 0) throw new AggregateError(failures, 'One or more resource key-value handles failed to close.');
    })();
    this.#closePromise = closing;
    void closing.catch(() => {
      if (this.#closePromise === closing) this.#closePromise = null;
    });
    return closing;
  }

  async #verifyStandalone(resourceId: string, knownDatabaseHexKey?: string): Promise<void> {
    if (this.#kind === 'secretStore') {
      const databaseHexKey = knownDatabaseHexKey
        ?? await this.#databaseHexKey(resourceId, await this.#canCreateSecretDatabaseKey(resourceId));
      await this.#reconcileSecretDatabase(resourceId, databaseHexKey!);
      return;
    }
    await this.#assertDatabaseFile(resourceId);
    const database = this.#databaseFactory(this.#databasePath(resourceId), this.#databaseOptions(true));
    try {
      await database.connect();
      await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
      await this.#verifyDatabase(database, resourceId, KV_FORMAT_VERSION);
    } finally {
      await this.#closeDatabase(database);
    }
  }

  async #verifyDatabase(database: Database, resourceId: string, formatVersion: number): Promise<void> {
    const health = await (await database.prepare('PRAGMA quick_check;')).all();
    if (health.length !== 1 || !Object.values(health[0] ?? {}).some((value) => value === 'ok')) {
      throw new Error('Resource key-value database health check failed.');
    }
    const metadata = await (await database.prepare(`
      SELECT singleton, resource_id, resource_kind, format_version
      FROM _vibecanvas_resource_metadata
      ORDER BY singleton
    `)).all() as TMetadataRow[];
    const row = metadata[0];
    if (
      metadata.length !== 1
      || Number(row?.singleton) !== 1
      || row?.resource_id !== resourceId
      || row?.resource_kind !== this.#kind
      || Number(row?.format_version) !== formatVersion
    ) {
      throw new Error('Resource key-value physical identity does not match its catalog resource.');
    }
    await (await database.prepare(`
      SELECT key, value, revision, created_at, updated_at
      FROM resource_entries
      LIMIT 0
    `)).all();
    await (await database.prepare(`
      SELECT invocation_id, operation_id, attempt_id, operation_name,
        operation_fingerprint_sha256, output_json, committed_at
      FROM _vibecanvas_function_operation_receipts
      LIMIT 0
    `)).all();
    const metadataColumns = await (await database.prepare('PRAGMA table_info(_vibecanvas_resource_metadata);')).all() as TTableInfoRow[];
    const entryColumns = await (await database.prepare('PRAGMA table_info(resource_entries);')).all() as TTableInfoRow[];
    const receiptColumns = await (await database.prepare('PRAGMA table_info(_vibecanvas_function_operation_receipts);')).all() as TTableInfoRow[];
    const columnsMatch = (actual: readonly TTableInfoRow[], expected: readonly (readonly [string, string, number, number])[]) => (
      actual.length === expected.length
      && expected.every(([name, type, notnull, pk], index) => (
        actual[index]?.name === name
        && actual[index]?.type === type
        && Number(actual[index]?.notnull) === notnull
        && Number(actual[index]?.pk) === pk
      ))
    );
    if (!columnsMatch(metadataColumns, [
      ['singleton', 'INTEGER', 0, 1],
      ['resource_id', 'TEXT', 1, 0],
      ['resource_kind', 'TEXT', 1, 0],
      ['format_version', 'INTEGER', 1, 0],
    ]) || !columnsMatch(entryColumns, [
      ['key', 'TEXT', 0, 1],
      ['value', 'JSON', 1, 0],
      ['revision', 'INTEGER', 1, 0],
      ['created_at', 'TEXT', 1, 0],
      ['updated_at', 'TEXT', 1, 0],
    ]) || !columnsMatch(receiptColumns, [
      ['invocation_id', 'TEXT', 1, 1],
      ['operation_id', 'TEXT', 1, 1],
      ['attempt_id', 'TEXT', 1, 0],
      ['operation_name', 'TEXT', 1, 0],
      ['operation_fingerprint_sha256', 'TEXT', 1, 0],
      ['output_json', 'JSON', 1, 0],
      ['committed_at', 'TEXT', 1, 0],
    ])) {
      throw new Error('Resource key-value physical columns are invalid.');
    }
    const tableList = await (await database.prepare('PRAGMA table_list;')).all() as TTableListRow[];
    for (const tableName of [
      '_vibecanvas_resource_metadata',
      'resource_entries',
      '_vibecanvas_function_operation_receipts',
    ]) {
      const table = tableList.find((candidate) => candidate.name === tableName);
      if (Number(table?.strict) !== 1 || Number(table?.wr) !== 0) {
        throw new Error('Resource key-value physical tables must use strict rowid storage.');
      }
    }
    const schemaObjects = await (await database.prepare(`
      SELECT type, name, tbl_name, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `)).all() as TSchemaObjectRow[];
    const expectedSchemaObjects = [
      ['table', '_vibecanvas_function_operation_receipts', '_vibecanvas_function_operation_receipts', RESOURCE_OPERATION_RECEIPTS_SCHEMA_SQL],
      ['table', '_vibecanvas_resource_metadata', '_vibecanvas_resource_metadata', RESOURCE_METADATA_SCHEMA_SQL],
      ['table', 'resource_entries', 'resource_entries', RESOURCE_ENTRIES_SCHEMA_SQL],
      ['trigger', 'resource_entries_updated_at_after_update', 'resource_entries', RESOURCE_UPDATED_AT_TRIGGER_SQL],
    ] as const;
    if (
      schemaObjects.length !== expectedSchemaObjects.length
      || expectedSchemaObjects.some(([type, name, tableName, sql], index) => (
        schemaObjects[index]?.type !== type
        || schemaObjects[index]?.name !== name
        || schemaObjects[index]?.tbl_name !== tableName
        || typeof schemaObjects[index]?.sql !== 'string'
        || normalizeSchemaSql(schemaObjects[index].sql) !== normalizeSchemaSql(sql)
      ))
    ) {
      throw new Error('Resource key-value physical schema is incomplete.');
    }
  }

  async #reconcileSecretDatabase(resourceId: string, databaseHexKey: string): Promise<void> {
    const databasePath = this.#databasePath(resourceId);
    const temporaryPath = this.#encryptedTemporaryPath(resourceId);
    const recoveryPath = this.#plaintextRecoveryPath(resourceId);
    const state = await this.#databaseFileState(databasePath);

    if (state === 'encrypted') {
      await this.#recoverPromotedSidecars(temporaryPath, databasePath);
      await this.#verifyEncryptedPath(databasePath, resourceId, databaseHexKey);
      const recoveryState = await this.#databaseFileState(recoveryPath);
      if (recoveryState === 'plaintext') {
        await this.#assertEncryptedMatchesRecovery(databasePath, recoveryPath, resourceId, databaseHexKey);
      } else if (recoveryState !== 'missing') {
        throw this.#decryptionFailed();
      }
      await this.#removeDatabaseArtifacts(temporaryPath);
      await this.#removeDatabaseArtifacts(recoveryPath);
      await this.#syncResourceDirectory(resourceId);
      return;
    }

    if (state === 'plaintext') {
      await this.#convertPlaintextDatabase(resourceId, databaseHexKey);
      return;
    }

    if (state === 'missing') {
      const temporaryState = await this.#databaseFileState(temporaryPath);
      if (temporaryState === 'encrypted') {
        const recoveryState = await this.#databaseFileState(recoveryPath);
        if (recoveryState !== 'plaintext') throw this.#decryptionFailed();
        await this.#recoverPromotedSidecars(databasePath, recoveryPath);
        await this.#assertEncryptedMatchesRecovery(temporaryPath, recoveryPath, resourceId, databaseHexKey);
        await this.#assertEncryptedAccessRejected(temporaryPath, resourceId, databaseHexKey);
        await this.#moveDatabaseArtifacts(temporaryPath, databasePath);
        await this.#syncResourceDirectory(resourceId);
        await this.#verifyEncryptedPath(databasePath, resourceId, databaseHexKey);
        await this.#assertEncryptedMatchesRecovery(databasePath, recoveryPath, resourceId, databaseHexKey);
        await this.#removeDatabaseArtifacts(recoveryPath);
        await this.#syncResourceDirectory(resourceId);
        return;
      }
      if (temporaryState !== 'missing') throw this.#decryptionFailed();

      const recoveryState = await this.#databaseFileState(recoveryPath);
      if (recoveryState !== 'plaintext') throw this.#decryptionFailed();
      await this.#recoverPromotedSidecars(databasePath, recoveryPath);
      const recovery = await this.#openVerifiedPlaintextDatabase(recoveryPath, resourceId);
      await this.#closeDatabase(recovery);
      await this.#moveDatabaseArtifacts(recoveryPath, databasePath);
      await this.#syncResourceDirectory(resourceId);
      await this.#convertPlaintextDatabase(resourceId, databaseHexKey);
      return;
    }

    throw this.#decryptionFailed();
  }

  async #convertPlaintextDatabase(resourceId: string, databaseHexKey: string): Promise<void> {
    const databasePath = this.#databasePath(resourceId);
    const temporaryPath = this.#encryptedTemporaryPath(resourceId);
    const recoveryPath = this.#plaintextRecoveryPath(resourceId);
    let source: Database | null = await this.#openVerifiedPlaintextDatabase(databasePath, resourceId);

    try {
      await source.exec('PRAGMA wal_checkpoint(TRUNCATE);', { queryTimeout: this.#queryTimeoutMs });
      await this.#removeDatabaseArtifacts(temporaryPath);
      await this.#removeDatabaseArtifacts(recoveryPath);

      const destination = this.#databaseFactory(
        temporaryPath,
        this.#databaseOptions(false, databaseHexKey),
      );
      try {
        await destination.connect();
        await destination.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
        await destination.exec(RESOURCE_SCHEMA_SQL, { queryTimeout: this.#queryTimeoutMs });
        await (await destination.prepare(`
          INSERT INTO _vibecanvas_resource_metadata (singleton, resource_id, resource_kind, format_version)
          VALUES (1, ?, 'secretStore', ?)
        `)).run(resourceId, SECRET_STORE_FORMAT_VERSION);
        await this.#conversionCheckpoint('temporary-created', resourceId);
        await destination.exec('BEGIN IMMEDIATE;', { queryTimeout: this.#queryTimeoutMs });
        try {
          await this.#copyEntries(source, destination);
          await destination.exec('COMMIT;', { queryTimeout: this.#queryTimeoutMs });
          await this.#conversionCheckpoint('entries-copied', resourceId);
        } catch (error) {
          await destination.exec('ROLLBACK;', { queryTimeout: this.#queryTimeoutMs }).catch(() => undefined);
          throw error;
        }
        await destination.exec('PRAGMA wal_checkpoint(TRUNCATE);', { queryTimeout: this.#queryTimeoutMs });
        await this.#conversionCheckpoint('temporary-checkpointed', resourceId);
      } finally {
        await this.#closeDatabase(destination);
      }

      const encryptedCopy = await this.#openVerifiedEncryptedDatabase(
        temporaryPath,
        resourceId,
        databaseHexKey,
      );
      try {
        await this.#assertSameEntries(source, encryptedCopy);
      } finally {
        await this.#closeDatabase(encryptedCopy);
      }
      await this.#assertEncryptedAccessRejected(temporaryPath, resourceId, databaseHexKey);
      await this.#conversionCheckpoint('temporary-verified', resourceId);
    } finally {
      if (source) {
        const closing = source;
        source = null;
        await this.#closeDatabase(closing);
      }
    }

    await this.#conversionCheckpoint('source-closed', resourceId);

    await this.#moveDatabaseArtifacts(databasePath, recoveryPath);
    await this.#syncResourceDirectory(resourceId);
    await this.#conversionCheckpoint('plaintext-renamed', resourceId);
    await this.#moveDatabaseArtifacts(temporaryPath, databasePath);
    await this.#syncResourceDirectory(resourceId);
    await this.#conversionCheckpoint('encrypted-renamed', resourceId);
    await this.#verifyEncryptedPath(databasePath, resourceId, databaseHexKey);
    await this.#conversionCheckpoint('final-reopened', resourceId);
    await this.#assertEncryptedMatchesRecovery(databasePath, recoveryPath, resourceId, databaseHexKey);
    await this.#conversionCheckpoint('before-recovery-cleanup', resourceId);
    await this.#removeDatabaseArtifacts(recoveryPath);
    await this.#syncResourceDirectory(resourceId);
  }

  async #copyEntries(source: Database, destination: Database): Promise<void> {
    let cursor: string | null = null;
    const insert = await destination.prepare(`
      INSERT INTO resource_entries (key, value, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    while (true) {
      const rows = await this.#copyEntryPage(source, cursor);
      for (const row of rows) {
        await insert.run(
          row.key,
          row.serializedValue,
          row.revision,
          row.createdAt,
          row.updatedAt,
        );
      }
      if (rows.length < COPY_PAGE_SIZE) return;
      cursor = rows.at(-1)!.key;
    }
  }

  async #assertSameEntries(source: Database, destination: Database): Promise<void> {
    let cursor: string | null = null;
    while (true) {
      const sourceRows = await this.#copyEntryPage(source, cursor);
      const destinationRows = await this.#copyEntryPage(destination, cursor);
      if (sourceRows.length !== destinationRows.length) throw this.#decryptionFailed();
      for (const [index, sourceRow] of sourceRows.entries()) {
        const destinationRow = destinationRows[index];
        if (
          !destinationRow
          || sourceRow.key !== destinationRow.key
          || sourceRow.serializedValue !== destinationRow.serializedValue
          || sourceRow.revision !== destinationRow.revision
          || sourceRow.createdAt !== destinationRow.createdAt
          || sourceRow.updatedAt !== destinationRow.updatedAt
        ) {
          throw this.#decryptionFailed();
        }
      }
      if (sourceRows.length < COPY_PAGE_SIZE) return;
      cursor = sourceRows.at(-1)!.key;
    }
  }

  async #assertEncryptedMatchesRecovery(
    encryptedPath: string,
    recoveryPath: string,
    resourceId: string,
    databaseHexKey: string,
  ): Promise<void> {
    const recovery = await this.#openVerifiedPlaintextDatabase(recoveryPath, resourceId);
    try {
      const encrypted = await this.#openVerifiedEncryptedDatabase(encryptedPath, resourceId, databaseHexKey);
      try {
        await this.#assertSameEntries(recovery, encrypted);
      } finally {
        await this.#closeDatabase(encrypted);
      }
    } finally {
      await this.#closeDatabase(recovery);
    }
  }

  async #copyEntryPage(database: Database, cursor: string | null): Promise<readonly {
    readonly key: string;
    readonly serializedValue: string;
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[]> {
    const rows = await (await database.prepare(`
      SELECT key, CAST(value AS TEXT) AS serialized_value, revision, created_at, updated_at
      FROM resource_entries
      WHERE (? IS NULL OR key > ?)
      ORDER BY key ASC
      LIMIT ?
    `)).all(cursor, cursor, COPY_PAGE_SIZE) as TCopyEntryRow[];
    return rows.map((row) => {
      if (
        typeof row.key !== 'string'
        || typeof row.serialized_value !== 'string'
        || !Number.isInteger(Number(row.revision))
        || Number(row.revision) < 1
        || typeof row.created_at !== 'string'
        || typeof row.updated_at !== 'string'
      ) {
        throw this.#decryptionFailed();
      }
      return {
        key: row.key,
        serializedValue: row.serialized_value,
        revision: Number(row.revision),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  async #verifyEncryptedPath(
    databasePath: string,
    resourceId: string,
    databaseHexKey: string,
    proveRejected = false,
  ): Promise<void> {
    const database = await this.#openVerifiedEncryptedDatabase(databasePath, resourceId, databaseHexKey);
    await this.#closeDatabase(database);
    if (proveRejected) await this.#assertEncryptedAccessRejected(databasePath, resourceId, databaseHexKey);
  }

  async #openVerifiedEncryptedDatabase(
    databasePath: string,
    resourceId: string,
    databaseHexKey: string,
  ): Promise<Database> {
    const database = this.#databaseFactory(databasePath, this.#databaseOptions(true, databaseHexKey));
    try {
      await database.connect();
      await this.#verifyDatabase(database, resourceId, SECRET_STORE_FORMAT_VERSION);
      await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
      return database;
    } catch {
      await this.#closeDatabase(database).catch(() => undefined);
      throw this.#decryptionFailed();
    }
  }

  async #openVerifiedPlaintextDatabase(databasePath: string, resourceId: string): Promise<Database> {
    const database = this.#databaseFactory(databasePath, this.#unencryptedDatabaseOptions(true));
    try {
      await database.connect();
      await this.#verifyDatabase(database, resourceId, KV_FORMAT_VERSION);
      await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
      return database;
    } catch {
      await this.#closeDatabase(database).catch(() => undefined);
      throw this.#decryptionFailed();
    }
  }

  async #assertEncryptedAccessRejected(
    databasePath: string,
    resourceId: string,
    databaseHexKey: string,
  ): Promise<void> {
    const wrongDatabaseHexKey = `${databaseHexKey[0] === '0' ? '1' : '0'}${databaseHexKey.slice(1)}`;
    for (const options of [
      this.#unencryptedDatabaseOptions(true),
      this.#databaseOptions(true, wrongDatabaseHexKey),
    ]) {
      const database = this.#databaseFactory(databasePath, options);
      let accessRejected = false;
      try {
        await database.connect();
        await (await database.prepare(`
          SELECT resource_id
          FROM _vibecanvas_resource_metadata
          WHERE singleton = 1 AND resource_id = ?
        `)).get(resourceId);
      } catch {
        accessRejected = true;
      } finally {
        await this.#closeDatabase(database).catch(() => undefined);
      }
      if (!accessRejected) throw this.#decryptionFailed();
    }
  }

  async #databaseFileState(databasePath: string): Promise<TDatabaseFileState> {
    let before;
    try {
      before = await lstat(databasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 'missing';
      throw error;
    }
    if (before.isSymbolicLink() || !before.isFile()) return 'unknown';
    const databaseFile = await open(databasePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const header = Buffer.alloc(SQLITE_HEADER.length);
    try {
      const opened = await databaseFile.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return 'unknown';
      const { bytesRead } = await databaseFile.read(header, 0, header.length, 0);
      const contents = header.subarray(0, bytesRead);
      if (contents.length >= TURSO_ENCRYPTED_HEADER.length
        && contents.subarray(0, TURSO_ENCRYPTED_HEADER.length).equals(TURSO_ENCRYPTED_HEADER)) {
        return 'encrypted';
      }
      if (contents.length >= SQLITE_HEADER.length && contents.equals(SQLITE_HEADER)) return 'plaintext';
      return 'unknown';
    } finally {
      header.fill(0);
      await databaseFile.close().catch(() => undefined);
    }
  }

  async #canCreateSecretDatabaseKey(resourceId: string): Promise<boolean> {
    const state = await this.#databaseFileState(this.#databasePath(resourceId));
    if (state === 'plaintext') return true;
    if (state !== 'missing') return false;

    const temporaryState = await this.#databaseFileState(this.#encryptedTemporaryPath(resourceId));
    if (temporaryState !== 'missing') return false;
    return await this.#databaseFileState(this.#plaintextRecoveryPath(resourceId)) === 'plaintext';
  }

  async #removeDatabaseArtifacts(databasePath: string): Promise<void> {
    await this.#removeDatabaseSidecars(databasePath);
    await rm(databasePath, { force: true });
  }

  async #removeDatabaseSidecars(databasePath: string): Promise<void> {
    await Promise.all([
      rm(`${databasePath}-wal`, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
      rm(`${databasePath}-tshm`, { force: true }),
    ]);
  }

  async #moveDatabaseArtifacts(fromPath: string, toPath: string): Promise<void> {
    await rename(fromPath, toPath);
    for (const suffix of ['-wal', '-shm', '-tshm']) {
      await this.#renameIfPresent(`${fromPath}${suffix}`, `${toPath}${suffix}`);
    }
  }

  async #recoverPromotedSidecars(fromPath: string, toPath: string): Promise<void> {
    for (const suffix of ['-wal', '-shm', '-tshm']) {
      const from = `${fromPath}${suffix}`;
      const to = `${toPath}${suffix}`;
      if (await this.#pathExists(to)) continue;
      await this.#renameIfPresent(from, to);
    }
  }

  async #renameIfPresent(fromPath: string, toPath: string): Promise<void> {
    try {
      await rename(fromPath, toPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }

  async #pathExists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async #syncResourceDirectory(resourceId: string): Promise<void> {
    const directory = await open(this.#resourceDirectory(resourceId), fsConstants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close().catch(() => undefined);
    }
  }

  #decryptionFailed(): ResourceError {
    return new ResourceError(
      'SECRET_STORE_DECRYPTION_FAILED',
      'The secret-store database could not be decrypted or verified.',
    );
  }

  async #conversionCheckpoint(
    checkpoint: TSecretStoreConversionCheckpoint,
    resourceId: string,
  ): Promise<void> {
    await this.#secretStoreConversionCheckpoint?.(checkpoint, resourceId);
  }

  async #withHandle<T>(resourceId: string, operation: (database: Database) => Promise<T>): Promise<T> {
    const state = await this.#acquireHandle(resourceId);
    try {
      return await operation(await state.opening);
    } finally {
      state.inFlight -= 1;
      state.lastUsed = ++this.#lastUse;
      state.idleSinceMs = state.inFlight === 0 ? this.#nowMs() : null;
      this.#notifyHandleCapacity();
      await this.#evictIdleHandles();
      this.#scheduleNextIdleSweep();
    }
  }

  #acquireHandle(resourceId: string): Promise<THandleState> {
    const cached = this.#handles.get(resourceId);
    if (cached) {
      this.#retainHandle(cached);
      return Promise.resolve(cached);
    }
    const admission = this.#handleAdmissionTail.then(() => this.#admitHandle(resourceId));
    this.#handleAdmissionTail = admission.then(() => undefined, () => undefined);
    return admission;
  }

  async #admitHandle(resourceId: string): Promise<THandleState> {
    const cached = this.#handles.get(resourceId);
    if (cached) {
      this.#retainHandle(cached);
      return cached;
    }
    await this.#makeHandleCapacity();
    const admitted = this.#handles.get(resourceId);
    if (admitted) {
      this.#retainHandle(admitted);
      return admitted;
    }
    const state: THandleState = {
      opening: Promise.resolve(null as never),
      database: null,
      inFlight: 1,
      lastUsed: ++this.#lastUse,
      idleSinceMs: null,
    };
    const opening = (async () => {
      await this.#assertDatabaseFile(resourceId);
      const database = this.#databaseFactory(
        this.#databasePath(resourceId),
        this.#databaseOptions(true, await this.#databaseHexKey(resourceId)),
      );
      try {
        await database.connect();
        await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
        await this.#verifyDatabase(database, resourceId, this.#formatVersion());
        state.database = database;
        return database;
      } catch (error) {
        await this.#closeDatabase(database).catch(() => undefined);
        throw error;
      }
    })();
    Object.assign(state, { opening });
    this.#handles.set(resourceId, state);
    void opening.catch(() => {
      if (this.#handles.get(resourceId) === state) {
        this.#handles.delete(resourceId);
        this.#notifyHandleCapacity();
        this.#scheduleNextIdleSweep();
      }
    });
    return state;
  }

  #retainHandle(state: THandleState): void {
    state.inFlight += 1;
    state.lastUsed = ++this.#lastUse;
    state.idleSinceMs = null;
  }

  async #makeHandleCapacity(): Promise<void> {
    while (this.openHandleCount >= this.#maxOpenHandles) {
      if (this.#failedCloses.size > 0) {
        await Promise.allSettled([...this.#failedCloses].map((database) => this.#closeDatabase(database)));
        if (this.openHandleCount < this.#maxOpenHandles) return;
      }
      const candidate = this.#idleHandleCandidate();
      if (candidate) {
        await this.#closeHandle(candidate[0]);
        continue;
      }
      await new Promise<void>((resolve) => this.#handleCapacityWaiters.add(resolve));
    }
  }

  #idleHandleCandidate(): [string, THandleState] | undefined {
    return [...this.#handles.entries()]
      .filter(([resourceId, state]) => (
        state.database !== null
        && state.inFlight === 0
        && (this.#pendingWrites.get(resourceId) ?? 0) === 0
      ))
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
  }

  #notifyHandleCapacity(): void {
    const waiters = [...this.#handleCapacityWaiters];
    this.#handleCapacityWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  async #evictIdleHandles(): Promise<void> {
    if (this.#failedCloses.size > 0) {
      await Promise.allSettled([...this.#failedCloses].map((database) => this.#closeDatabase(database)));
    }
    while (this.openHandleCount > this.#maxOpenHandles) {
      const candidate = this.#idleHandleCandidate();
      if (!candidate) return;
      await this.#closeHandle(candidate[0]).catch(() => undefined);
    }
  }

  #scheduleNextIdleSweep(): void {
    this.#cancelIdleSweep?.();
    this.#cancelIdleSweep = null;
    if (this.#closed || (this.#handles.size === 0 && this.#failedCloses.size === 0)) return;

    const nowMs = this.#nowMs();
    let delayMs = this.#idleHandleTimeoutMs;
    for (const [resourceId, state] of this.#handles) {
      const busy = state.inFlight > 0 || (this.#pendingWrites.get(resourceId) ?? 0) > 0;
      const candidateDelay = busy || state.idleSinceMs === null
        ? this.#idleHandleTimeoutMs
        : Math.max(1, state.idleSinceMs + this.#idleHandleTimeoutMs - nowMs);
      delayMs = Math.min(delayMs, candidateDelay);
    }
    this.#cancelIdleSweep = this.#scheduleIdleSweep(async () => {
      this.#cancelIdleSweep = null;
      await this.#closeExpiredIdleHandles();
    }, delayMs);
  }

  async #closeExpiredIdleHandles(): Promise<void> {
    if (this.#closed) return;
    const admission = this.#handleAdmissionTail.then(async () => {
      if (this.#failedCloses.size > 0) {
        await Promise.allSettled([...this.#failedCloses].map((database) => this.#closeDatabase(database)));
      }
      const expiredBeforeMs = this.#nowMs() - this.#idleHandleTimeoutMs;
      const candidates = [...this.#handles.entries()].filter(([resourceId, state]) => (
        state.database !== null
        && state.inFlight === 0
        && (this.#pendingWrites.get(resourceId) ?? 0) === 0
        && state.idleSinceMs !== null
        && state.idleSinceMs <= expiredBeforeMs
      ));
      for (const [resourceId] of candidates) {
        await this.#closeHandle(resourceId).catch(() => undefined);
      }
    });
    this.#handleAdmissionTail = admission.then(() => undefined, () => undefined);
    await admission;
    this.#scheduleNextIdleSweep();
  }

  async #closeHandle(resourceId: string): Promise<void> {
    const state = this.#handles.get(resourceId);
    if (!state) return;
    this.#handles.delete(resourceId);
    this.#closingHandleCount += 1;
    try {
      await this.#closeDatabase(await state.opening);
    } finally {
      this.#closingHandleCount -= 1;
      this.#notifyHandleCapacity();
      this.#scheduleNextIdleSweep();
    }
  }

  async #closeDatabase(database: Database): Promise<void> {
    try {
      await database.close();
      this.#failedCloses.delete(database);
      this.#notifyHandleCapacity();
    } catch (error) {
      this.#failedCloses.add(database);
      throw error;
    }
  }

  #scheduleWrite<T>(resourceId: string, write: () => Promise<T>): Promise<T> {
    this.#assertAvailable(resourceId);
    this.#pendingWrites.set(resourceId, (this.#pendingWrites.get(resourceId) ?? 0) + 1);
    const previous = this.#writeTails.get(resourceId) ?? Promise.resolve();
    const result = previous.then(write, write).finally(() => {
      const remaining = (this.#pendingWrites.get(resourceId) ?? 1) - 1;
      if (remaining === 0) this.#pendingWrites.delete(resourceId);
      else this.#pendingWrites.set(resourceId, remaining);
    });
    const tail = result.then(() => undefined, () => undefined);
    this.#writeTails.set(resourceId, tail);
    void tail.finally(() => {
      if (this.#writeTails.get(resourceId) === tail) this.#writeTails.delete(resourceId);
      if (!this.#closed) void this.#evictIdleHandles();
    });
    return this.#track(resourceId, result);
  }

  #track<T>(resourceId: string, call: Promise<T>): Promise<T> {
    const calls = this.#inFlight.get(resourceId) ?? new Set<Promise<unknown>>();
    this.#inFlight.set(resourceId, calls);
    calls.add(call);
    void call.finally(() => {
      calls.delete(call);
      if (calls.size === 0) this.#inFlight.delete(resourceId);
    }).catch(() => undefined);
    return call;
  }

  #trackLifecycle<T>(operation: Promise<T>): Promise<T> {
    this.#lifecycle.add(operation);
    void operation.finally(() => this.#lifecycle.delete(operation)).catch(() => undefined);
    return operation;
  }

  #scheduleLifecycle<T>(
    resourceIdValue: string,
    operation: (resourceId: string) => Promise<T>,
  ): Promise<T> {
    const resourceId = fnResourceKeyValueHostId(resourceIdValue);
    this.#blockedLifecycleCounts.set(
      resourceId,
      (this.#blockedLifecycleCounts.get(resourceId) ?? 0) + 1,
    );
    const previous = this.#resourceLifecycleTails.get(resourceId) ?? Promise.resolve();
    const result = previous.then(
      () => operation(resourceId),
      () => operation(resourceId),
    ).finally(() => {
      const remaining = (this.#blockedLifecycleCounts.get(resourceId) ?? 1) - 1;
      if (remaining === 0) this.#blockedLifecycleCounts.delete(resourceId);
      else this.#blockedLifecycleCounts.set(resourceId, remaining);
    });
    const tail = result.then(() => undefined, () => undefined);
    this.#resourceLifecycleTails.set(resourceId, tail);
    void tail.finally(() => {
      if (this.#resourceLifecycleTails.get(resourceId) === tail) {
        this.#resourceLifecycleTails.delete(resourceId);
      }
    }).catch(() => undefined);
    return this.#trackLifecycle(result);
  }

  async #drain(resourceId: string): Promise<void> {
    const calls = this.#inFlight.get(resourceId);
    if (calls?.size) await Promise.allSettled([...calls]);
  }

  #getEntry(resourceId: string, key: string): Promise<TResourceKeyValueEntry | null> {
    return this.#withHandle(resourceId, async (database) => {
      return this.#getEntryFromDatabase(database, key);
    });
  }

  async #getEntryFromDatabase(
    database: Database,
    key: string,
  ): Promise<TResourceKeyValueEntry | null> {
    const row = await (await database.prepare(`
      SELECT key, value, revision, created_at, updated_at
      FROM resource_entries
      WHERE key = ?
    `)).get(key);
    return row ? fnResourceKeyValueEntry(row) : null;
  }

  #getEntryMetadata(resourceId: string, key: string): Promise<TResourceKeyValueEntryMetadata | null> {
    return this.#withHandle(resourceId, async (database) => {
      const row = await (await database.prepare(`
        SELECT key, revision, created_at, updated_at
        FROM resource_entries
        WHERE key = ?
      `)).get(key);
      return row ? fnResourceKeyValueEntryMetadata(row) : null;
    });
  }

  #operationResourceId(resourceId: string): string {
    this.#assertAvailable(resourceId);
    return fnResourceKeyValueHostId(resourceId);
  }

  #assertIdentity(identity: TResourceKeyValueIdentity): void {
    fnResourceKeyValueHostId(identity.resourceId);
    if (identity.kind !== this.#kind) {
      throw new TypeError('Resource kind does not match the physical key-value store.');
    }
  }

  #assertAvailable(resourceId?: string): void {
    if (this.#closed) throw new Error('Resource key-value store is closed.');
    if (resourceId && (this.#blockedLifecycleCounts.get(resourceId) ?? 0) > 0) {
      throw new Error('Resource key-value store is unavailable during lifecycle work.');
    }
  }

  #databaseOptions(
    fileMustExist: boolean,
    databaseHexKey?: string,
  ): TResourceKeyValueDatabaseOptions {
    return {
      ...this.#unencryptedDatabaseOptions(fileMustExist),
      ...(this.#kind === 'secretStore'
        ? { encryption: { cipher: 'aegis256' as const, hexkey: databaseHexKey! } }
        : {}),
    };
  }

  #unencryptedDatabaseOptions(fileMustExist: boolean): TResourceKeyValueDatabaseOptions {
    return {
      fileMustExist,
      defaultQueryTimeout: this.#queryTimeoutMs,
      experimental: ['custom_types', 'triggers', 'index_method', 'strict', 'without_rowid'],
    };
  }

  #formatVersion(): number {
    return this.#kind === 'secretStore' ? SECRET_STORE_FORMAT_VERSION : KV_FORMAT_VERSION;
  }

  async #databaseHexKey(resourceId: string, createIfMissing = false): Promise<string | undefined> {
    if (this.#kind === 'kv') return undefined;
    try {
      const databaseHexKey = createIfMissing
        ? await this.#secretStoreKeyProvider!.getOrCreateDatabaseHexKey(resourceId)
        : await this.#secretStoreKeyProvider!.getDatabaseHexKey(resourceId);
      if (!/^[0-9a-f]{64}$/.test(databaseHexKey)) throw new Error('Invalid secret-store database key.');
      return databaseHexKey;
    } catch (error) {
      if (error instanceof ResourceError && error.code === 'SECRET_STORE_KEY_UNAVAILABLE') throw error;
      throw new ResourceError(
        'SECRET_STORE_KEY_UNAVAILABLE',
        'The secret-store database encryption key is unavailable or invalid.',
      );
    }
  }

  async #assertDatabaseFile(resourceId: string): Promise<void> {
    const details = await lstat(this.#databasePath(resourceId));
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error('Resource key-value database file is missing.');
    }
  }

  #resourceDirectory(resourceId: string): string {
    return join(this.#dataRoot, fnResourceKeyValueHostId(resourceId));
  }

  #databasePath(resourceId: string): string {
    return join(this.#resourceDirectory(resourceId), 'data.db');
  }

  #encryptedTemporaryPath(resourceId: string): string {
    return `${this.#databasePath(resourceId)}.encryption-v2.tmp`;
  }

  #plaintextRecoveryPath(resourceId: string): string {
    return `${this.#databasePath(resourceId)}.plaintext-v1.recovery`;
  }
}
