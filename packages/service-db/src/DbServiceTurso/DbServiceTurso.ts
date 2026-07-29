import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import type { Dirent } from 'node:fs';
import path from "node:path";
import * as fs from 'node:fs/promises';
import {
  DEFAULT_OSS_ORGANIZATION_ID,
  MIGRATION_APPLICATION_VERSION_FALLBACK,
} from '../CONSTANTS';
import { MIGRATION_FILES } from '../migrations/CONSTANTS';
import type { IDbConfig } from "../interface";
import type { TCanvas, TCanvasMember, TDbResourceApplyStatus, TDbResourceDraftChangeKind, TDbResourceDraftStatus, TEncryptionKey, TJson, TKeyValue, TMediaFile, TToolGroup } from "../model";
import {
  EXPECTED_DATABASE_SCHEMA_CONTRACTS,
} from '../schema/expected-schema';
import { fxAccountGetDefaultOwner } from "./fx.account";
import { fxCanvasFindById, fxCanvasFindByName, fxCanvasListAll, fxCanvasListMembers } from "./fx.canvas";
import { fxDbResourceApplyGet, fxDbResourceApplyList, fxDbResourceDraftChangeList, fxDbResourceDraftGet, fxDbResourceDraftGetActive, fxDbResourceDraftList } from "./fx.db-resource";
import { fxResourceEncryptionKeyGet } from "./fx.encryption-key";
import { fxFileGetById, fxFileListAll } from "./fx.file";
import { fxKeyValueGet } from "./fx.keyValue";
import { fxReadMigrationFile } from './fx.migration-file';
import { fxPreflightMigrationState } from './fx.migration-state';
import { fxToolGroupGetByName, fxToolGroupListAll } from "./fx.tool-group";
import { txAccountEnsureDefaultOwner } from "./tx.account";
import { txCanvasCreate, txCanvasDeleteById, txCanvasRenameById } from "./tx.canvas";
import { txDbResourceApplyCreate, txDbResourceApplyCreateFromDraft, txDbResourceApplyFinishWithDraft, txDbResourceApplyUpdate, txDbResourceDraftAppendChange, txDbResourceDraftCreate, txDbResourceDraftDiscard, txDbResourceDraftRename, txDbResourceDraftUpdateStatus } from "./tx.db-resource";
import { txResourceEncryptionKeyGetOrCreate } from "./tx.encryption-key";
import { txFileCreate, txFileDeleteById } from "./tx.file";
import { txKeyValueAdd, txKeyValueRemove } from "./tx.keyValue";
import { txToolGroupCreate, txToolGroupRemove, txToolGroupUpdate } from "./tx.tool-group";
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

declare const VIBECANVAS_VERSION: string | undefined;

type TCanvasCreateArgs = Pick<TCanvas, "id" | "name">;
type TFileCreateArgs = Omit<TMediaFile, "created_at">

const TURSO_EXPERIMENTAL_FEATURES = [
  'custom_types',
  'triggers',
  'index_method',
  'generated_columns',
];
const TURSO_ON_DISK_EXPERIMENTAL_FEATURES = [
  ...TURSO_EXPERIMENTAL_FEATURES,
  'multiprocess_wal',
];

/**
 * Public customer-data repositories require a tenant context for every call.
 * System bootstrap operations are deliberately kept outside this surface.
 */
interface IPublicMethods {
  canvas: {
    listAll(tenant: TTenantContext): Promise<TCanvas[]>;
    findByName(tenant: TTenantContext, args: { name: string }): Promise<TCanvas | null>;
    findById(tenant: TTenantContext, args: { id: string }): Promise<TCanvas | null>;
    create(tenant: TTenantContext, args: TCanvasCreateArgs): Promise<TCanvas>;
    renameById(tenant: TTenantContext, args: { id: string, name: string}): Promise<TCanvas | null>;
    deleteById(tenant: TTenantContext, args: { id: string }): Promise<TCanvas[]>;
    listMembers(tenant: TTenantContext, args: { canvasId: string }): Promise<TCanvasMember[]>;
  };
  file: {
    listAll(tenant: TTenantContext): Promise<TMediaFile[]>;
    create(tenant: TTenantContext, args: TFileCreateArgs): Promise<TMediaFile>;
    getById(tenant: TTenantContext, args: { id: string }): Promise<TMediaFile | null>;
    deleteById(tenant: TTenantContext, args: { id: string }): Promise<void>;
  };
  keyValue: {
    add(tenant: TTenantContext, args: TKeyValue): Promise<TKeyValue>;
    remove(tenant: TTenantContext, args: { name: string }): Promise<void>;
    get(tenant: TTenantContext, args: { name: string }): Promise<TKeyValue | null>;
  };
  resourceEncryptionKey: {
    get(tenant: TTenantContext, args: { resourceId: string }): Promise<TEncryptionKey | null>;
    getOrCreate(tenant: TTenantContext, args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }): Promise<TEncryptionKey>;
  };
  toolGroup: {
    listAll(tenant: TTenantContext): Promise<TToolGroup[]>;
    getByName(tenant: TTenantContext, args: { name: string }): Promise<TToolGroup | null>;
    create(tenant: TTenantContext, args: TToolGroup): Promise<TToolGroup>;
    update(tenant: TTenantContext, args: TToolGroup & { currentName: string }): Promise<TToolGroup | null>;
    remove(tenant: TTenantContext, args: { name: string }): Promise<TToolGroup | null>;
  };
}

type TPreflightDbServiceDatabaseArgs = {
  databasePath: string;
  homeDir: string;
};

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isExistingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function migrationApplicationVersion(): string {
  return (
    (typeof VIBECANVAS_VERSION !== 'undefined' && VIBECANVAS_VERSION)
    || process.env.VIBECANVAS_VERSION
    || MIGRATION_APPLICATION_VERSION_FALLBACK
  );
}

async function assertEmptyDirectory(directory: string): Promise<void> {
  const entries = await fs.readdir(directory);
  if (entries.length !== 0) {
    throw new Error(`Refusing non-empty pre-bootstrap directory: ${directory}`);
  }
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
  const quarantinePath = path.join(
    quarantineDirectory,
    `${path.basename(tshmPath)}.stale-${Date.now()}-${process.pid}`,
  );
  return txHealDatabaseCoordinator({
    Bun,
    lstat: fs.lstat,
    mkdir: fs.mkdir,
    openCanonicalDatabase: () => new Database(args.databasePath, {
      fileMustExist: true,
      // @ts-expect-error custom_types is supported by the pinned native runtime ahead of its public union.
      experimental: [...TURSO_EXPERIMENTAL_FEATURES],
    }),
    rename: fs.rename,
    validateBeforeQuarantine: (preflight) => validateVibecanvasHomeLayout(
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

async function validateOrganizationsDirectory(
  organizationsDir: string,
  fresh: boolean,
): Promise<void> {
  const organizations = await fs.readdir(organizationsDir, { withFileTypes: true });
  if (!fresh) {
    if (organizations.some((entry) => !entry.isDirectory())) {
      throw new Error(`Refusing non-directory organization entry in ${organizationsDir}.`);
    }
    return;
  }

  for (const organization of organizations) {
    if (
      organization.name !== DEFAULT_OSS_ORGANIZATION_ID
      || !organization.isDirectory()
    ) {
      throw new Error(`Refusing unknown pre-bootstrap organization entry '${organization.name}'.`);
    }
    const organizationRoot = path.join(organizationsDir, organization.name);
    const expectedLeaves = new Set(['agent', 'artifacts', 'resources', 'temp']);
    const leaves = await fs.readdir(organizationRoot, { withFileTypes: true });
    for (const leaf of leaves) {
      if (!expectedLeaves.has(leaf.name) || !leaf.isDirectory()) {
        throw new Error(`Refusing unknown pre-bootstrap organization path '${leaf.name}'.`);
      }
      await assertEmptyDirectory(path.join(organizationRoot, leaf.name));
    }
  }
}

async function validateVibecanvasHomeLayout(
  homeDir: string,
  databasePath: string,
  fresh: boolean,
): Promise<void> {
  let rootEntries: Dirent[];
  try {
    const rootStat = await fs.lstat(homeDir);
    if (!rootStat.isDirectory()) {
      throw new Error(`Vibecanvas home is not a directory: ${homeDir}`);
    }
    rootEntries = await fs.readdir(homeDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }

  const databaseName = path.dirname(databasePath) === homeDir ? path.basename(databasePath) : null;
  for (const entry of rootEntries) {
    if (entry.name === 'bin' || entry.name === 'native') {
      if (!entry.isDirectory()) {
        throw new Error(`Refusing non-directory install entry '${entry.name}' in ${homeDir}.`);
      }
      continue;
    }

    if (entry.name === 'database-migrations') {
      if (!entry.isDirectory()) {
        throw new Error(`Refusing non-directory legacy migration entry in ${homeDir}.`);
      }
      const migrationDir = path.join(homeDir, entry.name);
      const entries = (await fs.readdir(migrationDir, { withFileTypes: true }))
        .toSorted((left, right) => left.name.localeCompare(right.name));
      if (entries.length === 0) continue;
      const isContiguousKnownPrefix = entries.length <= MIGRATION_FILES.length
        && entries.every((migrationEntry, index) => (
          migrationEntry.isFile()
          && migrationEntry.name === MIGRATION_FILES[index]?.name
        ));
      if (!isContiguousKnownPrefix) {
        throw new Error(
          `Refusing unknown database-migrations directory in ${homeDir}; `
            + `expected a contiguous prefix of [${MIGRATION_FILES.map((migration) => migration.name).join(', ')}].`,
        );
      }

      for (const [index, migrationEntry] of entries.entries()) {
        const embedded = MIGRATION_FILES[index];
        if (!embedded) throw new Error('Migration prefix validation lost its registered migration.');
        const [installedMigration, embeddedMigration] = await Promise.all([
          fxReadMigrationFile({ Bun, TextDecoder }, { path: path.join(migrationDir, migrationEntry.name) }),
          fxReadMigrationFile({ Bun, TextDecoder }, { path: embedded.path }),
        ]);
        if (installedMigration.checksumSha256 !== embeddedMigration.checksumSha256) {
          throw new Error(`Refusing database-migrations/${migrationEntry.name} with an unknown checksum.`);
        }
      }
      continue;
    }

    if (entry.name === 'cache' || entry.name === 'logs') {
      if (!entry.isDirectory()) {
        throw new Error(`Refusing non-directory managed entry '${entry.name}' in ${homeDir}.`);
      }
      if (fresh) await assertEmptyDirectory(path.join(homeDir, entry.name));
      continue;
    }

    if (entry.name === 'organizations') {
      if (!entry.isDirectory()) {
        throw new Error(`Refusing non-directory organizations entry in ${homeDir}.`);
      }
      await validateOrganizationsDirectory(path.join(homeDir, entry.name), fresh);
      continue;
    }

    if (entry.name === 'config.json' && !fresh && entry.isFile()) continue;

    if (
      databaseName !== null
      && (
        entry.name === databaseName
        || entry.name === `${databaseName}-wal`
        || entry.name === `${databaseName}-tshm`
      )
      && entry.isFile()
    ) {
      continue;
    }

    if (databaseName !== null && entry.name === `${databaseName}-shm`) {
      if (!entry.isDirectory()) {
        throw new Error(
          `Refusing incompatible SQLite WAL coordinator '${entry.name}' in ${homeDir}; `
            + 'close the external database client before retrying.',
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
    await validateVibecanvasHomeLayout(args.homeDir, args.databasePath, true);
    return { status: 'empty' };
  }

  if (!databaseStat.isFile()) {
    throw new Error(`Refusing Vibecanvas database path because it is not a regular file: ${args.databasePath}`);
  }

  const migrations = await readMigrationChecksums();
  const database = new Database(args.databasePath, {
    readonly: true,
    fileMustExist: true,
    // @ts-expect-error custom_types is supported by the pinned native runtime ahead of its public union.
    experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
  });
  let connected = false;
  let inspectionCompleted = false;
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
    inspectionCompleted = true;
    await validateVibecanvasHomeLayout(args.homeDir, args.databasePath, result.status === 'empty');
    return result;
  } catch (error) {
    preflightError = error;
  } finally {
    if (connected) await database.close();
  }

  if (!inspectionCompleted) {
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

  if (
    preflightError instanceof Error
    && preflightError.message.startsWith('Refusing to open Vibecanvas database:')
  ) {
    throw preflightError;
  }
  const reason = preflightError instanceof Error ? preflightError.message : String(preflightError);
  throw new Error(
    `Refusing to open Vibecanvas database after a read-only preflight failed: ${args.databasePath}: ${reason}`,
    { cause: preflightError },
  );
}

export class DbServiceTurso implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'DbServiceTurso'
  #database: Database
  #databasePortal: Database
  #resourceWriteTails = new Map<string, Promise<void>>()
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
      // @ts-expect-error experimental feature list is ahead of package typings
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
        appliedAtMs: Date.now(),
        expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
      })
    } catch (error) {
      await this.#database.close()
      this.#isConnected = false
      throw error
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
    await this.#ensureSqliteShmSentinel();
    try {
      await this.#connectAndMigrate();
      return;
    } catch (startupError) {
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

  #serializeResourceWrite<T>(tenant: TTenantContext, write: () => Promise<T>): Promise<T> {
    const key = fnScopedKey('db-resource-write', [tenant.orgId])
    const previous = this.#resourceWriteTails.get(key) ?? Promise.resolve()
    const run = () => this.#serializeDatabaseWrite(write)
    const result = previous.then(run, run)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.#resourceWriteTails.set(key, tail)
    void tail.then(() => {
      if (this.#resourceWriteTails.get(key) === tail) this.#resourceWriteTails.delete(key)
    })

    return result
  }

  #serializeDatabaseWrite<T>(write: () => Promise<T>): Promise<T> {
    return txRunDatabaseWrite({ database: this.db }, { operation: write })
  }

  account = {
    getDefaultOwner: (tenant: TTenantContext) => fxAccountGetDefaultOwner(this, { tenant }),
    ensureDefaultOwner: () => this.#serializeDatabaseWrite(() => txAccountEnsureDefaultOwner(this, {})),
  };

  canvas = {
    listAll: (tenant: TTenantContext) => fxCanvasListAll(this, { tenant }),
    findByName: (tenant: TTenantContext, args: { name: string }) => fxCanvasFindByName(this, { tenant, ...args }),
    findById: (tenant: TTenantContext, args: { id: string }) => fxCanvasFindById(this, { tenant, ...args }),
    create: (tenant: TTenantContext, args: TCanvasCreateArgs) => this.#serializeDatabaseWrite(
      () => txCanvasCreate(this, { tenant, ...args }),
    ),
    renameById: (tenant: TTenantContext, args: { id: string, name: string }) => this.#serializeDatabaseWrite(
      () => txCanvasRenameById(this, { tenant, ...args }),
    ),
    deleteById: (tenant: TTenantContext, args: { id: string }) => this.#serializeDatabaseWrite(
      () => txCanvasDeleteById(this, { tenant, ...args }),
    ),
    listMembers: (tenant: TTenantContext, args: { canvasId: string }) => fxCanvasListMembers(this, { tenant, ...args }),
  };

  file = {
    listAll: (tenant: TTenantContext) => fxFileListAll(this, { tenant }),
    create: (tenant: TTenantContext, args: TFileCreateArgs) => this.#serializeDatabaseWrite(
      () => txFileCreate(this, { tenant, ...args }),
    ),
    getById: (tenant: TTenantContext, args: { id: string }) => fxFileGetById(this, { tenant, ...args }),
    deleteById: (tenant: TTenantContext, args: { id: string }) => this.#serializeDatabaseWrite(
      () => txFileDeleteById(this, { tenant, ...args }),
    ),
  };

  keyValue = {
    add: (tenant: TTenantContext, args: TKeyValue) => this.#serializeDatabaseWrite(
      () => txKeyValueAdd(this, { tenant, ...args }),
    ),
    remove: (tenant: TTenantContext, args: { name: string }) => this.#serializeDatabaseWrite(
      () => txKeyValueRemove(this, { tenant, ...args }),
    ),
    get: (tenant: TTenantContext, args: { name: string }) => fxKeyValueGet(this, { tenant, ...args }),
  };

  resourceEncryptionKey = {
    get: (tenant: TTenantContext, args: { resourceId: string }) => fxResourceEncryptionKeyGet(this, { tenant, ...args }),
    getOrCreate: (tenant: TTenantContext, args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }) => this.#serializeResourceWrite(tenant, () => (
      txResourceEncryptionKeyGetOrCreate(this, { tenant, ...args })
    )),
  };

  dbResource = {
    draft: {
      create: (tenant: TTenantContext, args: { id: string; resourceId: string; name: string }) => this.#serializeResourceWrite(tenant, () => txDbResourceDraftCreate(this, { tenant, ...args })),
      get: (tenant: TTenantContext, args: { id: string }) => fxDbResourceDraftGet(this, { tenant, ...args }),
      getActive: (tenant: TTenantContext, args: { resourceId: string }) => fxDbResourceDraftGetActive(this, { tenant, ...args }),
      list: (tenant: TTenantContext, args: {
        resourceId: string;
        status?: TDbResourceDraftStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }) => fxDbResourceDraftList(this, { tenant, ...args }),
      rename: (tenant: TTenantContext, args: { id: string; name: string }) => this.#serializeResourceWrite(tenant, () => txDbResourceDraftRename(this, { tenant, ...args })),
      updateStatus: (tenant: TTenantContext, args: {
        id: string;
        status: TDbResourceDraftStatus;
        expectedStatus?: TDbResourceDraftStatus;
        lastError?: TJson | null;
      }) => this.#serializeResourceWrite(tenant, () => txDbResourceDraftUpdateStatus(this, { tenant, ...args })),
      discard: (tenant: TTenantContext, args: { id: string; lastError?: TJson | null }) => this.#serializeResourceWrite(tenant, () => txDbResourceDraftDiscard(this, { tenant, ...args })),
      change: {
        list: (tenant: TTenantContext, args: { draftId: string }) => fxDbResourceDraftChangeList(this, { tenant, ...args }),
        append: (tenant: TTenantContext, args: {
          draftId: string;
          sequence: number;
          kind: TDbResourceDraftChangeKind;
          operation?: TJson | null;
          sql: string;
        }) => this.#serializeResourceWrite(tenant, () => txDbResourceDraftAppendChange(this, { tenant, ...args })),
      },
    },
    apply: {
      create: (tenant: TTenantContext, args: {
        id: string;
        resourceId: string;
        draftId?: string | null;
        sourceApplyId?: string | null;
        status?: TDbResourceApplyStatus;
      }) => this.#serializeResourceWrite(tenant, () => txDbResourceApplyCreate(this, { tenant, ...args })),
      createFromDraft: (tenant: TTenantContext, args: { id: string; resourceId: string; draftId: string }) => (
        this.#serializeResourceWrite(tenant, () => txDbResourceApplyCreateFromDraft(this, { tenant, ...args }))
      ),
      get: (tenant: TTenantContext, args: { id: string }) => fxDbResourceApplyGet(this, { tenant, ...args }),
      list: (tenant: TTenantContext, args: {
        resourceId: string;
        status?: TDbResourceApplyStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }) => fxDbResourceApplyList(this, { tenant, ...args }),
      update: (tenant: TTenantContext, args: {
        id: string;
        status: TDbResourceApplyStatus;
        expectedStatus?: TDbResourceApplyStatus;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeResourceWrite(tenant, () => txDbResourceApplyUpdate(this, { tenant, ...args })),
      finishWithDraft: (tenant: TTenantContext, args: {
        id: string;
        draftId: string;
        status: Extract<TDbResourceApplyStatus, "succeeded" | "failed" | "recovered">;
        expectedStatus?: TDbResourceApplyStatus;
        draftStatus: Extract<TDbResourceDraftStatus, "applied" | "editing" | "error">;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeResourceWrite(tenant, () => txDbResourceApplyFinishWithDraft(this, { tenant, ...args })),
    },
  };

  toolGroup = {
    listAll: (tenant: TTenantContext) => fxToolGroupListAll(this, { tenant }),
    getByName: (tenant: TTenantContext, args: { name: string }) => fxToolGroupGetByName(this, { tenant, ...args }),
    create: (tenant: TTenantContext, args: TToolGroup) => this.#serializeDatabaseWrite(
      () => txToolGroupCreate(this, { tenant, ...args }),
    ),
    update: (tenant: TTenantContext, args: TToolGroup & { currentName: string }) => this.#serializeDatabaseWrite(
      () => txToolGroupUpdate(this, { tenant, ...args }),
    ),
    remove: (tenant: TTenantContext, args: { name: string }) => this.#serializeDatabaseWrite(
      () => txToolGroupRemove(this, { tenant, ...args }),
    ),
  };


  forTenant(tenant: TTenantContext) {
    const bind = <TArgs extends unknown[], TResult>(
      operation: (tenantContext: TTenantContext, ...args: TArgs) => TResult,
    ) => (...args: TArgs): TResult => operation(tenant, ...args)

    return {
      account: {
        getDefaultOwner: bind(this.account.getDefaultOwner),
      },
      canvas: {
        listAll: bind(this.canvas.listAll),
        findByName: bind(this.canvas.findByName),
        findById: bind(this.canvas.findById),
        create: bind(this.canvas.create),
        renameById: bind(this.canvas.renameById),
        deleteById: bind(this.canvas.deleteById),
        listMembers: bind(this.canvas.listMembers),
      },
      file: {
        listAll: bind(this.file.listAll),
        create: bind(this.file.create),
        getById: bind(this.file.getById),
        deleteById: bind(this.file.deleteById),
      },
      keyValue: {
        add: bind(this.keyValue.add),
        remove: bind(this.keyValue.remove),
        get: bind(this.keyValue.get),
      },
      resourceEncryptionKey: {
        get: bind(this.resourceEncryptionKey.get),
        getOrCreate: bind(this.resourceEncryptionKey.getOrCreate),
      },
      dbResource: {
        draft: {
          create: bind(this.dbResource.draft.create),
          get: bind(this.dbResource.draft.get),
          getActive: bind(this.dbResource.draft.getActive),
          list: bind(this.dbResource.draft.list),
          rename: bind(this.dbResource.draft.rename),
          updateStatus: bind(this.dbResource.draft.updateStatus),
          discard: bind(this.dbResource.draft.discard),
          change: {
            list: bind(this.dbResource.draft.change.list),
            append: bind(this.dbResource.draft.change.append),
          },
        },
        apply: {
          create: bind(this.dbResource.apply.create),
          createFromDraft: bind(this.dbResource.apply.createFromDraft),
          get: bind(this.dbResource.apply.get),
          list: bind(this.dbResource.apply.list),
          update: bind(this.dbResource.apply.update),
          finishWithDraft: bind(this.dbResource.apply.finishWithDraft),
        },
      },
      toolGroup: {
        listAll: bind(this.toolGroup.listAll),
        getByName: bind(this.toolGroup.getByName),
        create: bind(this.toolGroup.create),
        update: bind(this.toolGroup.update),
        remove: bind(this.toolGroup.remove),
      },
    }
  }
}

export type TTenantDb = ReturnType<DbServiceTurso['forTenant']>
