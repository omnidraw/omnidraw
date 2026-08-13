import type { Dirent } from 'node:fs';
import path from "node:path";
import * as fs from 'node:fs/promises';
import {
  ChatStoreTurso,
  type TChatCreateArgs,
  type TChatListArgs,
  type TChatUpdateArgs,
} from '../ChatStoreTurso';
import { MIGRATION_FILES } from '../migrations/CONSTANTS';
import type { IDbConfig } from "../interface";
import type {
  TCanvas,
  TDbResourceApplyStatus,
  TDbResourceDraftChangeKind,
  TDbResourceDraftStatus,
  TEncryptionKey,
  TJson,
  TKeyValue,
  TMediaFile,
} from "../model";
import {
  EXPECTED_DATABASE_SCHEMA_CONTRACTS,
} from '../schema/expected-schema';
import { findCanvasRowById, findCanvasRowByName, listCanvasRows } from "./read-canvas";
import { getDbResourceApply, listDbResourceApplies, listDbResourceDraftChanges, getDbResourceDraft, getActiveDbResourceDraft, listDbResourceDrafts } from "./read-db-resource";
import { getResourceEncryptionKey } from "./read-encryption-key";
import { getMediaFileRowById, listMediaFileRows } from "./read-file";
import { getKeyValueRow } from "./read-key-value";
import { readMigrationFile } from './read-migration-file';
import { preflightMigrationState } from './preflight-migration-state';
import { readDatabaseChecks } from './read-database-checks';
import { createCanvasRow, deleteCanvasRowById, renameCanvasRowById } from "./write-canvas";
import { createDbResourceApply, createDbResourceApplyFromDraft, finishDbResourceApplyWithDraft, updateDbResourceApply, appendDbResourceDraftChange, createDbResourceDraft, discardDbResourceDraft, renameDbResourceDraft, updateDbResourceDraftStatus } from "./write-db-resource";
import { getOrCreateResourceEncryptionKey } from "./write-encryption-key";
import { createMediaFileRow, deleteMediaFileRowById } from "./write-file";
import { addKeyValueRow, removeKeyValueRow } from "./write-key-value";
import {
  healDatabaseCoordinator,
  type TDatabaseCoordinatorHealing,
} from './heal-database-coordinator';
import { runMigrations } from "./run-migrations";
import { runDatabaseWrite } from "../run-database-transaction";
import { Database } from "./turso-native";
import type {
  TDatabasePreflightResult,
  TMigrationChecksum,
} from './migration-types';

type TCanvasCreateArgs = Pick<TCanvas, "id" | "name">;
type TFileCreateArgs = Omit<TMediaFile, "createdAtSec">;

export const TURSO_EXPERIMENTAL_FEATURES = Object.freeze([
  'custom_types',
  'triggers',
  'index_method',
  'generated_columns',
] as const);
export const TURSO_ON_DISK_EXPERIMENTAL_FEATURES = Object.freeze([
  ...TURSO_EXPERIMENTAL_FEATURES,
  'multiprocess_wal',
] as const);

type TPreflightDbServiceDatabaseArgs = {
  databasePath: string;
  homeDir: string;
};

class DatabasePostConnectStartupError extends Error {
  constructor(readonly startupCause: unknown) {
    super(startupCause instanceof Error ? startupCause.message : String(startupCause), {
      cause: startupCause,
    });
    this.name = 'DatabasePostConnectStartupError';
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isExistingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

async function readMigrationChecksums(): Promise<readonly TMigrationChecksum[]> {
  return Promise.all(MIGRATION_FILES.map(async (migration) => ({
    version: migration.version,
    name: migration.name,
    checksumSha256: (await readMigrationFile({ Bun, TextDecoder }, { path: migration.path })).checksumSha256,
  })));
}

async function healDbServiceDatabaseCoordinator(args: {
  cacheDir: string;
  databasePath: string;
  homeDir: string;
  migrations: readonly TMigrationChecksum[];
}): Promise<TDatabaseCoordinatorHealing | null> {
  const tshmPath = `${args.databasePath}-tshm`;
  try {
    const tshmStat = await fs.lstat(tshmPath);
    if (!tshmStat.isFile()) return null;
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }

  const quarantineDirectory = path.join(args.cacheDir, 'database-recovery');
  const recoveryToken = `stale-${Date.now()}-${process.pid}`;
  const quarantinePath = path.join(
    quarantineDirectory,
    `${path.basename(tshmPath)}.${recoveryToken}`,
  );
  return healDatabaseCoordinator({
    Bun,
    lstat: fs.lstat,
    mkdir: fs.mkdir,
    openCanonicalDatabase: () => new Database(args.databasePath, {
      fileMustExist: true,
      experimental: [...TURSO_EXPERIMENTAL_FEATURES],
    }),
    rename: fs.rename,
    validateBeforeQuarantine: (preflight) => validateOmnidrawHomeLayout(
      args.homeDir,
      args.databasePath,
      preflight.status === 'empty',
    ),
  }, {
    expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
    migrations: args.migrations,
    quarantineDirectory,
    quarantinePath,
    tshmPath,
  });
}

async function validateOmnidrawHomeLayout(
  homeDir: string,
  databasePath: string,
  fresh: boolean,
): Promise<void> {
  let rootEntries: Dirent[];
  try {
    const rootStat = await fs.lstat(homeDir);
    if (!rootStat.isDirectory()) {
      throw new Error(`Omnidraw home is not a directory: ${homeDir}`);
    }
    rootEntries = await fs.readdir(homeDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }

  const databaseName = path.dirname(databasePath) === homeDir ? path.basename(databasePath) : null;
  const managedDirectoryNames = new Set([
    'agent',
    'bin',
    'cache',
    'keys',
    'logs',
    'native',
    'resources',
    'temp',
    'widgets',
  ]);
  for (const entry of rootEntries) {
    if (managedDirectoryNames.has(entry.name)) {
      if (!entry.isDirectory()) {
        throw new Error(`Refusing non-directory managed entry '${entry.name}' in ${homeDir}.`);
      }
      continue;
    }

    if (entry.name === 'config.json') {
      if (!entry.isFile()) {
        throw new Error(`Refusing non-file config entry '${entry.name}' in ${homeDir}.`);
      }
      continue;
    }

    if (databaseName !== null && entry.name === databaseName) {
      if (!entry.isFile()) {
        throw new Error(`Refusing non-file database entry '${entry.name}' in ${homeDir}.`);
      }
      continue;
    }

    if (
      databaseName !== null
      && (entry.name === `${databaseName}-wal` || entry.name === `${databaseName}-tshm`)
    ) {
      if (fresh) {
        throw new Error(
          `Refusing orphan database coordinator '${entry.name}' in ${homeDir}. `
            + 'Remove it with the explicit development cleanup before starting the fresh baseline.',
        );
      }
      if (!entry.isFile()) {
        throw new Error(
          `Refusing non-file database coordinator '${entry.name}' in ${homeDir}; `
            + 'remove the incompatible entry before retrying.',
        );
      }
      continue;
    }

    if (databaseName !== null && entry.name === `${databaseName}-shm`) {
      if (!entry.isDirectory()) {
        throw new Error(
          `Refusing incompatible SQLite WAL coordinator '${entry.name}' in ${homeDir}; `
            + 'close the external database client before retrying.',
        );
      }
      if (fresh) {
        throw new Error(
          `Refusing orphan database coordinator '${entry.name}' in ${homeDir}. `
            + 'Remove it with the explicit development cleanup before starting the fresh baseline.',
        );
      }
      continue;
    }

    continue;
  }
}

export async function preflightDbServiceDatabase(
  args: TPreflightDbServiceDatabaseArgs,
): Promise<TDatabasePreflightResult> {
  let databaseStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    databaseStat = await fs.lstat(args.databasePath);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    await validateOmnidrawHomeLayout(args.homeDir, args.databasePath, true);
    return { status: 'empty' };
  }

  if (!databaseStat.isFile()) {
    throw new Error(`Refusing Omnidraw database path because it is not a regular file: ${args.databasePath}`);
  }

  // Reject known-fresh orphan coordinators before any driver open. A zero-byte
  // Turso database has not committed application schema yet.
  await validateOmnidrawHomeLayout(
    args.homeDir,
    args.databasePath,
    databaseStat.size === 0,
  );

  const migrations = await readMigrationChecksums();
  const database = new Database(args.databasePath, {
    readonly: true,
    fileMustExist: true,
    experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
  });
  let connected = false;
  let preflightError: unknown;
  try {
    await database.connect();
    connected = true;
    const result = await preflightMigrationState(
      { Bun, db: database },
      {
        expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
        migrations,
      },
    );
    const checks = await readDatabaseChecks({ db: database }, {});
    if (!checks.ok) {
      throw new Error(
        `Refusing to open Omnidraw database: integrity checks failed `
          + `(${checks.failureMessage ?? 'unknown integrity failure'}). `
          + 'The database was inspected read-only and was not modified; '
          + 'run the explicit development database reset before restarting Omnidraw.',
      );
    }
    await validateOmnidrawHomeLayout(args.homeDir, args.databasePath, result.status === 'empty');
    return result;
  } catch (error) {
    preflightError = error;
  } finally {
    if (connected) await database.close();
  }

  if (
    preflightError instanceof Error
    && preflightError.message.startsWith('Refusing to open Omnidraw database:')
  ) {
    throw preflightError;
  }

  if (!connected) {
    let healing: TDatabaseCoordinatorHealing | null = null;
    try {
      healing = await healDbServiceDatabaseCoordinator({
        cacheDir: path.join(args.homeDir, 'cache'),
        databasePath: args.databasePath,
        homeDir: args.homeDir,
        migrations,
      });
    } catch {
      // The original preflight error remains the most useful safe failure.
    }
    if (healing) {
      return healing.preflight;
    }
  }

  const reason = preflightError instanceof Error ? preflightError.message : String(preflightError);
  throw new Error(
    `Refusing to open Omnidraw database after a read-only preflight failed: ${args.databasePath}: ${reason}`,
    { cause: preflightError },
  );
}

/** Single-user Turso service. Every public repository is rooted directly in one database. */
export class DbServiceTurso {
  name = 'DbServiceTurso'
  #database: Database
  #databaseEffects: Database
  #isConnected = false

  constructor(private config: IDbConfig) {
    if (
      typeof config.applicationVersion !== 'string'
      || config.applicationVersion.trim().length === 0
    ) {
      throw new TypeError('DbServiceTurso applicationVersion must not be empty.');
    }
    this.#database = this.#createDatabase()
    this.#databaseEffects = new Proxy({} as Database, {
      get: (_target, property) => {
        const value = Reflect.get(this.#database, property, this.#database);
        return typeof value === 'function' ? value.bind(this.#database) : value;
      },
      set: (_target, property, value) => (
        Reflect.set(this.#database, property, value, this.#database)
      ),
    });
  }

  get db(): Database {
    return this.#databaseEffects;
  }

  set db(database: Database) {
    this.#database = database;
  }

  #createDatabase(): Database {
    const experimental = this.config.databasePath === ":memory:"
      ? [...TURSO_EXPERIMENTAL_FEATURES]
      : [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES];

    return new Database(this.config.databasePath, {
      experimental,
    })
  }

  async #ensureSqliteShmSentinel(): Promise<void> {
    if (this.config.databasePath === ':memory:') return;
    const sentinelPath = `${this.config.databasePath}-shm`;
    try {
      await fs.mkdir(sentinelPath);
      return;
    } catch (error) {
      if (!isExistingPathError(error)) throw error;
    }

    const stat = await fs.lstat(sentinelPath);
    if (!stat.isDirectory()) {
      throw new Error(
        `Refusing incompatible SQLite WAL coordinator at ${sentinelPath}; `
          + 'close the external database client before retrying.',
      );
    }
  }

  async #connectAndMigrate(): Promise<void> {
    await this.#database.connect()
    this.#isConnected = true
    try {
      await runMigrations({
        db: this.#database,
        Bun,
        TextDecoder,
      }, {
        applicationVersion: this.config.applicationVersion,
        expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
      })
    } catch (error) {
      await this.#database.close()
      this.#isConnected = false
      throw new DatabasePostConnectStartupError(error)
    }
  }

  async #healCoordinatorAfterStartupFailure(): Promise<boolean> {
    if (this.config.databasePath === ':memory:') return false;
    const migrations = await readMigrationChecksums();
    const healing = await healDbServiceDatabaseCoordinator({
      cacheDir: this.config.cacheDir,
      databasePath: this.config.databasePath,
      homeDir: this.config.dataDir,
      migrations,
    });
    return healing !== null;
  }

  async start(): Promise<void> {
    if (this.config.databasePath !== ':memory:') {
      await preflightDbServiceDatabase({
        databasePath: this.config.databasePath,
        homeDir: this.config.dataDir,
      });
    }
    await this.#ensureSqliteShmSentinel();
    try {
      await this.#connectAndMigrate();
      return;
    } catch (startupError) {
      if (startupError instanceof DatabasePostConnectStartupError) {
        throw startupError.startupCause;
      }
      if (
        startupError instanceof Error
        && startupError.message.startsWith('Refusing to open Omnidraw database:')
      ) {
        throw startupError;
      }
      let healed = false;
      try {
        healed = await this.#healCoordinatorAfterStartupFailure();
      } catch {
        throw startupError;
      }
      if (!healed) throw startupError;
    }

    this.#database = this.#createDatabase();
    await this.#connectAndMigrate();
  }

  async stop(): Promise<void> {
    if (!this.#isConnected) return
    await this.#database.close()
    this.#isConnected = false
  }

  #serializeDatabaseWrite<T>(write: () => Promise<T>): Promise<T> {
    return runDatabaseWrite({ database: this.db }, { operation: write })
  }

  canvas = {
    listAll: () => listCanvasRows(this, {}),
    findByName: (args: { name: string }) => findCanvasRowByName(this, args),
    findById: (args: { id: string }) => findCanvasRowById(this, args),
    create: (args: TCanvasCreateArgs) => this.#serializeDatabaseWrite(
      () => createCanvasRow(this, args),
    ),
    renameById: (args: { id: string; name: string }) => this.#serializeDatabaseWrite(
      () => renameCanvasRowById(this, args),
    ),
    deleteById: (args: { id: string }) => this.#serializeDatabaseWrite(
      () => deleteCanvasRowById(this, args),
    ),
  };

  file = {
    listAll: () => listMediaFileRows(this, {}),
    create: (args: TFileCreateArgs) => this.#serializeDatabaseWrite(
      () => createMediaFileRow(this, args),
    ),
    getById: (args: { id: string }) => getMediaFileRowById(this, args),
    deleteById: (args: { id: string }) => this.#serializeDatabaseWrite(
      () => deleteMediaFileRowById(this, args),
    ),
  };

  keyValue = {
    add: (args: TKeyValue) => this.#serializeDatabaseWrite(
      () => addKeyValueRow(this, args),
    ),
    remove: (args: { name: string }) => this.#serializeDatabaseWrite(
      () => removeKeyValueRow(this, args),
    ),
    get: (args: { name: string }) => getKeyValueRow(this, args),
  };

  resourceEncryptionKey = {
    get: (args: { resourceId: string }): Promise<TEncryptionKey | null> => (
      getResourceEncryptionKey(this, args)
    ),
    getOrCreate: (args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }) => this.#serializeDatabaseWrite(() => (
      getOrCreateResourceEncryptionKey(this, args)
    )),
  };

  chats = {
    create: (args: TChatCreateArgs) => new ChatStoreTurso(this.db).create(args),
    get: (args: { id: string }) => new ChatStoreTurso(this.db).get(args),
    list: (args: TChatListArgs = {}) => new ChatStoreTurso(this.db).list(args),
    update: (args: TChatUpdateArgs) => new ChatStoreTurso(this.db).update(args),
    archive: (args: { id: string }) => new ChatStoreTurso(this.db).archive(args),
  };

  dbResource = {
    draft: {
      create: (args: { id: string; resourceId: string; name: string }) => this.#serializeDatabaseWrite(
        () => createDbResourceDraft(this, args),
      ),
      get: (args: { id: string }) => getDbResourceDraft(this, args),
      getActive: (args: { resourceId: string }) => getActiveDbResourceDraft(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceDraftStatus;
        before?: { createdAtSec: string; id: string };
        limit?: number;
      }) => listDbResourceDrafts(this, args),
      rename: (args: { id: string; name: string }) => this.#serializeDatabaseWrite(
        () => renameDbResourceDraft(this, args),
      ),
      updateStatus: (args: {
        id: string;
        status: TDbResourceDraftStatus;
        expectedStatus?: TDbResourceDraftStatus;
        lastError?: TJson | null;
      }) => this.#serializeDatabaseWrite(() => updateDbResourceDraftStatus(this, args)),
      discard: (args: { id: string; lastError?: TJson | null }) => this.#serializeDatabaseWrite(
        () => discardDbResourceDraft(this, args),
      ),
      change: {
        list: (args: { draftId: string }) => listDbResourceDraftChanges(this, args),
        append: (args: {
          draftId: string;
          sequence: number;
          kind: TDbResourceDraftChangeKind;
          operation?: TJson | null;
          sql: string;
        }) => this.#serializeDatabaseWrite(() => appendDbResourceDraftChange(this, args)),
      },
    },
    apply: {
      create: (args: {
        id: string;
        resourceId: string;
        draftId?: string | null;
        sourceApplyId?: string | null;
        status?: TDbResourceApplyStatus;
      }) => this.#serializeDatabaseWrite(() => createDbResourceApply(this, args)),
      createFromDraft: (args: { id: string; resourceId: string; draftId: string }) => (
        this.#serializeDatabaseWrite(() => createDbResourceApplyFromDraft(this, args))
      ),
      get: (args: { id: string }) => getDbResourceApply(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceApplyStatus;
        before?: { createdAtSec: string; id: string };
        limit?: number;
      }) => listDbResourceApplies(this, args),
      update: (args: {
        id: string;
        status: TDbResourceApplyStatus;
        expectedStatus?: TDbResourceApplyStatus;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeDatabaseWrite(() => updateDbResourceApply(this, args)),
      finishWithDraft: (args: {
        id: string;
        draftId: string;
        status: Extract<TDbResourceApplyStatus, "succeeded" | "failed" | "recovered">;
        expectedStatus?: TDbResourceApplyStatus;
        draftStatus: Extract<TDbResourceDraftStatus, "applied" | "editing" | "error">;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeDatabaseWrite(() => finishDbResourceApplyWithDraft(this, args)),
    },
  };
}

export type TDb = DbServiceTurso;
