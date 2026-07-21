import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import type { Dirent } from 'node:fs';
import path from "node:path";
import * as fs from 'node:fs/promises';
import {
  DEFAULT_OSS_ORGANIZATION_ID,
  INITIAL_MIGRATION_NAME,
  MIGRATION_APPLICATION_VERSION_FALLBACK,
} from '../CONSTANTS';
import { INITIAL_MIGRATION } from '../migrations/CONSTANTS';
import type { IDbConfig } from "../interface";
import type { TActorConnection, TActorDefinition, TActorInstance, TActorResource, TActorResourceKind, TActorResourceStatus, TCanvas, TCanvasMember, TDbResourceApplyInstanceStatus, TDbResourceApplyStatus, TDbResourceDraftChangeKind, TDbResourceDraftStatus, TEncryptionKey, TFilesystem, TJson, TKeyValue, TMediaFile, TToolGroup } from "../model";
import { EXPECTED_APPLICATION_TABLES } from '../schema/expected-schema';
import { fxAccountGetDefaultOwner } from "./fx.account";
import { fxActorGetDefinition, fxActorGetInstanceByElementId, fxActorGetInstanceById, fxActorListConnections, fxActorListDefinitions, fxActorListInstances } from "./fx.actor";
import { fxActorResourceFindByNameKey, fxActorResourceGet, fxActorResourceList, fxActorResourceListBindingsForDefinition, fxActorResourceListBindingsForResource, fxActorResourceListDefinitionsReferencingResource } from "./fx.actor-resource";
import { fxCanvasFindById, fxCanvasFindByName, fxCanvasListAll, fxCanvasListMembers } from "./fx.canvas";
import { fxDbResourceApplyGet, fxDbResourceApplyInstanceResultListByApply, fxDbResourceApplyInstanceResultListByInstance, fxDbResourceApplyList, fxDbResourceDraftChangeList, fxDbResourceDraftGet, fxDbResourceDraftGetActive, fxDbResourceDraftList, fxDbResourceListAffectedInstances } from "./fx.db-resource";
import { fxActorResourceEncryptionKeyGet } from "./fx.encryption-key";
import { fxFileGetById, fxFileListAll } from "./fx.file";
import { fxFilesystemFindById, fxFilesystemListAll } from "./fx.filesystem";
import { fxKeyValueGet } from "./fx.keyValue";
import { fxReadMigrationFile } from './fx.migration-file';
import { fxPreflightMigrationState } from './fx.migration-state';
import { fxToolGroupGetByName, fxToolGroupListAll } from "./fx.tool-group";
import { txAccountEnsureDefaultOwner } from "./tx.account";
import { txActorDeleteConnectionById, txActorDeleteConnectionBySource, txActorDeleteDefinition, txActorDeleteInstance, txActorInsertConnection, txActorInsertDefinition, txActorInsertInstance, txActorUpdateDefinition, txActorUpdateInstanceHealth, txActorUpdateInstanceMachine, txActorUpdateInstanceStatus } from "./tx.actor";
import { txActorResourceBeginDelete, txActorResourceCreate, txActorResourceDelete, txActorResourceRemoveBinding, txActorResourceRename, txActorResourceReplaceBindings, txActorResourceUpdateProviderState, txActorResourceUpsertBinding } from "./tx.actor-resource";
import { txCanvasCreate, txCanvasDeleteById, txCanvasRenameById } from "./tx.canvas";
import { txDbResourceApplyCreate, txDbResourceApplyCreateFromDraft, txDbResourceApplyFinishWithDraft, txDbResourceApplyInstanceResultUpsert, txDbResourceApplyUpdate, txDbResourceDraftAppendChange, txDbResourceDraftCreate, txDbResourceDraftDiscard, txDbResourceDraftRename, txDbResourceDraftUpdateStatus } from "./tx.db-resource";
import { txActorResourceEncryptionKeyGetOrCreate } from "./tx.encryption-key";
import { txFileCreate, txFileDeleteById } from "./tx.file";
import { txFilesystemCreate } from "./tx.filesystem";
import { txKeyValueAdd, txKeyValueRemove } from "./tx.keyValue";
import { txToolGroupCreate, txToolGroupRemove, txToolGroupUpdate } from "./tx.tool-group";
import { txRunMigrations } from "./tx.migrations";
import { Database } from "./turso-native";
import type { TDatabasePreflightResult } from './migration-types';

declare const VIBECANVAS_VERSION: string | undefined;

type TCanvasCreateArgs = Omit<TCanvas, "created_at">;
type TFileCreateArgs = Omit<TMediaFile, "created_at">
type TFilesystemCreateArgs = Omit<TFilesystem, "created_at" | "updated_at">;
type TActorDefinitionCreateArgs = Omit<TActorDefinition, "created_at" | "updated_at">;
type TActorDefinitionUpdateArgs = Omit<TActorDefinition, "id" | "created_at" | "updated_at"> & { currentSlug?: string };
type TActorInstanceCreateArgs = Omit<TActorInstance, "created_at" | "updated_at" | "machine_context" | "last_error"> & { machine_context: TJson; last_error?: TActorInstance['last_error'] };
type TActorInstanceUpdateStatusArgs = Pick<TActorInstance, "id" | "status">;
type TActorInstanceUpdateHealthArgs = Pick<TActorInstance, "id" | "status" | "last_error">;
type TActorInstanceUpdateMachineArgs = Pick<TActorInstance, "id" | "machine_state"> & { machine_context: TJson };
type TActorConnectionCreateArgs = Omit<TActorConnection, "created_at" | "updated_at" | "style"> & { style: TJson };


/**
 * Interface follows same pattern.
 * args, accountId?
 * If no accountId -> no authz check -> auto pass
 */
interface IPublicMethods {
  canvas: {
    listAll(args?: { accountId?: string }): Promise<TCanvas[]>;
    findByName(args: { name: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    findById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    create(args: TCanvasCreateArgs, scope?: { accountId?: string }): Promise<TCanvas>;
    renameById(args: { id: string, name: string}, scope?: { accountId?: string }): Promise<TCanvas | null>;
    deleteById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas[]>;
    listMembers(args: { canvasId: string }, accountId?: string): Promise<TCanvasMember[]>;
  };
  file: {
    listAll(): Promise<TMediaFile[]>;
    create(args: TFileCreateArgs): Promise<TMediaFile>;
    getById(args: { id: string }): Promise<TMediaFile | null>;
    deleteById(args: { id: string }): Promise<void>;
  };
  filesystem: {
    listAll(): Promise<TFilesystem[]>;
    findById(id: string): Promise<TFilesystem | null>;
    create(args: TFilesystemCreateArgs): Promise<TFilesystem>;
  };
  keyValue: {
    add(args: TKeyValue): Promise<TKeyValue>;
    remove(args: { name: string }): Promise<void>;
    get(args: { name: string }): Promise<TKeyValue | null>;
  };
  actorResourceEncryptionKey: {
    get(args: { resourceId: string }): Promise<TEncryptionKey | null>;
    getOrCreate(args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }): Promise<TEncryptionKey>;
  };
  toolGroup: {
    listAll(): Promise<TToolGroup[]>;
    getByName(args: { name: string }): Promise<TToolGroup | null>;
    create(args: TToolGroup): Promise<TToolGroup>;
    update(args: TToolGroup & { currentName: string }): Promise<TToolGroup | null>;
    remove(args: { name: string }): Promise<TToolGroup | null>;
  };
  actor: {
    listDefinitions(): Promise<TActorDefinition[]>;
    insertDefinition(def: TActorDefinitionCreateArgs): Promise<TActorDefinition>;
    deleteDefinition(id: string): Promise<void>;
    updateDefinition(def: TActorDefinitionUpdateArgs): Promise<TActorDefinition>;
    reload(): Promise<void>;
    listInstances(filter?: { canvasId?: string }): Promise<TActorInstance[]>;
    insertInstance(instance: TActorInstanceCreateArgs): Promise<TActorInstance>;
    updateInstanceStatus(instance: TActorInstanceUpdateStatusArgs): Promise<TActorInstance>;
    updateInstanceHealth(instance: TActorInstanceUpdateHealthArgs): Promise<TActorInstance>;
    updateInstanceMachine(instance: TActorInstanceUpdateMachineArgs): Promise<TActorInstance>;
    deleteInstance(id: string): Promise<void>;
    listConnections(): Promise<TActorConnection[]>;
    insertConnection(connection: TActorConnectionCreateArgs): Promise<TActorConnection>;
    deleteConnectionById(id: string): Promise<void>;
    deleteConnectionBySource(actorId: string): Promise<void>;
  }
}

type TPreflightDbServiceDatabaseArgs = {
  databasePath: string;
  homeDir: string;
};

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
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
    const expectedLeaves = new Set(['agent', 'artifacts', 'resources', 'temp', 'pty']);
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
      const entries = await fs.readdir(migrationDir, { withFileTypes: true });
      if (entries.length === 0) continue;
      if (
        entries.length !== 1
        || entries[0]?.name !== INITIAL_MIGRATION_NAME
        || !entries[0].isFile()
      ) {
        throw new Error(
          `Refusing actor-era or unknown database-migrations directory in ${homeDir}; `
            + `expected only ${INITIAL_MIGRATION_NAME}.`,
        );
      }
      const [installedMigration, embeddedMigration] = await Promise.all([
        fxReadMigrationFile({ Bun }, { path: path.join(migrationDir, INITIAL_MIGRATION_NAME) }),
        fxReadMigrationFile({ Bun }, { path: INITIAL_MIGRATION.path }),
      ]);
      if (installedMigration.checksumSha256 !== embeddedMigration.checksumSha256) {
        throw new Error(`Refusing database-migrations/${INITIAL_MIGRATION_NAME} with an unknown checksum.`);
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

    throw new Error(
      `Refusing non-empty Vibecanvas home before database bootstrap; unknown entry '${entry.name}' was not modified.`,
    );
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

  const migrationFile = await fxReadMigrationFile({ Bun }, { path: INITIAL_MIGRATION.path });
  const database = new Database(args.databasePath, {
    readonly: true,
    fileMustExist: true,
    // @ts-expect-error custom_types is supported by the pinned native runtime ahead of its public union.
    experimental: ['custom_types', 'triggers', 'index_method'],
  });
  let connected = false;
  try {
    await database.connect();
    connected = true;
    const result = await fxPreflightMigrationState(
      { db: database },
      {
        checksumSha256: migrationFile.checksumSha256,
        expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
      },
    );
    await validateVibecanvasHomeLayout(args.homeDir, args.databasePath, result.status === 'empty');
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing to open Vibecanvas database:')) {
      throw error;
    }
    throw new Error(
      `Refusing to open Vibecanvas database after a read-only preflight failed: ${args.databasePath}`,
      { cause: error },
    );
  } finally {
    if (connected) await database.close();
  }
}

export class DbServiceTurso implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'DbServiceTurso'
  db: Database
  #actorWriteTail: Promise<void> = Promise.resolve()
  #isConnected = false

  constructor(private config: IDbConfig) {
    const experimental = this.config.databasePath === ":memory:"
      ? ["custom_types", "triggers", "index_method"]
      : ["custom_types", "triggers", "index_method", "multiprocess_wal"];

    this.db = new Database(this.config.databasePath, {
      // @ts-expect-error experimental feature list is ahead of package typings
      experimental,
    })
  }
  async start(_ctx?: Parameters<IStartableService["start"]>[0]): Promise<void> {
    await this.db.connect()
    this.#isConnected = true
    try {
      await txRunMigrations({
        db: this.db,
        Bun,
      }, {
        applicationVersion: migrationApplicationVersion(),
        appliedAtMs: Date.now(),
        expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
      })
    } catch (error) {
      await this.db.close()
      this.#isConnected = false
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.#isConnected) return
    await this.db.close()
    this.#isConnected = false
  }

  #serializeActorWrite<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#actorWriteTail.then(write, write)
    this.#actorWriteTail = result.then(
      () => undefined,
      () => undefined,
    )

    return result
  }

  account = {
    getDefaultOwner: () => fxAccountGetDefaultOwner(this, {}),
    ensureDefaultOwner: () => txAccountEnsureDefaultOwner(this, {}),
  };

  canvas = {
    listAll: (args?: { accountId?: string }) => fxCanvasListAll(this, { accountId: args?.accountId }),
    findByName: (args: { name: string }, scope?: { accountId?: string }) => fxCanvasFindByName(this, { ...args, accountId: scope?.accountId }),
    findById: (args: { id: string }, scope?: { accountId?: string }) => fxCanvasFindById(this, { ...args, accountId: scope?.accountId }),
    create: (args: TCanvasCreateArgs, scope?: { accountId?: string }) => txCanvasCreate(this, { ...args, accountId: scope?.accountId }),
    renameById: (args: { id: string, name: string }, scope?: { accountId?: string }) => txCanvasRenameById(this, { ...args, accountId: scope?.accountId }),
    deleteById: (args: { id: string }, scope?: { accountId?: string }) => txCanvasDeleteById(this, { ...args, accountId: scope?.accountId }),
    listMembers: (args: { canvasId: string }) => fxCanvasListMembers(this, args),
  };

  file = {
    listAll: () => fxFileListAll(this, {}),
    create: (args: TFileCreateArgs) => txFileCreate(this, args),
    getById: (args: { id: string }) => fxFileGetById(this, args),
    deleteById: (args: { id: string }) => txFileDeleteById(this, args),
  };

  filesystem = {
    listAll: () => fxFilesystemListAll(this, {}),
    findById: (id: string) => fxFilesystemFindById(this, { id }),
    create: (args: TFilesystemCreateArgs) => txFilesystemCreate(this, args),
  };

  keyValue = {
    add: (args: TKeyValue) => txKeyValueAdd(this, args),
    remove: (args: { name: string }) => txKeyValueRemove(this, args),
    get: (args: { name: string }) => fxKeyValueGet(this, args),
  };

  actorResourceEncryptionKey = {
    get: (args: { resourceId: string }) => fxActorResourceEncryptionKeyGet(this, args),
    getOrCreate: (args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }) => this.#serializeActorWrite(() => (
      txActorResourceEncryptionKeyGetOrCreate(this, args)
    )),
  };

  actorResource = {
    create: (args: {
      id: string;
      kind: TActorResourceKind;
      name: string;
      status?: TActorResourceStatus;
      lastError?: TJson | null;
    }) => this.#serializeActorWrite(() => txActorResourceCreate(this, args)),
    get: (args: { id: string }) => fxActorResourceGet(this, args),
    findByNameKey: (args: { nameKey: string }) => fxActorResourceFindByNameKey(this, args),
    list: (args: { kind?: TActorResourceKind; status?: TActorResourceStatus } = {}) => fxActorResourceList(this, args),
    rename: (args: { id: string; name: string }) => this.#serializeActorWrite(() => txActorResourceRename(this, args)),
    updateProviderState: (args: {
      id: string;
      status?: TActorResourceStatus;
      lastError?: TJson | null;
    }) => this.#serializeActorWrite(() => txActorResourceUpdateProviderState(this, args)),
    beginDelete: (args: { id: string }) => this.#serializeActorWrite(() => txActorResourceBeginDelete(this, args)),
    delete: (args: { id: string }) => this.#serializeActorWrite(() => txActorResourceDelete(this, args)),
    listBindingsForDefinition: (args: { definitionName: string }) => fxActorResourceListBindingsForDefinition(this, args),
    listBindingsForResource: (args: { resourceId: string }) => fxActorResourceListBindingsForResource(this, args),
    listDefinitionsReferencingResource: (args: { resourceId: string }) => fxActorResourceListDefinitionsReferencingResource(this, args),
    upsertBinding: (args: {
      definitionName: string;
      slotName: string;
      resourceId: string;
      allowRead: boolean;
      allowWrite: boolean;
    }) => this.#serializeActorWrite(() => txActorResourceUpsertBinding(this, args)),
    removeBinding: (args: { definitionName: string; slotName: string }) => this.#serializeActorWrite(() => txActorResourceRemoveBinding(this, args)),
    replaceBindings: (args: {
      definitionName: string;
      expectedBindings?: readonly {
        slotName: string;
        resourceId: string;
        allowRead: boolean;
        allowWrite: boolean;
      }[];
      bindings: readonly {
        slotName: string;
        resourceId: string;
        allowRead: boolean;
        allowWrite: boolean;
      }[];
    }) => this.#serializeActorWrite(() => txActorResourceReplaceBindings(this, args)),
  };

  dbResource = {
    draft: {
      create: (args: { id: string; resourceId: string; name: string }) => this.#serializeActorWrite(() => txDbResourceDraftCreate(this, args)),
      get: (args: { id: string }) => fxDbResourceDraftGet(this, args),
      getActive: (args: { resourceId: string }) => fxDbResourceDraftGetActive(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceDraftStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }) => fxDbResourceDraftList(this, args),
      rename: (args: { id: string; name: string }) => this.#serializeActorWrite(() => txDbResourceDraftRename(this, args)),
      updateStatus: (args: {
        id: string;
        status: TDbResourceDraftStatus;
        expectedStatus?: TDbResourceDraftStatus;
        lastError?: TJson | null;
      }) => this.#serializeActorWrite(() => txDbResourceDraftUpdateStatus(this, args)),
      discard: (args: { id: string; lastError?: TJson | null }) => this.#serializeActorWrite(() => txDbResourceDraftDiscard(this, args)),
      change: {
        list: (args: { draftId: string }) => fxDbResourceDraftChangeList(this, args),
        append: (args: {
          draftId: string;
          sequence: number;
          kind: TDbResourceDraftChangeKind;
          operation?: TJson | null;
          sql: string;
        }) => this.#serializeActorWrite(() => txDbResourceDraftAppendChange(this, args)),
      },
    },
    apply: {
      create: (args: {
        id: string;
        resourceId: string;
        draftId?: string | null;
        sourceApplyId?: string | null;
        status?: TDbResourceApplyStatus;
      }) => this.#serializeActorWrite(() => txDbResourceApplyCreate(this, args)),
      createFromDraft: (args: { id: string; resourceId: string; draftId: string }) => (
        this.#serializeActorWrite(() => txDbResourceApplyCreateFromDraft(this, args))
      ),
      get: (args: { id: string }) => fxDbResourceApplyGet(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceApplyStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }) => fxDbResourceApplyList(this, args),
      update: (args: {
        id: string;
        status: TDbResourceApplyStatus;
        expectedStatus?: TDbResourceApplyStatus;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeActorWrite(() => txDbResourceApplyUpdate(this, args)),
      finishWithDraft: (args: {
        id: string;
        draftId: string;
        status: Extract<TDbResourceApplyStatus, "succeeded" | "failed" | "recovered">;
        expectedStatus?: TDbResourceApplyStatus;
        draftStatus: Extract<TDbResourceDraftStatus, "applied" | "editing" | "error">;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeActorWrite(() => txDbResourceApplyFinishWithDraft(this, args)),
      instanceResult: {
        upsert: (args: {
          applyId: string;
          actorInstanceId: string;
          actorDefinitionName: string;
          wasRunning: boolean;
          status: TDbResourceApplyInstanceStatus;
          error?: TJson | null;
        }) => this.#serializeActorWrite(() => txDbResourceApplyInstanceResultUpsert(this, args)),
        listByApply: (args: { applyId: string }) => fxDbResourceApplyInstanceResultListByApply(this, args),
        listByInstance: (args: { actorInstanceId: string }) => fxDbResourceApplyInstanceResultListByInstance(this, args),
      },
    },
    listAffectedInstances: (args: { resourceId: string }) => fxDbResourceListAffectedInstances(this, args),
  };

  toolGroup = {
    listAll: () => fxToolGroupListAll(this, {}),
    getByName: (args: { name: string }) => fxToolGroupGetByName(this, args),
    create: (args: TToolGroup) => txToolGroupCreate(this, args),
    update: (args: TToolGroup & { currentName: string }) => txToolGroupUpdate(this, args),
    remove: (args: { name: string }) => txToolGroupRemove(this, args),
  };

  actor = {
    listDefinitions: () => fxActorListDefinitions(this, {}),
    insertDefinition: (def: TActorDefinitionCreateArgs) => this.#serializeActorWrite(() => txActorInsertDefinition(this, def)),
    deleteDefinition: (name: string) => this.#serializeActorWrite(() => txActorDeleteDefinition(this, { name })),
    getDefinition: (name: string) => fxActorGetDefinition(this, {name}),
    updateDefinition: (def: TActorDefinitionUpdateArgs) => this.#serializeActorWrite(() => txActorUpdateDefinition(this, def)),
    reload: async () => {
      // TODO: i forgot what this was about
    },
    listInstances: (filter?: { canvasId?: string }) => fxActorListInstances(this, { canvasId: filter?.canvasId }),
    insertInstance: (instance: TActorInstanceCreateArgs) => this.#serializeActorWrite(() => txActorInsertInstance(this, instance)),
    updateInstanceStatus: (instance: TActorInstanceUpdateStatusArgs) => this.#serializeActorWrite(() => txActorUpdateInstanceStatus(this, instance)),
    updateInstanceHealth: (instance: TActorInstanceUpdateHealthArgs) => this.#serializeActorWrite(() => txActorUpdateInstanceHealth(this, instance)),
    updateInstanceMachine: (instance: TActorInstanceUpdateMachineArgs) => this.#serializeActorWrite(() => txActorUpdateInstanceMachine(this, instance)),
    getInstanceByElementId: (elementId: string) => fxActorGetInstanceByElementId(this, {elementId}),
    getInstanceById: (instanceId: string) => fxActorGetInstanceById(this, {instanceId}),
    deleteInstance: (id: string) => this.#serializeActorWrite(() => txActorDeleteInstance(this, { id })),
    listConnections: () => fxActorListConnections(this, {}),
    insertConnection: (connection: TActorConnectionCreateArgs) => this.#serializeActorWrite(() => txActorInsertConnection(this, connection)),
    deleteConnectionById: (id: string) => this.#serializeActorWrite(() => txActorDeleteConnectionById(this, { id })),
    deleteConnectionBySource: (actorId: string) => this.#serializeActorWrite(() => txActorDeleteConnectionBySource(this, { actorId })),
  };
}
