import type { IService, IStartableService, IStoppableService } from '@omnidraw/runtime';
import type { IServiceContext } from '@omnidraw/runtime/interface.ts';
import {
  ResourceError,
  type IResourceBindingResolver,
  type IResourceControlStore,
  type IResourceGateway,
  type IResourceUseCoordinator,
  type IResourceWriteCapabilityVerifier,
  type IResourceWritePermitCoordinator,
  type TDbCellValue,
  type TDbDraftOperation,
  type TDbRowCreate,
  type TDbRowDelete,
  type TDbRowIdentity,
  type TDbRowUpdate,
  type TResourceDescriptor,
  type TResourceJson,
  type TResourceKind,
  type TResourceRequirement,
  type TResourceStatus,
} from '@omnidraw/resource-runtime';
import {
  DbResource,
  DbResourceCoordinator,
  fnResourceDataMutationResult,
  fnResourceDataPage,
  KvResource,
  ResourceKeyValueStore,
  ResourceGateway,
  ResourceManager,
  ResourceManagerGateway,
  ResourceStoreService,
  SecretStoreDatabaseKeyProvider,
  SecretStoreResource,
  type IDbResourceCoordinatorControlStore,
  type IResourceManagerStore,
  type ILocalResourceProvider,
  type TDatabaseFactory,
  type TResourceKeyValueDatabaseFactory,
  type TResourceCatalogRecord,
  type TResourceDirectBinding,
  type TResourceManagerCall,
} from '@omnidraw/resource-runtime/local';
import type { TDb } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso';
import { Database } from '@omnidraw/service-db/DbServiceTurso/turso-native';
import { fnResourceNameKey } from '@omnidraw/service-db/core/fn.resource-name';
import {
  RESOURCE_MANAGEMENT_EFFECTS,
  RESOURCE_MANAGEMENT_OPERATION,
} from './CONSTANTS';
import { ResourceManagementProvider } from './ResourceManagementProvider';

type TResourcePlacementIdentity = Readonly<{
  cellId: string;
  placementEpoch: number;
}>;

type TResourceServiceConfig = Readonly<{
  placement: TResourcePlacementIdentity;
  db: TDb;
  controlStore: IResourceControlStore;
  dataRoot: string;
  useCoordinator: IResourceUseCoordinator;
  crypto?: Pick<Crypto, 'randomUUID'>;
  databaseFactory?: TDatabaseFactory;
  maxOpenHandles?: number;
  writeCapabilityVerifier?: IResourceWriteCapabilityVerifier;
  writePermitCoordinator?: IResourceWritePermitCoordinator;
}>;

type TFunctionResourceGatewayRequest = Readonly<{
  requirements: readonly TResourceRequirement[];
  bindings: readonly Readonly<{
    slot: string;
    resourceId: string;
    kind: TResourceKind;
    allowRead: boolean;
    allowWrite: boolean;
  }>[];
}>;

type TFunctionResourceGatewayAccess = Readonly<{
  gateway: IResourceGateway;
  bindings: IResourceBindingResolver;
}>;

function toCatalogResource(resource: TResourceDescriptor): TResourceCatalogRecord {
  return {
    id: resource.id,
    kind: resource.kind,
    name: resource.name,
    status: resource.status,
    lastError: resource.lastError as TResourceJson | null,
    createdAtSec: resource.createdAtSec,
    updatedAtSec: resource.updatedAtSec,
  };
}

function createResourceManagerStore(
  placement: TResourcePlacementIdentity,
  control: IResourceControlStore,
  db: TDb,
): IResourceManagerStore {
  return {
    catalog: {
      list: async (filter) => (await control.listResources(filter)).map(toCatalogResource),
      get: async (args) => {
        const resource = await control.getResource(args.id);
        return resource ? toCatalogResource(resource) : null;
      },
      findByNameKey: async (args) => (await control.listResources())
        .filter((resource) => fnResourceNameKey(resource.name) === args.nameKey)
        .map(toCatalogResource),
      create: async (args) => toCatalogResource(await control.createResource({
        id: args.id,
        kind: args.kind,
        name: args.name,
        cellId: placement.cellId,
        placementEpoch: placement.placementEpoch,
        storageKey: `${args.kind}/${args.id}`,
      })),
      rename: async (args) => {
        const resource = await control.renameResource({
          resourceId: args.id, name: args.name,
        });
        return resource ? toCatalogResource(resource) : null;
      },
      updateProviderState: async (args) => {
        const current = await control.getResource(args.id);
        if (!current) return null;
        const resource = await control.updateResourceState({
          resourceId: args.id,
          expectedStatus: args.expectedStatus ?? current.status,
          status: args.status,
          lastError: args.lastError as TResourceDescriptor['lastError'],
        });
        return resource ? toCatalogResource(resource) : null;
      },
      beginDelete: async (args) => {
        const current = await control.getResource(args.id);
        if (!current) return null;
        const resource = await control.updateResourceState({
          resourceId: args.id,
          expectedStatus: current.status,
          status: 'deleting',
          lastError: null,
        });
        return resource ? toCatalogResource(resource) : null;
      },
      delete: (args) => control.deleteResource(args.id),
    },
    migration: {
      hasActiveWork: async (resourceId) => {
        const [activeDraft, ...activeApplyPages] = await Promise.all([
          db.dbResource.draft.getActive({ resourceId }),
          ...(['preparing', 'applying'] as const).map((status) => (
            db.dbResource.apply.list({ resourceId, status, limit: 1 })
          )),
        ]);
        return activeDraft !== null || activeApplyPages.some((page) => page.length > 0);
      },
    },
  };
}

/**
 * OSS in-process Resource Store. It is runtime-neutral at its provider and
 * manager boundaries; the optional consumer bridge is attached by composition.
 */
class ResourceService implements IService, IStartableService<object, object>, IStoppableService {
  readonly name = 'resource-store';
  readonly #placement: TResourcePlacementIdentity;
  readonly #dataRoot: string;
  readonly #controlStore: IResourceControlStore;
  readonly #crypto: Pick<Crypto, 'randomUUID'>;
  readonly #writeCapabilityVerifier: IResourceWriteCapabilityVerifier | undefined;
  readonly #writePermitCoordinator: IResourceWritePermitCoordinator | undefined;
  readonly #managementWriteCapability: string;
  readonly #manager: ResourceManager;
  readonly #kvResource: KvResource;
  readonly #secretStoreResource: SecretStoreResource;
  readonly #dbResource: DbResource;
  readonly #providers: readonly [
    ResourceManagementProvider,
    ResourceManagementProvider,
    ResourceManagementProvider,
  ];
  readonly #dbCoordinator: DbResourceCoordinator;
  #store: ResourceStoreService | null = null;
  #gateway: ResourceManagerGateway | null = null;
  #started = false;

  constructor(config: TResourceServiceConfig) {
    this.#placement = config.placement;
    this.#dataRoot = config.dataRoot;
    this.#controlStore = config.controlStore;
    this.#writeCapabilityVerifier = config.writeCapabilityVerifier;
    this.#writePermitCoordinator = config.writePermitCoordinator;
    const cryptoPortal = config.crypto ?? crypto;
    this.#crypto = cryptoPortal;
    this.#managementWriteCapability = cryptoPortal.randomUUID();
    const databaseFactory = config.databaseFactory
      ?? ((databasePath, options) => new Database(databasePath, options));
    const keyValueDatabaseFactory = databaseFactory as unknown as TResourceKeyValueDatabaseFactory;
    const secretStoreKeyProvider = new SecretStoreDatabaseKeyProvider({
      encryptionKeys: config.db.resourceEncryptionKey,
    });
    this.#kvResource = new KvResource(new ResourceKeyValueStore({
      dataRoot: config.dataRoot,
      kind: 'kv',
      databaseFactory: keyValueDatabaseFactory,
      maxOpenHandles: config.maxOpenHandles,
    }));
    this.#secretStoreResource = new SecretStoreResource(new ResourceKeyValueStore({
      dataRoot: config.dataRoot,
      kind: 'secretStore',
      secretStoreKeyProvider,
      databaseFactory: keyValueDatabaseFactory,
      maxOpenHandles: config.maxOpenHandles,
    }));
    this.#dbResource = new DbResource({
      db: config.db,
      dataRoot: config.dataRoot,
      databaseFactory,
      maxOpenHandles: config.maxOpenHandles,
    });
    const logicalProviders: readonly ILocalResourceProvider[] = [
      this.#kvResource,
      this.#secretStoreResource,
      this.#dbResource,
    ];
    this.#manager = new ResourceManager({
      store: createResourceManagerStore(config.placement, config.controlStore, config.db),
      crypto: cryptoPortal,
      providers: logicalProviders,
      closeProviders: false,
    });
    this.#dbCoordinator = new DbResourceCoordinator({
      controlStore: config.db as unknown as IDbResourceCoordinatorControlStore,
      resourceControlStore: config.controlStore,
      resourceManager: {
        getResource: (resourceId) => this.#manager.getResource(resourceId),
        listResources: async (filter) => [...await this.#manager.listResources(filter)],
        withReadyResource: (resourceId, operation) => this.#manager.withReadyResource(resourceId, operation),
        drainResource: (resourceId) => this.#manager.drainResource(resourceId),
        coordinateResourceApply: (resourceId, operation) => (
          this.#manager.coordinateResourceMigration(resourceId, operation)
        ),
        settleResourceMigration: (resourceId, settlement) => (
          this.#manager.settleResourceMigration(resourceId, settlement)
        ),
      },
      useCoordinator: config.useCoordinator,
      dbResource: this.#dbResource,
      crypto: cryptoPortal,
      onDiagnostic: (entry) => console.warn(`[resource] ${entry.code}: ${entry.message}`),
    });
    this.#providers = [
      new ResourceManagementProvider({
        provider: this.#kvResource,
        effects: RESOURCE_MANAGEMENT_EFFECTS.kv,
        dispatch: (resource, action, args) => (
          this.#dispatchKeyValueManagement(resource.id, 'kv', action, args)
        ),
      }),
      new ResourceManagementProvider({
        provider: this.#secretStoreResource,
        effects: RESOURCE_MANAGEMENT_EFFECTS.secretStore,
        dispatch: (resource, action, args) => (
          this.#dispatchKeyValueManagement(resource.id, 'secretStore', action, args)
        ),
      }),
      new ResourceManagementProvider({
        provider: this.#dbResource,
        effects: RESOURCE_MANAGEMENT_EFFECTS.db,
        dispatch: (resource, action, args) => (
          this.#dispatchDatabaseManagement(resource.id, action, args)
        ),
      }),
    ];
  }

  async start(_context: IServiceContext<object, object>): Promise<void> {
    if (this.#started) return;
    if (this.#store) {
      throw new ResourceError(
        'RESOURCE_LIFECYCLE_CONFLICT',
        'Resource Service provider cleanup is incomplete; retry shutdown before starting.',
      );
    }
    const store = new ResourceStoreService({
      controlStore: this.#controlStore,
      providers: this.#providers,
      placement: this.#placement,
      writeCapabilityVerifier: this.#writeCapabilityVerifier,
      writePermitCoordinator: this.#writePermitCoordinator,
      hostWriteCapability: this.#managementWriteCapability,
    });
    this.#store = store;
    try {
      await store.reconcile();
      await this.#dbCoordinator.reconcileStartup({
        isPlacementOwned: async (resource) => {
          const placement = await this.#controlStore.getPlacement(resource.id);
          return placement?.status === 'active'
            && placement.resourceId === resource.id
            && placement.cellId === this.#placement.cellId
            && placement.placementEpoch === this.#placement.placementEpoch;
        },
      });
      this.#gateway = new ResourceManagerGateway({
        manager: this.#manager,
        store,
      });
      this.#started = true;
    } catch (error) {
      try {
        await this.#closeRuntime();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Resource Service startup and cleanup failed.');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#started && !this.#store) return;
    this.#started = false;
    this.#gateway = null;
    await this.#closeRuntime();
  }

  async listResources(
    filter: { kind?: TResourceKind; status?: TResourceStatus } = {},
  ): Promise<readonly TResourceCatalogRecord[]> {
    return this.#manager.listResources(filter);
  }

  getResource(id: string) {
    return this.#manager.getResource(id);
  }

  resolveResourceByName(
    resourceName: string,
    options: { requireReady: boolean; kind?: TResourceKind },
  ) {
    return this.#manager.resolveResourceByName(resourceName, options);
  }

  async createResource(
    args: { kind: TResourceKind; name: string },
  ): Promise<TResourceCatalogRecord> {
    const resource = await this.#requireStore().createResource({
      id: this.#crypto.randomUUID(),
      kind: args.kind,
      name: args.name,
    });
    return toCatalogResource(resource);
  }

  async renameResource(args: { id: string; name: string }) {
    const resource = await this.#requireResource(args.id);
    return this.#managementCall<TResourceCatalogRecord>(
      resource.id,
      resource.kind,
      'renameResource',
      { name: args.name },
    );
  }

  async deleteResource(id: string): Promise<void> {
    const resource = await this.#requireResource(id);
    await this.#managementCall(resource.id, resource.kind, 'deleteResource', null);
  }

  callWithDirectBinding(
    call: TResourceManagerCall,
    binding: TResourceDirectBinding,
  ) {
    return this.#requireGateway().callWithDirectBinding(call, binding);
  }

  createFunctionResourceGateway(
    request: TFunctionResourceGatewayRequest,
  ): TFunctionResourceGatewayAccess {
    const requirements = new Map<string, TResourceRequirement>();
    for (const requirement of request.requirements) {
      if (requirements.has(requirement.slot)) {
        throw new ResourceError('RESOURCE_SCOPE_INVALID', 'Function resource slots must be unique.');
      }
      requirements.set(requirement.slot, requirement);
    }
    const retainedBindings = new Map(request.bindings.map((binding) => [binding.slot, binding]));
    const bindings: IResourceBindingResolver = Object.freeze({
      resolveBinding: async (slot: string) => {
        const binding = retainedBindings.get(slot) ?? null;
        return binding === null ? null : {
          slot: binding.slot,
          resourceId: binding.resourceId,
          kind: binding.kind,
          allowRead: binding.allowRead,
          allowWrite: binding.allowWrite,
          required: requirements.get(slot)?.required ?? false,
        };
      },
    });
    return Object.freeze({
      bindings,
      gateway: new ResourceGateway({
        store: this.#requireStore(),
        bindings,
        requirements: {
          resolveRequirement: async (slot: string) => requirements.get(slot) ?? null,
        },
      }),
    });
  }

  withReadyResource<T>(
    resourceId: string,
    operation: (resource: TResourceCatalogRecord) => Promise<T>,
  ): Promise<T> {
    return this.#manager.withReadyResource(resourceId, operation);
  }

  async countResourceData(
    args: { resourceId: string; prefix?: string; search?: string },
  ): Promise<number> {
    const resource = await this.#requireDataResource(args.resourceId);
    return this.#managementCall<number>(resource.id, resource.kind, 'countData', args);
  }

  async listResourceData(args: {
    resourceId: string;
    prefix?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }) {
    const resource = await this.#requireDataResource(args.resourceId);
    return this.#managementCall<ReturnType<typeof fnResourceDataPage>>(
      resource.id,
      resource.kind,
      'listData',
      args,
    );
  }

  async getResourceDataEntry(
    args: { resourceId: string; key: string },
  ): Promise<
    | {
        kind: 'kv';
        key: string;
        value: TResourceJson;
        revision: number;
        createdAtSec: string;
        updatedAtSec: string;
      }
    | {
        kind: 'secretStore';
        name: string;
        revision: number;
        createdAtSec: string;
        updatedAtSec: string;
      }
    | null
  > {
    const resource = await this.#requireDataResource(args.resourceId);
    return this.#managementCall(resource.id, resource.kind, 'getData', args);
  }

  async revealSecret(args: { resourceId: string; name: string }) {
    try {
      const resource = await this.#requireResource(args.resourceId);
      if (resource.kind !== 'secretStore') {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Resource is not a secret store.');
      }
      return await this.#managementCall<{
        kind: 'secretStore';
        name: string;
        value: string;
        revision: number;
      }>(resource.id, resource.kind, 'revealSecret', args);
    } catch (error) {
      if (
        error instanceof ResourceError
        && (error.code === 'RESOURCE_NOT_READY' || error.code === 'RESOURCE_MIGRATING')
      ) {
        throw new ResourceError('SECRET_STORE_UNAVAILABLE', 'Secret-store resource is unavailable.');
      }
      throw error;
    }
  }

  async setResourceDataEntry(args: {
    resourceId: string;
    key: string;
    expectedRevision: number | null;
    value: TResourceJson;
  }) {
    const resource = await this.#requireDataResource(args.resourceId);
    return this.#managementCall<ReturnType<typeof fnResourceDataMutationResult>>(
      resource.id,
      resource.kind,
      'setData',
      args,
    );
  }

  async deleteResourceDataEntry(args: {
    resourceId: string;
    key: string;
    expectedRevision: number;
  }): Promise<{ deleted: true }> {
    const resource = await this.#requireDataResource(args.resourceId);
    return this.#managementCall(resource.id, resource.kind, 'deleteData', args);
  }

  dbResourceImpact(resourceId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['impact']>>>(
      resourceId,
      'impact',
      { resourceId },
    );
  }

  inspectDbResource(
    args: { resourceId: string; target: 'live' | 'draft'; draftId?: string },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['inspect']>> | null>(
      args.resourceId,
      'inspect',
      args,
    );
  }

  executeDbLiveSql(args: {
    resourceId: string;
    sql: string;
    parameters?: readonly TDbCellValue[] | Readonly<Record<string, TDbCellValue>>;
    approved: boolean;
  }) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['executeLiveSql']>>>(
      args.resourceId,
      'executeLiveSql',
      args,
    );
  }

  listDbRows(
    args: { resourceId: string; object: string; cursor?: TDbRowIdentity | null; limit?: number },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['listRows']>>>(
      args.resourceId,
      'listRows',
      args,
    );
  }

  getDbRow(
    args: { resourceId: string; object: string; identity: TDbRowIdentity; columns?: readonly string[] },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['getRow']>>>(
      args.resourceId,
      'getRow',
      args,
    );
  }

  createDbRow(
    args: { resourceId: string; object: string; values: TDbRowCreate['values'] },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['createRow']>>>(
      args.resourceId,
      'createRow',
      args,
    );
  }

  updateDbRow(
    args: { resourceId: string; object: string } & Omit<TDbRowUpdate, 'kind'>,
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['updateRow']>>>(
      args.resourceId,
      'updateRow',
      args,
    );
  }

  deleteDbRow(
    args: { resourceId: string; object: string } & Omit<TDbRowDelete, 'kind'>,
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['deleteRow']>>>(
      args.resourceId,
      'deleteRow',
      args,
    );
  }

  bulkDbRows(args: {
    resourceId: string;
    object: string;
    operations: readonly (TDbRowCreate | TDbRowUpdate | TDbRowDelete)[];
  }) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['bulkRows']>>>(
      args.resourceId,
      'bulkRows',
      args,
    );
  }

  createDbDraft(resourceId: string, name: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['createDraft']>>>(
      resourceId,
      'createDraft',
      { resourceId, name },
    );
  }

  listDbDrafts(
    args: { resourceId: string; before?: { createdAtSec: string; id: string }; limit?: number },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['listDrafts']>>>(
      args.resourceId,
      'listDrafts',
      args,
    );
  }

  async getDbDraft(draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['getDraft']>>>(
      resourceId,
      'getDraft',
      { draftId },
    );
  }

  getActiveDbDraft(resourceId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['getActiveDraft']>>>(
      resourceId,
      'getActiveDraft',
      { resourceId },
    );
  }

  async changeDbDraft(draftId: string, operation: TDbDraftOperation) {
    const resourceId = await this.#resolveDraftResourceId(draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['changeDraft']>>>(
      resourceId,
      'changeDraft',
      { draftId, operation },
    );
  }

  async executeDbDraftSql(
    draftId: string,
    sql: string,
    parameters?: readonly TDbCellValue[],
  ) {
    const resourceId = await this.#resolveDraftResourceId(draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['executeDraftSql']>>>(
      resourceId,
      'executeDraftSql',
      { draftId, sql, parameters },
    );
  }

  async discardDbDraft(draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['discardDraft']>>>(
      resourceId,
      'discardDraft',
      { draftId },
    );
  }

  async previewDbApply(draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['previewApply']>>>(
      resourceId,
      'previewApply',
      { draftId },
    );
  }

  async confirmDbApply(draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['confirmApply']>>>(
      resourceId,
      'confirmApply',
      { draftId },
    );
  }

  async getDbApply(applyId: string) {
    const resourceId = await this.#resolveApplyResourceId(applyId);
    await this.#requirePlacedDbResource(resourceId);
    return this.#dbCoordinator.getApply(applyId);
  }

  listDbApplies(
    args: { resourceId: string; before?: { createdAtSec: string; id: string }; limit?: number },
  ) {
    return this.#requirePlacedDbResource(args.resourceId).then(() => (
      this.#dbCoordinator.listApplies(args)
    ));
  }

  getDbBackup(resourceId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['getBackup']>>>(
      resourceId,
      'getBackup',
      { resourceId },
    );
  }

  discardDbBackup(resourceId: string, applyId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['discardBackup']>>>(
      resourceId,
      'discardBackup',
      { resourceId, applyId },
    );
  }

  previewDbBackupRestore(resourceId: string, applyId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['previewRestore']>>>(
      resourceId,
      'previewRestore',
      { resourceId, applyId },
    );
  }

  restoreDbBackup(resourceId: string, applyId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['restore']>>>(
      resourceId,
      'restore',
      { resourceId, applyId },
    );
  }

  async getDbRestoreStatus(restoreId: string) {
    const resourceId = await this.#resolveApplyResourceId(restoreId);
    await this.#requirePlacedDbResource(resourceId);
    return this.#dbCoordinator.restoreStatus(restoreId);
  }

  async #dispatchKeyValueManagement(
    resourceId: string,
    kind: 'kv' | 'secretStore',
    action: string,
    rawArgs: unknown,
  ): Promise<unknown> {
    if (action === 'renameResource') {
      const args = rawArgs as { name: string };
      return this.#manager.renameResource({ id: resourceId, name: args.name });
    }
    if (action === 'deleteResource') {
      await this.#manager.deleteResource(resourceId);
      return undefined;
    }
    if (action === 'countData') {
      const args = rawArgs as { prefix?: string; search?: string };
      return kind === 'kv'
        ? this.#kvResource.countEntries({ resourceId, ...args })
        : this.#secretStoreResource.countEntries({ resourceId, ...args });
    }
    if (action === 'listData') {
      const args = rawArgs as { prefix?: string; search?: string; cursor?: string; limit?: number };
      const page = kind === 'kv'
        ? await this.#kvResource.listEntries({ resourceId, ...args })
        : await this.#secretStoreResource.listEntries({ resourceId, ...args });
      return fnResourceDataPage(kind, page);
    }
    if (action === 'getData') {
      const args = rawArgs as { key: string };
      if (kind === 'secretStore') {
        const entry = await this.#secretStoreResource.getEntryMetadata({ resourceId, name: args.key });
        return entry ? {
          kind,
          name: entry.key,
          revision: entry.revision,
          createdAtSec: entry.createdAtSec,
          updatedAtSec: entry.updatedAtSec,
        } : null;
      }
      const entry = await this.#kvResource.getEntry({ resourceId, key: args.key });
      return entry ? {
        kind,
        key: entry.key,
        value: entry.value,
        revision: entry.revision,
        createdAtSec: entry.createdAtSec,
        updatedAtSec: entry.updatedAtSec,
      } : null;
    }
    if (action === 'revealSecret') {
      if (kind !== 'secretStore') {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Resource is not a secret store.');
      }
      const args = rawArgs as { name: string };
      const entry = await this.#secretStoreResource.revealEntry({ resourceId, name: args.name });
      if (!entry) throw new ResourceError('SECRET_NOT_FOUND', 'Secret was not found.');
      return {
        kind: 'secretStore' as const,
        name: entry.key,
        value: entry.value,
        revision: entry.revision,
      };
    }
    if (action === 'setData') {
      const args = rawArgs as {
        key: string;
        expectedRevision: number | null;
        value: TResourceJson;
      };
      const result = kind === 'kv'
        ? await this.#kvResource.compareAndSetEntry({
            resourceId,
            key: args.key,
            expectedRevision: args.expectedRevision,
            value: args.value,
          })
        : await this.#secretStoreResource.compareAndSetEntry({
            resourceId,
            name: args.key,
            expectedRevision: args.expectedRevision,
            value: args.value,
          });
      if (!result.ok) {
        throw new ResourceError(
          kind === 'kv' ? 'KV_ENTRY_CONFLICT' : 'SECRET_CONFLICT',
          kind === 'kv'
            ? 'The value changed before it could be saved.'
            : 'The secret changed before it could be rotated.',
          { expectedRevision: result.expectedRevision, currentRevision: result.currentRevision },
        );
      }
      return fnResourceDataMutationResult(kind, result.entry);
    }
    if (action === 'deleteData') {
      const args = rawArgs as { key: string; expectedRevision: number };
      const result = kind === 'kv'
        ? await this.#kvResource.deleteEntry({ resourceId, key: args.key, expectedRevision: args.expectedRevision })
        : await this.#secretStoreResource.deleteEntry({ resourceId, name: args.key, expectedRevision: args.expectedRevision });
      if (!result.deleted) {
        const current = kind === 'kv'
          ? await this.#kvResource.getEntry({ resourceId, key: args.key })
          : await this.#secretStoreResource.getEntryMetadata({ resourceId, name: args.key });
        throw new ResourceError(
          kind === 'kv' ? 'KV_ENTRY_CONFLICT' : 'SECRET_CONFLICT',
          kind === 'kv'
            ? 'The value changed or was deleted before it could be removed.'
            : 'The secret changed or was deleted before it could be removed.',
          { expectedRevision: args.expectedRevision, currentRevision: current?.revision ?? null },
        );
      }
      return { deleted: true as const };
    }
    throw new ResourceError('RESOURCE_CALL_INVALID', 'Unknown resource data management operation.');
  }

  async #dispatchDatabaseManagement(
    resourceId: string,
    action: string,
    rawArgs: unknown,
  ): Promise<unknown> {
    if (action === 'renameResource') {
      const args = rawArgs as { name: string };
      return this.#manager.renameResource({ id: resourceId, name: args.name });
    }
    if (action === 'deleteResource') {
      await this.#manager.deleteResource(resourceId);
      return undefined;
    }
    if (action === 'impact') return this.#dbCoordinator.impact(resourceId);
    if (action === 'inspect') {
      const args = rawArgs as { target: 'live' | 'draft'; draftId?: string };
      if (args.target === 'draft') {
        const details = args.draftId
          ? await this.#dbCoordinator.getDraft(args.draftId)
          : await this.#dbCoordinator.getActiveDraft(resourceId);
        if (!details || details.draft.resourceId !== resourceId) return null;
        return this.#dbResource.inspect(resourceId, 'draft', details.draft.id);
      }
      return this.#dbResource.inspect(resourceId, 'live');
    }
    if (action === 'executeLiveSql') {
      return this.#dbResource.executeLiveSql(rawArgs as Parameters<DbResource['executeLiveSql']>[0]);
    }
    if (action === 'listRows') return this.#dbResource.listRows(rawArgs as Parameters<DbResource['listRows']>[0]);
    if (action === 'getRow') return this.#dbResource.getRow(rawArgs as Parameters<DbResource['getRow']>[0]);
    if (action === 'createRow') return this.#dbResource.createRow(rawArgs as Parameters<DbResource['createRow']>[0]);
    if (action === 'updateRow') return this.#dbResource.updateRow(rawArgs as Parameters<DbResource['updateRow']>[0]);
    if (action === 'deleteRow') return this.#dbResource.deleteRow(rawArgs as Parameters<DbResource['deleteRow']>[0]);
    if (action === 'bulkRows') return this.#dbResource.bulkRows(rawArgs as Parameters<DbResource['bulkRows']>[0]);
    if (action === 'createDraft') {
      const args = rawArgs as { name: string };
      return this.#dbCoordinator.createDraft(resourceId, args.name);
    }
    if (action === 'listDrafts') {
      return this.#dbCoordinator.listDrafts(rawArgs as Parameters<DbResourceCoordinator['listDrafts']>[0]);
    }
    if (action === 'getDraft') {
      const args = rawArgs as { draftId: string };
      return this.#dbCoordinator.getDraft(args.draftId);
    }
    if (action === 'getActiveDraft') return this.#dbCoordinator.getActiveDraft(resourceId);
    if (action === 'changeDraft') {
      const args = rawArgs as { draftId: string; operation: TDbDraftOperation };
      return this.#dbCoordinator.changeDraft(args.draftId, args.operation);
    }
    if (action === 'executeDraftSql') {
      const args = rawArgs as { draftId: string; sql: string; parameters?: readonly TDbCellValue[] };
      return this.#dbCoordinator.executeDraftSql(args.draftId, args.sql, args.parameters);
    }
    if (action === 'discardDraft') {
      return this.#dbCoordinator.discardDraft((rawArgs as { draftId: string }).draftId);
    }
    if (action === 'previewApply') {
      return this.#dbCoordinator.previewApply((rawArgs as { draftId: string }).draftId);
    }
    if (action === 'confirmApply') {
      return this.#dbCoordinator.confirmApply((rawArgs as { draftId: string }).draftId);
    }
    if (action === 'getApply') {
      return this.#dbCoordinator.getApply((rawArgs as { applyId: string }).applyId);
    }
    if (action === 'listApplies') {
      return this.#dbCoordinator.listApplies(rawArgs as Parameters<DbResourceCoordinator['listApplies']>[0]);
    }
    if (action === 'getBackup') return this.#dbCoordinator.getBackup(resourceId);
    if (action === 'discardBackup') {
      return this.#dbCoordinator.discardBackup(resourceId, (rawArgs as { applyId: string }).applyId);
    }
    if (action === 'previewRestore') {
      return this.#dbCoordinator.previewRestore(resourceId, (rawArgs as { applyId: string }).applyId);
    }
    if (action === 'restore') {
      return this.#dbCoordinator.restore(resourceId, (rawArgs as { applyId: string }).applyId);
    }
    if (action === 'restoreStatus') {
      return this.#dbCoordinator.restoreStatus((rawArgs as { restoreId: string }).restoreId);
    }
    throw new ResourceError('RESOURCE_CALL_INVALID', 'Unknown database management operation.');
  }

  #dbManagementCall<TOutput = unknown>(
    resourceId: string,
    action: string,
    args: unknown,
  ): Promise<TOutput> {
    return this.#requireDbResource(resourceId).then(() => (
      this.#managementCall<TOutput>(resourceId, 'db', action, args)
    ));
  }

  async #managementCall<TOutput = unknown>(
    resourceId: string,
    kind: TResourceKind,
    action: string,
    args: unknown,
  ): Promise<TOutput> {
    const effects = RESOURCE_MANAGEMENT_EFFECTS[kind] as Readonly<Record<string, 'read' | 'write'>>;
    const effect = effects[action];
    if (!effect) throw new ResourceError('RESOURCE_CALL_INVALID', 'Unknown resource management operation.');
    return this.#requireGateway().callResource({
      resourceId,
      kind,
      effect,
      operation: RESOURCE_MANAGEMENT_OPERATION,
      input: { action, args },
      ...(effect === 'write' ? { writeCapability: this.#managementWriteCapability } : {}),
    }) as Promise<TOutput>;
  }

  async #requireResource(resourceId: string): Promise<TResourceCatalogRecord> {
    const resource = await this.#manager.getResource(resourceId);
    if (!resource) throw new ResourceError('RESOURCE_NOT_FOUND', 'Resource was not found.');
    return resource;
  }

  async #requireDataResource(
    resourceId: string,
  ): Promise<TResourceCatalogRecord & { kind: 'kv' | 'secretStore' }> {
    const resource = await this.#requireResource(resourceId);
    if (resource.kind === 'db') {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Database rows use the database resource data API.');
    }
    return resource as TResourceCatalogRecord & { kind: 'kv' | 'secretStore' };
  }

  async #requireDbResource(resourceId: string): Promise<TResourceCatalogRecord> {
    const resource = await this.#requireResource(resourceId);
    if (resource.kind !== 'db') {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', `Resource '${resource.name}' is not a DbResource.`);
    }
    return resource;
  }

  async #requirePlacedDbResource(resourceId: string): Promise<TResourceCatalogRecord> {
    const resource = await this.#requireDbResource(resourceId);
    const placement = await this.#controlStore.getPlacement(resourceId);
    if (
      !placement
      || placement.cellId !== this.#placement.cellId
      || placement.placementEpoch !== this.#placement.placementEpoch
      || (placement.status !== 'active' && placement.status !== 'reserved')
    ) {
      throw new ResourceError(
        'RESOURCE_PLACEMENT_STALE',
        'Resource placement identity is stale for this process.',
      );
    }
    return resource;
  }

  async #resolveDraftResourceId(draftId: string): Promise<string> {
    const details = await this.#dbCoordinator.getDraft(draftId);
    return details.draft.resourceId;
  }

  async #resolveApplyResourceId(applyId: string): Promise<string> {
    const details = await this.#dbCoordinator.getApply(applyId);
    return details.apply.resourceId;
  }

  #requireStore(): ResourceStoreService {
    if (!this.#started || !this.#store) {
      throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', 'Resource Store is not running.');
    }
    return this.#store;
  }

  #requireGateway(): ResourceManagerGateway {
    if (!this.#started || !this.#gateway) {
      throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', 'Resource gateway is not running.');
    }
    return this.#gateway;
  }

  async #closeRuntime(): Promise<void> {
    // Quiesce and drain Store-admitted calls while their coordinator/manager
    // dependencies and physical providers are still available.
    const store = this.#store;
    store?.quiesce();
    await store?.drain();
    await this.#dbCoordinator.close();
    await this.#manager.close();
    if (store) {
      await store.close();
      if (this.#store === store) this.#store = null;
    }
  }
}

export { ResourceService };
export type {
  TFunctionResourceGatewayAccess,
  TFunctionResourceGatewayRequest,
  TResourcePlacementIdentity,
  TResourceServiceConfig,
};
