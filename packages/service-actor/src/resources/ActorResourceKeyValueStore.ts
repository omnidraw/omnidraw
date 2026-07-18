/**
 * @file Host-owned bounded Turso file persistence for KV and secret-store resources.
 */
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  IActorResourceKeyValuePersistence,
  TActorResourceKeyValueCompareAndSetResult,
  TActorResourceKeyValueDeleteResult,
  TActorResourceKeyValueEntry,
  TActorResourceKeyValueIdentity,
  TActorResourceKeyValueKind,
  TActorResourceKeyValuePage,
} from './ActorResourceKeyValuePersistence';
import {
  fnActorResourceKeyValueEntry,
  fnActorResourceKeyValueHostId,
  fnActorResourceKeyValueListLimit,
  fnActorResourceKeyValueSerialize,
} from './fn.actor-resource-key-value';
import type { TJson } from '@vibecanvas/service-db/model';

const FORMAT_VERSION = 1;
const DEFAULT_QUERY_TIMEOUT_MS = 5_000;

export const ACTOR_RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES = 32;

const RESOURCE_PRAGMAS_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
PRAGMA temp_store = 2;
`;

const RESOURCE_SCHEMA_SQL = `
CREATE TABLE \`_vibecanvas_resource_metadata\` (
  \`singleton\` INTEGER PRIMARY KEY CHECK (\`singleton\` = 1),
  \`resource_id\` TEXT NOT NULL,
  \`resource_kind\` TEXT NOT NULL CHECK (\`resource_kind\` IN ('kv', 'secretStore')),
  \`format_version\` INTEGER NOT NULL CHECK (\`format_version\` >= 1)
) STRICT;
CREATE TABLE \`actor_resource_entries\` (
  \`key\` TEXT PRIMARY KEY,
  \`value\` JSON NOT NULL,
  \`revision\` INTEGER NOT NULL DEFAULT 1 CHECK (\`revision\` >= 1),
  \`created_at\` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  \`updated_at\` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE TRIGGER \`actor_resource_entries_updated_at_after_update\`
AFTER UPDATE OF \`value\`, \`revision\` ON \`actor_resource_entries\`
FOR EACH ROW
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
  UPDATE \`actor_resource_entries\`
  SET \`updated_at\` = CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > OLD.\`updated_at\`
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', OLD.\`updated_at\`, '+0.001 seconds')
  END
  WHERE \`key\` = OLD.\`key\`;
END;
`;

export type TActorResourceKeyValueDatabaseFactory = (
  databasePath: string,
  options: ConstructorParameters<typeof Database>[1],
) => Database;

export type TActorResourceKeyValueStoreConfig = {
  readonly dataRoot: string;
  readonly kind: TActorResourceKeyValueKind;
  readonly databaseFactory?: TActorResourceKeyValueDatabaseFactory;
  readonly maxOpenHandles?: number;
  readonly queryTimeoutMs?: number;
};

type THandleState = {
  readonly opening: Promise<Database>;
  database: Database | null;
  inFlight: number;
  lastUsed: number;
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
};

export class ActorResourceKeyValueStore implements IActorResourceKeyValuePersistence {
  readonly #dataRoot: string;
  readonly #kind: TActorResourceKeyValueKind;
  readonly #pathSegment: 'kv' | 'secret-store';
  readonly #databaseFactory: TActorResourceKeyValueDatabaseFactory;
  readonly #maxOpenHandles: number;
  readonly #queryTimeoutMs: number;
  readonly #handles = new Map<string, THandleState>();
  readonly #failedCloses = new Set<Database>();
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #pendingWrites = new Map<string, number>();
  readonly #inFlight = new Map<string, Set<Promise<unknown>>>();
  readonly #lifecycle = new Set<Promise<unknown>>();
  readonly #blocked = new Set<string>();
  #lastUse = 0;
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(config: TActorResourceKeyValueStoreConfig) {
    const maxOpenHandles = config.maxOpenHandles ?? ACTOR_RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES;
    const queryTimeoutMs = config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    if (!Number.isInteger(maxOpenHandles) || maxOpenHandles < 1) {
      throw new RangeError('Actor resource key-value maximum open handles must be a positive integer.');
    }
    if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 1) {
      throw new RangeError('Actor resource key-value query timeout must be a positive integer.');
    }
    this.#dataRoot = config.dataRoot;
    this.#kind = config.kind;
    this.#pathSegment = config.kind === 'kv' ? 'kv' : 'secret-store';
    this.#databaseFactory = config.databaseFactory ?? ((databasePath, options) => new Database(databasePath, options));
    this.#maxOpenHandles = maxOpenHandles;
    this.#queryTimeoutMs = queryTimeoutMs;
  }

  get openHandleCount(): number {
    return this.#handles.size + this.#failedCloses.size;
  }

  async provision(identity: TActorResourceKeyValueIdentity): Promise<void> {
    this.#assertAvailable();
    this.#assertIdentity(identity);
    return this.#trackLifecycle(this.#provision(identity.resourceId));
  }

  async #provision(resourceIdValue: string): Promise<void> {
    const resourceId = fnActorResourceKeyValueHostId(resourceIdValue);
    const directory = this.#resourceDirectory(resourceId);
    let directoryCreated = false;
    try {
      await mkdir(this.#kindRoot(), { recursive: true });
      await mkdir(directory);
      directoryCreated = true;
      const database = this.#databaseFactory(this.#databasePath(resourceId), this.#databaseOptions(false));
      try {
        await database.connect();
        await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
        await database.exec(RESOURCE_SCHEMA_SQL, { queryTimeout: this.#queryTimeoutMs });
        await (await database.prepare(`
          INSERT INTO _vibecanvas_resource_metadata (singleton, resource_id, resource_kind, format_version)
          VALUES (1, ?, ?, ?)
        `)).run(resourceId, this.#kind, FORMAT_VERSION);
      } finally {
        await this.#closeDatabase(database);
      }
      await this.#verifyStandalone(resourceId);
    } catch (error) {
      if (directoryCreated) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async verify(identity: TActorResourceKeyValueIdentity): Promise<void> {
    this.#assertAvailable();
    this.#assertIdentity(identity);
    return this.#trackLifecycle(this.#verifyResource(identity.resourceId));
  }

  async #verifyResource(resourceIdValue: string): Promise<void> {
    const resourceId = fnActorResourceKeyValueHostId(resourceIdValue);
    this.#blocked.add(resourceId);
    try {
      await this.#drain(resourceId);
      await this.#closeHandle(resourceId);
      await this.#verifyStandalone(resourceId);
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async deleteResource(identity: TActorResourceKeyValueIdentity): Promise<void> {
    this.#assertAvailable();
    this.#assertIdentity(identity);
    return this.#trackLifecycle(this.#deleteResource(identity.resourceId));
  }

  async #deleteResource(resourceIdValue: string): Promise<void> {
    const resourceId = fnActorResourceKeyValueHostId(resourceIdValue);
    this.#blocked.add(resourceId);
    try {
      await this.#drain(resourceId);
      await this.#writeTails.get(resourceId);
      await this.#closeHandle(resourceId);
      await rm(this.#resourceDirectory(resourceId), { recursive: true, force: true });
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async get(args: { readonly resourceId: string; readonly key: string }): Promise<TActorResourceKeyValueEntry | null> {
    const resourceId = this.#operationResourceId(args.resourceId);
    return this.#track(resourceId, this.#getEntry(resourceId, args.key));
  }

  async has(args: { readonly resourceId: string; readonly key: string }): Promise<boolean> {
    const resourceId = this.#operationResourceId(args.resourceId);
    return this.#track(resourceId, this.#withHandle(resourceId, async (database) => {
      const row = await (await database.prepare(`
        SELECT 1 AS present
        FROM actor_resource_entries
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
        FROM actor_resource_entries
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
  }): Promise<TActorResourceKeyValuePage> {
    const resourceId = this.#operationResourceId(args.resourceId);
    const limit = fnActorResourceKeyValueListLimit(args.limit);
    return this.#track(resourceId, this.#withHandle(resourceId, async (database) => {
      const prefix = args.prefix ?? null;
      const search = args.search ?? null;
      const cursor = args.cursor ?? null;
      const rows = await (await database.prepare(`
        SELECT key, value, revision, created_at, updated_at
        FROM actor_resource_entries
        WHERE (? IS NULL OR substr(key, 1, length(?)) = ?)
          AND (? IS NULL OR instr(key, ?) > 0)
          AND (? IS NULL OR key > ?)
        ORDER BY key ASC
        LIMIT ?
      `)).all(prefix, prefix, prefix, search, search, cursor, cursor, limit + 1);
      const parsed = rows.map(fnActorResourceKeyValueEntry);
      const entries = parsed.slice(0, limit);
      return {
        entries,
        nextCursor: parsed.length > limit ? entries.at(-1)?.key ?? null : null,
      };
    }));
  }

  async set(args: { readonly resourceId: string; readonly key: string; readonly value: TJson }): Promise<TActorResourceKeyValueEntry> {
    const resourceId = this.#operationResourceId(args.resourceId);
    const serialized = fnActorResourceKeyValueSerialize(args.value);
    return this.#scheduleWrite(resourceId, async () => {
      await this.#withHandle(resourceId, async (database) => {
        await (await database.prepare(`
          INSERT INTO actor_resource_entries (key, value)
          VALUES (?, ?)
          ON CONFLICT (key) DO UPDATE SET
            value = excluded.value,
            revision = actor_resource_entries.revision + 1
        `)).run(args.key, serialized);
      });
      const entry = await this.#getEntry(resourceId, args.key);
      if (!entry) throw new Error('Actor resource key-value set succeeded without a persisted entry.');
      return entry;
    });
  }

  async delete(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly expectedRevision?: number;
  }): Promise<TActorResourceKeyValueDeleteResult> {
    const resourceId = this.#operationResourceId(args.resourceId);
    if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1)) {
      throw new RangeError('Expected revision must be a positive integer.');
    }
    return this.#scheduleWrite(resourceId, () => this.#withHandle(resourceId, async (database) => {
      const result = await (await database.prepare(`
        DELETE FROM actor_resource_entries
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
  }): Promise<TActorResourceKeyValueCompareAndSetResult> {
    const resourceId = this.#operationResourceId(args.resourceId);
    if (args.expectedRevision !== null && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1)) {
      throw new RangeError('Expected revision must be null or a positive integer.');
    }
    const serialized = fnActorResourceKeyValueSerialize(args.value);
    return this.#scheduleWrite(resourceId, async () => {
      const changes = await this.#withHandle(resourceId, async (database) => {
        const result = args.expectedRevision === null
          ? await (await database.prepare(`
              INSERT INTO actor_resource_entries (key, value)
              VALUES (?, ?)
              ON CONFLICT (key) DO NOTHING
            `)).run(args.key, serialized)
          : await (await database.prepare(`
              UPDATE actor_resource_entries
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
      if (!current) throw new Error('Actor resource key-value CAS succeeded without a persisted entry.');
      return { ok: true, entry: current };
    });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = (async () => {
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
      if (failures.length > 0) throw new AggregateError(failures, 'One or more actor resource key-value handles failed to close.');
    })();
    return this.#closePromise;
  }

  async #verifyStandalone(resourceId: string): Promise<void> {
    await this.#assertDatabaseFile(resourceId);
    const database = this.#databaseFactory(this.#databasePath(resourceId), this.#databaseOptions(true));
    try {
      await database.connect();
      await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
      await this.#verifyDatabase(database, resourceId);
    } finally {
      await this.#closeDatabase(database);
    }
  }

  async #verifyDatabase(database: Database, resourceId: string): Promise<void> {
    const health = await (await database.prepare('PRAGMA quick_check;')).all();
    if (health.length !== 1 || !Object.values(health[0] ?? {}).some((value) => value === 'ok')) {
      throw new Error('Actor resource key-value database health check failed.');
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
      || Number(row?.format_version) !== FORMAT_VERSION
    ) {
      throw new Error('Actor resource key-value physical identity does not match its catalog resource.');
    }
    await (await database.prepare(`
      SELECT key, value, revision, created_at, updated_at
      FROM actor_resource_entries
      LIMIT 0
    `)).all();
    const entryColumns = await (await database.prepare('PRAGMA table_info(actor_resource_entries);')).all() as TTableInfoRow[];
    const valueColumn = entryColumns.find((column) => column.name === 'value');
    if (valueColumn?.type !== 'JSON' || Number(valueColumn.notnull) !== 1) {
      throw new Error('Actor resource key-value value column must be required JSON.');
    }
    const trigger = await (await database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'trigger' AND name = 'actor_resource_entries_updated_at_after_update'
    `)).get();
    if (!trigger) throw new Error('Actor resource key-value physical schema is incomplete.');
  }

  #withHandle<T>(resourceId: string, operation: (database: Database) => Promise<T>): Promise<T> {
    const state = this.#handle(resourceId);
    state.inFlight += 1;
    state.lastUsed = ++this.#lastUse;
    return (async () => {
      try {
        return await operation(await state.opening);
      } finally {
        state.inFlight -= 1;
        state.lastUsed = ++this.#lastUse;
        await this.#evictIdleHandles();
      }
    })();
  }

  #handle(resourceId: string): THandleState {
    const cached = this.#handles.get(resourceId);
    if (cached) return cached;
    const state: THandleState = {
      opening: Promise.resolve(null as never),
      database: null,
      inFlight: 0,
      lastUsed: ++this.#lastUse,
    };
    const opening = (async () => {
      await this.#assertDatabaseFile(resourceId);
      const database = this.#databaseFactory(this.#databasePath(resourceId), this.#databaseOptions(true));
      try {
        await database.connect();
        await database.exec(RESOURCE_PRAGMAS_SQL, { queryTimeout: this.#queryTimeoutMs });
        await this.#verifyDatabase(database, resourceId);
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
      if (this.#handles.get(resourceId) === state) this.#handles.delete(resourceId);
    });
    return state;
  }

  async #evictIdleHandles(): Promise<void> {
    if (this.#failedCloses.size > 0) {
      await Promise.allSettled([...this.#failedCloses].map((database) => this.#closeDatabase(database)));
    }
    while (this.openHandleCount > this.#maxOpenHandles) {
      const candidate = [...this.#handles.entries()]
        .filter(([resourceId, state]) => (
          state.database !== null
          && state.inFlight === 0
          && (this.#pendingWrites.get(resourceId) ?? 0) === 0
        ))
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!candidate) return;
      await this.#closeHandle(candidate[0]).catch(() => undefined);
    }
  }

  async #closeHandle(resourceId: string): Promise<void> {
    const state = this.#handles.get(resourceId);
    if (!state) return;
    this.#handles.delete(resourceId);
    await this.#closeDatabase(await state.opening);
  }

  async #closeDatabase(database: Database): Promise<void> {
    try {
      await database.close();
      this.#failedCloses.delete(database);
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

  async #drain(resourceId: string): Promise<void> {
    const calls = this.#inFlight.get(resourceId);
    if (calls?.size) await Promise.allSettled([...calls]);
  }

  #getEntry(resourceId: string, key: string): Promise<TActorResourceKeyValueEntry | null> {
    return this.#withHandle(resourceId, async (database) => {
      const row = await (await database.prepare(`
        SELECT key, value, revision, created_at, updated_at
        FROM actor_resource_entries
        WHERE key = ?
      `)).get(key);
      return row ? fnActorResourceKeyValueEntry(row) : null;
    });
  }

  #operationResourceId(resourceId: string): string {
    this.#assertAvailable(resourceId);
    return fnActorResourceKeyValueHostId(resourceId);
  }

  #assertIdentity(identity: TActorResourceKeyValueIdentity): void {
    fnActorResourceKeyValueHostId(identity.resourceId);
    if (identity.kind !== this.#kind) {
      throw new TypeError('Actor resource kind does not match the physical key-value store.');
    }
  }

  #assertAvailable(resourceId?: string): void {
    if (this.#closed) throw new Error('Actor resource key-value store is closed.');
    if (resourceId && this.#blocked.has(resourceId)) throw new Error('Actor resource key-value store is unavailable during lifecycle work.');
  }

  #databaseOptions(fileMustExist: boolean): ConstructorParameters<typeof Database>[1] {
    return {
      fileMustExist,
      defaultQueryTimeout: this.#queryTimeoutMs,
      // @ts-expect-error Turso runtime features are ahead of its public union.
      experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal', 'strict', 'without_rowid'],
    };
  }

  async #assertDatabaseFile(resourceId: string): Promise<void> {
    const details = await stat(this.#databasePath(resourceId));
    if (!details.isFile()) throw new Error('Actor resource key-value database file is missing.');
  }

  #kindRoot(): string {
    return join(this.#dataRoot, 'actor-resources', this.#pathSegment);
  }

  #resourceDirectory(resourceId: string): string {
    return join(this.#kindRoot(), fnActorResourceKeyValueHostId(resourceId));
  }

  #databasePath(resourceId: string): string {
    return join(this.#resourceDirectory(resourceId), 'data.db');
  }
}
