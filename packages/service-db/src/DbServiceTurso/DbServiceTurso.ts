import type { IService, IStartableService, IStoppableService } from "@omnidraw/runtime";
import type { Dirent } from 'node:fs';
import path from "node:path";
import * as fs from 'node:fs/promises';
import {
  ChatStoreTurso,
  type TChatCreateArgs,
  type TChatListArgs,
  type TChatUpdateArgs,
} from '../ChatStoreTurso';
import { MIGRATION_APPLICATION_VERSION_FALLBACK } from '../CONSTANTS';
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
import { fxCanvasFindById, fxCanvasFindByName, fxCanvasListAll } from "./fx.canvas";
import { fxDbResourceApplyGet, fxDbResourceApplyList, fxDbResourceDraftChangeList, fxDbResourceDraftGet, fxDbResourceDraftGetActive, fxDbResourceDraftList } from "./fx.db-resource";
import { fxResourceEncryptionKeyGet } from "./fx.encryption-key";
import { fxFileGetById, fxFileListAll } from "./fx.file";
import { fxKeyValueGet } from "./fx.keyValue";
import { fxReadMigrationFile } from './fx.migration-file';
import { fxPreflightMigrationState } from './fx.migration-state';
import { fxReadDatabaseChecks } from './fx.database-checks';
import { txCanvasCreate, txCanvasDeleteById, txCanvasRenameById } from "./tx.canvas";
import { txDbResourceApplyCreate, txDbResourceApplyCreateFromDraft, txDbResourceApplyFinishWithDraft, txDbResourceApplyUpdate, txDbResourceDraftAppendChange, txDbResourceDraftCreate, txDbResourceDraftDiscard, txDbResourceDraftRename, txDbResourceDraftUpdateStatus } from "./tx.db-resource";
import { txResourceEncryptionKeyGetOrCreate } from "./tx.encryption-key";
import { txFileCreate, txFileDeleteById } from "./tx.file";
import { txKeyValueAdd, txKeyValueRemove } from "./tx.keyValue";
import {
  txHealDatabaseCoordinator,
  type TDatabaseCoordinatorHealing,
} from './tx.heal-database-coordinator';
import { txRunMigrations } from "./tx.migrations";
import { txRunDatabaseWrite } from "../tx.run-database-transaction";
import { Database } from "./turso-native";
import type {
  TDatabasePreflightResult,
  TMigrationChecksum,
} from './migration-types';

declare const OMNIDRAW_VERSION: string | undefined;

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

function migrationApplicationVersion(): string {
  return (
    (typeof OMNIDRAW_VERSION !== 'undefined' && OMNIDRAW_VERSION)
    || process.env.OMNIDRAW_VERSION
    || MIGRATION_APPLICATION_VERSION_FALLBACK
  );
}

async function readMigrationChecksums(): Promise<readonly TMigrationChecksum[]> {
  return Promise.all(MIGRATION_FILES.map(async (migration) => ({
    version: migration.version,
    name: migration.name,
    checksumSha256: (await fxReadMigrationFile({ Bun, TextDecoder }, { path: migration.path })).checksumSha256,
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
  return txHealDatabaseCoordinator({
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

    if (entry.name === 'database-migrations') {
      throw new Error(
        `Refusing legacy database-migrations entry in ${homeDir}. `
          + 'Remove it with the explicit development cleanup before restarting Omnidraw; '
          + 'the filesystem-first baseline never reads or rewrites legacy migrations.',
      );
    }

    if (entry.name === 'organizations') {
      throw new Error(
        `Refusing legacy organizations entry in ${homeDir}. `
          + 'Remove it with the explicit development cleanup before restarting Omnidraw; '
          + 'single-user storage uses direct home folders and never migrates organization data.',
      );
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

  // Reject legacy roots and known-fresh orphan coordinators before any driver
  // open. A zero-byte Turso database has not committed application schema yet.
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
    const result = await fxPreflightMigrationState(
      { Bun, db: database },
      {
        expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
        migrations,
      },
    );
    const checks = await fxReadDatabaseChecks({ db: database }, {});
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
export class DbServiceTurso implements IService, IStartableService, IStoppableService {
  name = 'DbServiceTurso'
  #database: Database
  #databasePortal: Database
  #isConnected = false

  constructor(private config: IDbConfig) {
    this.#database = this.#createDatabase()
    this.#databasePortal = new Proxy({} as Database, {
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
    return this.#databasePortal;
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
      await txRunMigrations({
        db: this.#database,
        Bun,
        TextDecoder,
      }, {
        applicationVersion: migrationApplicationVersion(),
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

  async start(_ctx?: Parameters<IStartableService["start"]>[0]): Promise<void> {
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
    return txRunDatabaseWrite({ database: this.db }, { operation: write })
  }

  canvas = {
    listAll: () => fxCanvasListAll(this, {}),
    findByName: (args: { name: string }) => fxCanvasFindByName(this, args),
    findById: (args: { id: string }) => fxCanvasFindById(this, args),
    create: (args: TCanvasCreateArgs) => this.#serializeDatabaseWrite(
      () => txCanvasCreate(this, args),
    ),
    renameById: (args: { id: string; name: string }) => this.#serializeDatabaseWrite(
      () => txCanvasRenameById(this, args),
    ),
    deleteById: (args: { id: string }) => this.#serializeDatabaseWrite(
      () => txCanvasDeleteById(this, args),
    ),
  };

  file = {
    listAll: () => fxFileListAll(this, {}),
    create: (args: TFileCreateArgs) => this.#serializeDatabaseWrite(
      () => txFileCreate(this, args),
    ),
    getById: (args: { id: string }) => fxFileGetById(this, args),
    deleteById: (args: { id: string }) => this.#serializeDatabaseWrite(
      () => txFileDeleteById(this, args),
    ),
  };

  keyValue = {
    add: (args: TKeyValue) => this.#serializeDatabaseWrite(
      () => txKeyValueAdd(this, args),
    ),
    remove: (args: { name: string }) => this.#serializeDatabaseWrite(
      () => txKeyValueRemove(this, args),
    ),
    get: (args: { name: string }) => fxKeyValueGet(this, args),
  };

  resourceEncryptionKey = {
    get: (args: { resourceId: string }): Promise<TEncryptionKey | null> => (
      fxResourceEncryptionKeyGet(this, args)
    ),
    getOrCreate: (args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }) => this.#serializeDatabaseWrite(() => (
      txResourceEncryptionKeyGetOrCreate(this, args)
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
        () => txDbResourceDraftCreate(this, args),
      ),
      get: (args: { id: string }) => fxDbResourceDraftGet(this, args),
      getActive: (args: { resourceId: string }) => fxDbResourceDraftGetActive(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceDraftStatus;
        before?: { createdAtSec: string; id: string };
        limit?: number;
      }) => fxDbResourceDraftList(this, args),
      rename: (args: { id: string; name: string }) => this.#serializeDatabaseWrite(
        () => txDbResourceDraftRename(this, args),
      ),
      updateStatus: (args: {
        id: string;
        status: TDbResourceDraftStatus;
        expectedStatus?: TDbResourceDraftStatus;
        lastError?: TJson | null;
      }) => this.#serializeDatabaseWrite(() => txDbResourceDraftUpdateStatus(this, args)),
      discard: (args: { id: string; lastError?: TJson | null }) => this.#serializeDatabaseWrite(
        () => txDbResourceDraftDiscard(this, args),
      ),
      change: {
        list: (args: { draftId: string }) => fxDbResourceDraftChangeList(this, args),
        append: (args: {
          draftId: string;
          sequence: number;
          kind: TDbResourceDraftChangeKind;
          operation?: TJson | null;
          sql: string;
        }) => this.#serializeDatabaseWrite(() => txDbResourceDraftAppendChange(this, args)),
      },
    },
    apply: {
      create: (args: {
        id: string;
        resourceId: string;
        draftId?: string | null;
        sourceApplyId?: string | null;
        status?: TDbResourceApplyStatus;
      }) => this.#serializeDatabaseWrite(() => txDbResourceApplyCreate(this, args)),
      createFromDraft: (args: { id: string; resourceId: string; draftId: string }) => (
        this.#serializeDatabaseWrite(() => txDbResourceApplyCreateFromDraft(this, args))
      ),
      get: (args: { id: string }) => fxDbResourceApplyGet(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceApplyStatus;
        before?: { createdAtSec: string; id: string };
        limit?: number;
      }) => fxDbResourceApplyList(this, args),
      update: (args: {
        id: string;
        status: TDbResourceApplyStatus;
        expectedStatus?: TDbResourceApplyStatus;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeDatabaseWrite(() => txDbResourceApplyUpdate(this, args)),
      finishWithDraft: (args: {
        id: string;
        draftId: string;
        status: Extract<TDbResourceApplyStatus, "succeeded" | "failed" | "recovered">;
        expectedStatus?: TDbResourceApplyStatus;
        draftStatus: Extract<TDbResourceDraftStatus, "applied" | "editing" | "error">;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeDatabaseWrite(() => txDbResourceApplyFinishWithDraft(this, args)),
    },
  };
}

export type TDb = DbServiceTurso;
