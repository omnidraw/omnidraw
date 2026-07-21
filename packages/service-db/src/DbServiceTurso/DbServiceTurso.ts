import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
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
  filesystem: {
    listAll(tenant: TTenantContext): Promise<TFilesystem[]>;
    findById(tenant: TTenantContext, args: { id: string }): Promise<TFilesystem | null>;
    create(tenant: TTenantContext, args: TFilesystemCreateArgs): Promise<TFilesystem>;
  };
  keyValue: {
    add(tenant: TTenantContext, args: TKeyValue): Promise<TKeyValue>;
    remove(tenant: TTenantContext, args: { name: string }): Promise<void>;
    get(tenant: TTenantContext, args: { name: string }): Promise<TKeyValue | null>;
  };
  actorResourceEncryptionKey: {
    get(tenant: TTenantContext, args: { resourceId: string }): Promise<TEncryptionKey | null>;
    getOrCreate(tenant: TTenantContext, args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }): Promise<TEncryptionKey>;
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
  actor: {
    listDefinitions(tenant: TTenantContext): Promise<TActorDefinition[]>;
    insertDefinition(tenant: TTenantContext, def: TActorDefinitionCreateArgs): Promise<TActorDefinition>;
    deleteDefinition(tenant: TTenantContext, id: string): Promise<void>;
    updateDefinition(tenant: TTenantContext, def: TActorDefinitionUpdateArgs): Promise<TActorDefinition | null>;
    reload(tenant: TTenantContext): Promise<void>;
    listInstances(tenant: TTenantContext, filter?: { canvasId?: string }): Promise<TActorInstance[]>;
    insertInstance(tenant: TTenantContext, instance: TActorInstanceCreateArgs): Promise<TActorInstance>;
    updateInstanceStatus(tenant: TTenantContext, instance: TActorInstanceUpdateStatusArgs): Promise<TActorInstance | null>;
    updateInstanceHealth(tenant: TTenantContext, instance: TActorInstanceUpdateHealthArgs): Promise<TActorInstance | null>;
    updateInstanceMachine(tenant: TTenantContext, instance: TActorInstanceUpdateMachineArgs): Promise<TActorInstance | null>;
    deleteInstance(tenant: TTenantContext, id: string): Promise<void>;
    listConnections(tenant: TTenantContext): Promise<TActorConnection[]>;
    insertConnection(tenant: TTenantContext, connection: TActorConnectionCreateArgs): Promise<TActorConnection>;
    deleteConnectionById(tenant: TTenantContext, id: string): Promise<void>;
    deleteConnectionBySource(tenant: TTenantContext, actorId: string): Promise<void>;
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
  #actorWriteTails = new Map<string, Promise<void>>()
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

  #serializeActorWrite<T>(tenant: TTenantContext, write: () => Promise<T>): Promise<T> {
    const key = fnScopedKey('db-actor-write', [tenant.orgId])
    const previous = this.#actorWriteTails.get(key) ?? Promise.resolve()
    const result = previous.then(write, write)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.#actorWriteTails.set(key, tail)
    void tail.then(() => {
      if (this.#actorWriteTails.get(key) === tail) this.#actorWriteTails.delete(key)
    })

    return result
  }

  account = {
    getDefaultOwner: (tenant: TTenantContext) => fxAccountGetDefaultOwner(this, { tenant }),
    ensureDefaultOwner: () => txAccountEnsureDefaultOwner(this, {}),
  };

  canvas = {
    listAll: (tenant: TTenantContext) => fxCanvasListAll(this, { tenant }),
    findByName: (tenant: TTenantContext, args: { name: string }) => fxCanvasFindByName(this, { tenant, ...args }),
    findById: (tenant: TTenantContext, args: { id: string }) => fxCanvasFindById(this, { tenant, ...args }),
    create: (tenant: TTenantContext, args: TCanvasCreateArgs) => txCanvasCreate(this, { tenant, ...args }),
    renameById: (tenant: TTenantContext, args: { id: string, name: string }) => txCanvasRenameById(this, { tenant, ...args }),
    deleteById: (tenant: TTenantContext, args: { id: string }) => txCanvasDeleteById(this, { tenant, ...args }),
    listMembers: (tenant: TTenantContext, args: { canvasId: string }) => fxCanvasListMembers(this, { tenant, ...args }),
  };

  file = {
    listAll: (tenant: TTenantContext) => fxFileListAll(this, { tenant }),
    create: (tenant: TTenantContext, args: TFileCreateArgs) => txFileCreate(this, { tenant, ...args }),
    getById: (tenant: TTenantContext, args: { id: string }) => fxFileGetById(this, { tenant, ...args }),
    deleteById: (tenant: TTenantContext, args: { id: string }) => txFileDeleteById(this, { tenant, ...args }),
  };

  filesystem = {
    listAll: (tenant: TTenantContext) => fxFilesystemListAll(this, { tenant }),
    findById: (tenant: TTenantContext, args: { id: string }) => fxFilesystemFindById(this, { tenant, ...args }),
    create: (tenant: TTenantContext, args: TFilesystemCreateArgs) => txFilesystemCreate(this, { tenant, ...args }),
  };

  keyValue = {
    add: (tenant: TTenantContext, args: TKeyValue) => txKeyValueAdd(this, { tenant, ...args }),
    remove: (tenant: TTenantContext, args: { name: string }) => txKeyValueRemove(this, { tenant, ...args }),
    get: (tenant: TTenantContext, args: { name: string }) => fxKeyValueGet(this, { tenant, ...args }),
  };

  resourceEncryptionKey = {
    get: (tenant: TTenantContext, args: { resourceId: string }) => fxActorResourceEncryptionKeyGet(this, { tenant, ...args }),
    getOrCreate: (tenant: TTenantContext, args: {
      resourceId: string;
      keyId: string;
      purpose: string;
      algorithm: string;
      keyHex: string;
    }) => this.#serializeActorWrite(tenant, () => (
      txActorResourceEncryptionKeyGetOrCreate(this, { tenant, ...args })
    )),
  };

  /** @deprecated Use resourceEncryptionKey. */
  actorResourceEncryptionKey = this.resourceEncryptionKey;

  actorResource = {
    create: (tenant: TTenantContext, args: {
      id: string;
      kind: TActorResourceKind;
      name: string;
      status?: TActorResourceStatus;
      lastError?: TJson | null;
    }) => this.#serializeActorWrite(tenant, () => txActorResourceCreate(this, { tenant, ...args })),
    get: (tenant: TTenantContext, args: { id: string }) => fxActorResourceGet(this, { tenant, ...args }),
    findByNameKey: (tenant: TTenantContext, args: { nameKey: string }) => fxActorResourceFindByNameKey(this, { tenant, ...args }),
    list: (tenant: TTenantContext, args: { kind?: TActorResourceKind; status?: TActorResourceStatus } = {}) => fxActorResourceList(this, { tenant, ...args }),
    rename: (tenant: TTenantContext, args: { id: string; name: string }) => this.#serializeActorWrite(tenant, () => txActorResourceRename(this, { tenant, ...args })),
    updateProviderState: (tenant: TTenantContext, args: {
      id: string;
      status?: TActorResourceStatus;
      lastError?: TJson | null;
    }) => this.#serializeActorWrite(tenant, () => txActorResourceUpdateProviderState(this, { tenant, ...args })),
    beginDelete: (tenant: TTenantContext, args: { id: string }) => this.#serializeActorWrite(tenant, () => txActorResourceBeginDelete(this, { tenant, ...args })),
    delete: (tenant: TTenantContext, args: { id: string }) => this.#serializeActorWrite(tenant, () => txActorResourceDelete(this, { tenant, ...args })),
    listBindingsForDefinition: (tenant: TTenantContext, args: { definitionName: string }) => fxActorResourceListBindingsForDefinition(this, { tenant, ...args }),
    listBindingsForResource: (tenant: TTenantContext, args: { resourceId: string }) => fxActorResourceListBindingsForResource(this, { tenant, ...args }),
    listDefinitionsReferencingResource: (tenant: TTenantContext, args: { resourceId: string }) => fxActorResourceListDefinitionsReferencingResource(this, { tenant, ...args }),
    upsertBinding: (tenant: TTenantContext, args: {
      definitionName: string;
      slotName: string;
      resourceId: string;
      allowRead: boolean;
      allowWrite: boolean;
    }) => this.#serializeActorWrite(tenant, () => txActorResourceUpsertBinding(this, { tenant, ...args })),
    removeBinding: (tenant: TTenantContext, args: { definitionName: string; slotName: string }) => this.#serializeActorWrite(tenant, () => txActorResourceRemoveBinding(this, { tenant, ...args })),
    replaceBindings: (tenant: TTenantContext, args: {
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
    }) => this.#serializeActorWrite(tenant, () => txActorResourceReplaceBindings(this, { tenant, ...args })),
  };

  dbResource = {
    draft: {
      create: (tenant: TTenantContext, args: { id: string; resourceId: string; name: string }) => this.#serializeActorWrite(tenant, () => txDbResourceDraftCreate(this, { tenant, ...args })),
      get: (tenant: TTenantContext, args: { id: string }) => fxDbResourceDraftGet(this, { tenant, ...args }),
      getActive: (tenant: TTenantContext, args: { resourceId: string }) => fxDbResourceDraftGetActive(this, { tenant, ...args }),
      list: (tenant: TTenantContext, args: {
        resourceId: string;
        status?: TDbResourceDraftStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }) => fxDbResourceDraftList(this, { tenant, ...args }),
      rename: (tenant: TTenantContext, args: { id: string; name: string }) => this.#serializeActorWrite(tenant, () => txDbResourceDraftRename(this, { tenant, ...args })),
      updateStatus: (tenant: TTenantContext, args: {
        id: string;
        status: TDbResourceDraftStatus;
        expectedStatus?: TDbResourceDraftStatus;
        lastError?: TJson | null;
      }) => this.#serializeActorWrite(tenant, () => txDbResourceDraftUpdateStatus(this, { tenant, ...args })),
      discard: (tenant: TTenantContext, args: { id: string; lastError?: TJson | null }) => this.#serializeActorWrite(tenant, () => txDbResourceDraftDiscard(this, { tenant, ...args })),
      change: {
        list: (tenant: TTenantContext, args: { draftId: string }) => fxDbResourceDraftChangeList(this, { tenant, ...args }),
        append: (tenant: TTenantContext, args: {
          draftId: string;
          sequence: number;
          kind: TDbResourceDraftChangeKind;
          operation?: TJson | null;
          sql: string;
        }) => this.#serializeActorWrite(tenant, () => txDbResourceDraftAppendChange(this, { tenant, ...args })),
      },
    },
    apply: {
      create: (tenant: TTenantContext, args: {
        id: string;
        resourceId: string;
        draftId?: string | null;
        sourceApplyId?: string | null;
        status?: TDbResourceApplyStatus;
      }) => this.#serializeActorWrite(tenant, () => txDbResourceApplyCreate(this, { tenant, ...args })),
      createFromDraft: (tenant: TTenantContext, args: { id: string; resourceId: string; draftId: string }) => (
        this.#serializeActorWrite(tenant, () => txDbResourceApplyCreateFromDraft(this, { tenant, ...args }))
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
      }) => this.#serializeActorWrite(tenant, () => txDbResourceApplyUpdate(this, { tenant, ...args })),
      finishWithDraft: (tenant: TTenantContext, args: {
        id: string;
        draftId: string;
        status: Extract<TDbResourceApplyStatus, "succeeded" | "failed" | "recovered">;
        expectedStatus?: TDbResourceApplyStatus;
        draftStatus: Extract<TDbResourceDraftStatus, "applied" | "editing" | "error">;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeActorWrite(tenant, () => txDbResourceApplyFinishWithDraft(this, { tenant, ...args })),
      instanceResult: {
        upsert: (tenant: TTenantContext, args: {
          applyId: string;
          actorInstanceId: string;
          actorDefinitionName: string;
          wasRunning: boolean;
          status: TDbResourceApplyInstanceStatus;
          error?: TJson | null;
        }) => this.#serializeActorWrite(tenant, () => txDbResourceApplyInstanceResultUpsert(this, { tenant, ...args })),
        listByApply: (tenant: TTenantContext, args: { applyId: string }) => fxDbResourceApplyInstanceResultListByApply(this, { tenant, ...args }),
        listByInstance: (tenant: TTenantContext, args: { actorInstanceId: string }) => fxDbResourceApplyInstanceResultListByInstance(this, { tenant, ...args }),
      },
    },
    listAffectedInstances: (tenant: TTenantContext, args: { resourceId: string }) => fxDbResourceListAffectedInstances(this, { tenant, ...args }),
  };

  toolGroup = {
    listAll: (tenant: TTenantContext) => fxToolGroupListAll(this, { tenant }),
    getByName: (tenant: TTenantContext, args: { name: string }) => fxToolGroupGetByName(this, { tenant, ...args }),
    create: (tenant: TTenantContext, args: TToolGroup) => txToolGroupCreate(this, { tenant, ...args }),
    update: (tenant: TTenantContext, args: TToolGroup & { currentName: string }) => txToolGroupUpdate(this, { tenant, ...args }),
    remove: (tenant: TTenantContext, args: { name: string }) => txToolGroupRemove(this, { tenant, ...args }),
  };

  actor = {
    listDefinitions: (tenant: TTenantContext) => fxActorListDefinitions(this, { tenant }),
    insertDefinition: (tenant: TTenantContext, def: TActorDefinitionCreateArgs) => this.#serializeActorWrite(tenant, () => txActorInsertDefinition(this, { tenant, ...def })),
    deleteDefinition: (tenant: TTenantContext, name: string) => this.#serializeActorWrite(tenant, () => txActorDeleteDefinition(this, { tenant, name })),
    getDefinition: (tenant: TTenantContext, name: string) => fxActorGetDefinition(this, { tenant, name }),
    updateDefinition: (tenant: TTenantContext, def: TActorDefinitionUpdateArgs) => this.#serializeActorWrite(tenant, () => txActorUpdateDefinition(this, { tenant, ...def })),
    reload: async (_tenant: TTenantContext) => {
      // TODO: i forgot what this was about
    },
    listInstances: (tenant: TTenantContext, filter?: { canvasId?: string }) => fxActorListInstances(this, { tenant, canvasId: filter?.canvasId }),
    insertInstance: (tenant: TTenantContext, instance: TActorInstanceCreateArgs) => this.#serializeActorWrite(tenant, () => txActorInsertInstance(this, { tenant, ...instance })),
    updateInstanceStatus: (tenant: TTenantContext, instance: TActorInstanceUpdateStatusArgs) => this.#serializeActorWrite(tenant, () => txActorUpdateInstanceStatus(this, { tenant, ...instance })),
    updateInstanceHealth: (tenant: TTenantContext, instance: TActorInstanceUpdateHealthArgs) => this.#serializeActorWrite(tenant, () => txActorUpdateInstanceHealth(this, { tenant, ...instance })),
    updateInstanceMachine: (tenant: TTenantContext, instance: TActorInstanceUpdateMachineArgs) => this.#serializeActorWrite(tenant, () => txActorUpdateInstanceMachine(this, { tenant, ...instance })),
    getInstanceByElementId: (tenant: TTenantContext, elementId: string) => fxActorGetInstanceByElementId(this, { tenant, elementId }),
    getInstanceById: (tenant: TTenantContext, instanceId: string) => fxActorGetInstanceById(this, { tenant, instanceId }),
    deleteInstance: (tenant: TTenantContext, id: string) => this.#serializeActorWrite(tenant, () => txActorDeleteInstance(this, { tenant, id })),
    listConnections: (tenant: TTenantContext) => fxActorListConnections(this, { tenant }),
    insertConnection: (tenant: TTenantContext, connection: TActorConnectionCreateArgs) => this.#serializeActorWrite(tenant, () => txActorInsertConnection(this, { tenant, ...connection })),
    deleteConnectionById: (tenant: TTenantContext, id: string) => this.#serializeActorWrite(tenant, () => txActorDeleteConnectionById(this, { tenant, id })),
    deleteConnectionBySource: (tenant: TTenantContext, actorId: string) => this.#serializeActorWrite(tenant, () => txActorDeleteConnectionBySource(this, { tenant, actorId })),
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
      filesystem: {
        listAll: bind(this.filesystem.listAll),
        findById: bind(this.filesystem.findById),
        create: bind(this.filesystem.create),
      },
      keyValue: {
        add: bind(this.keyValue.add),
        remove: bind(this.keyValue.remove),
        get: bind(this.keyValue.get),
      },
      actorResourceEncryptionKey: {
        get: bind(this.actorResourceEncryptionKey.get),
        getOrCreate: bind(this.actorResourceEncryptionKey.getOrCreate),
      },
      resourceEncryptionKey: {
        get: bind(this.resourceEncryptionKey.get),
        getOrCreate: bind(this.resourceEncryptionKey.getOrCreate),
      },
      actorResource: {
        create: bind(this.actorResource.create),
        get: bind(this.actorResource.get),
        findByNameKey: bind(this.actorResource.findByNameKey),
        list: bind(this.actorResource.list),
        rename: bind(this.actorResource.rename),
        updateProviderState: bind(this.actorResource.updateProviderState),
        beginDelete: bind(this.actorResource.beginDelete),
        delete: bind(this.actorResource.delete),
        listBindingsForDefinition: bind(this.actorResource.listBindingsForDefinition),
        listBindingsForResource: bind(this.actorResource.listBindingsForResource),
        listDefinitionsReferencingResource: bind(this.actorResource.listDefinitionsReferencingResource),
        upsertBinding: bind(this.actorResource.upsertBinding),
        removeBinding: bind(this.actorResource.removeBinding),
        replaceBindings: bind(this.actorResource.replaceBindings),
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
          instanceResult: {
            upsert: bind(this.dbResource.apply.instanceResult.upsert),
            listByApply: bind(this.dbResource.apply.instanceResult.listByApply),
            listByInstance: bind(this.dbResource.apply.instanceResult.listByInstance),
          },
        },
        listAffectedInstances: bind(this.dbResource.listAffectedInstances),
      },
      toolGroup: {
        listAll: bind(this.toolGroup.listAll),
        getByName: bind(this.toolGroup.getByName),
        create: bind(this.toolGroup.create),
        update: bind(this.toolGroup.update),
        remove: bind(this.toolGroup.remove),
      },
      actor: {
        listDefinitions: bind(this.actor.listDefinitions),
        insertDefinition: bind(this.actor.insertDefinition),
        deleteDefinition: bind(this.actor.deleteDefinition),
        getDefinition: bind(this.actor.getDefinition),
        updateDefinition: bind(this.actor.updateDefinition),
        reload: bind(this.actor.reload),
        listInstances: bind(this.actor.listInstances),
        insertInstance: bind(this.actor.insertInstance),
        updateInstanceStatus: bind(this.actor.updateInstanceStatus),
        updateInstanceHealth: bind(this.actor.updateInstanceHealth),
        updateInstanceMachine: bind(this.actor.updateInstanceMachine),
        getInstanceByElementId: bind(this.actor.getInstanceByElementId),
        getInstanceById: bind(this.actor.getInstanceById),
        deleteInstance: bind(this.actor.deleteInstance),
        listConnections: bind(this.actor.listConnections),
        insertConnection: bind(this.actor.insertConnection),
        deleteConnectionById: bind(this.actor.deleteConnectionById),
        deleteConnectionBySource: bind(this.actor.deleteConnectionBySource),
      },
    }
  }
}

export type TTenantDb = ReturnType<DbServiceTurso['forTenant']>
