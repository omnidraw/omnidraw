import type { IService, IStartableService, IStoppableService } from '@omnidraw/runtime';
import type { IServiceContext } from '@omnidraw/runtime/interface.ts';
import {
  ResourceError,
  fnResourceSecretRevealAllowed,
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
  type TResourceJson,
  type TResourceDescriptor,
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
import type { TTenantDb } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso';
import { Database } from '@omnidraw/service-db/DbServiceTurso/turso-native';
import { fnResourceNameKey } from '@omnidraw/service-db/core/fn.resource-name';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { TWidgetResourceBindingInput } from '@omnidraw/widget-contract';
import {
  RESOURCE_MANAGEMENT_EFFECTS,
  RESOURCE_MANAGEMENT_OPERATION,
} from './CONSTANTS';
import { ResourceManagementProvider } from './ResourceManagementProvider';

type TResourceServiceConfig = Readonly<{
  tenant: TTenantContext;
  db: TTenantDb;
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
  definitionId: string;
  revisionId: string;
  requirements: readonly TResourceRequirement[];
  /** Exact retained Preview bindings; omitted for published revision lookup. */
  bindings?: readonly TWidgetResourceBindingInput[];
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
    last_error: resource.lastError as TResourceJson | null,
    created_at: new Date(resource.createdAtMs).toISOString(),
    updated_at: new Date(resource.updatedAtMs).toISOString(),
  };
}

function createResourceManagerStore(
  tenant: TTenantContext,
  control: IResourceControlStore,
  db: TTenantDb,
): IResourceManagerStore {
  const bindingRecord = (binding: Awaited<ReturnType<IResourceControlStore['listBindingsForResource']>>[number]) => ({
    definition_name: binding.definitionId,
    slot_name: binding.slot,
    resource_id: binding.resourceId,
    allow_read: binding.allowRead,
    allow_write: binding.allowWrite,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  });
  return {
    catalog: {
      list: async (filter) => (await control.listResources(tenant, filter)).map(toCatalogResource),
      get: async (args) => {
        const resource = await control.getResource(tenant, args.id);
        return resource ? toCatalogResource(resource) : null;
      },
      findByNameKey: async (args) => (await control.listResources(tenant))
        .filter((resource) => fnResourceNameKey(resource.name) === args.nameKey)
        .map(toCatalogResource),
      create: async (args) => toCatalogResource(await control.createResource(tenant, {
        id: args.id,
        kind: args.kind,
        name: args.name,
        cellId: tenant.cellId,
        placementEpoch: tenant.placementEpoch,
        storageKey: `${args.kind}/${args.id}`,
        nowMs: Date.now(),
      })),
      rename: async (args) => {
        const resource = await control.renameResource(tenant, {
          resourceId: args.id, name: args.name, nowMs: Date.now(),
        });
        return resource ? toCatalogResource(resource) : null;
      },
      updateProviderState: async (args) => {
        const current = await control.getResource(tenant, args.id);
        if (!current) return null;
        const resource = await control.updateResourceState(tenant, {
          resourceId: args.id,
          expectedStatus: current.status,
          status: args.status,
          lastError: args.lastError as TResourceDescriptor['lastError'],
          nowMs: Date.now(),
        });
        return resource ? toCatalogResource(resource) : null;
      },
      beginDelete: async (args) => {
        const current = await control.getResource(tenant, args.id);
        if (!current) return null;
        const resource = await control.updateResourceState(tenant, {
          resourceId: args.id,
          expectedStatus: current.status,
          status: 'deleting',
          lastError: null,
          nowMs: Date.now(),
        });
        return resource ? toCatalogResource(resource) : null;
      },
      delete: (args) => control.deleteResource(tenant, args.id),
      listBindingsForResource: async (args) => (
        await control.listBindingsForResource(tenant, args.resourceId)
      ).map(bindingRecord),
      listBindingsForDefinition: async () => [],
      upsertBinding: async () => { throw new ResourceError('RESOURCE_CALL_INVALID', 'Definition-name bindings were removed.'); },
      removeBinding: async () => false,
      replaceBindings: async () => { throw new ResourceError('RESOURCE_CALL_INVALID', 'Definition-name bindings were removed.'); },
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
  readonly #tenant: TTenantContext;
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
    this.#tenant = config.tenant;
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
      store: createResourceManagerStore(config.tenant, config.controlStore, config.db),
      crypto: cryptoPortal,
      resolveRequirements: () => null,
      providers: logicalProviders,
      closeProviders: false,
    });
    this.#dbCoordinator = new DbResourceCoordinator({
      tenant: config.tenant,
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
      },
      useCoordinator: config.useCoordinator,
      dbResource: this.#dbResource,
      crypto: cryptoPortal,
    });
    this.#providers = [
      new ResourceManagementProvider({
        provider: this.#kvResource,
        effects: RESOURCE_MANAGEMENT_EFFECTS.kv,
        dispatch: (tenant, resource, action, args) => (
          this.#dispatchKeyValueManagement(tenant, resource.id, 'kv', action, args)
        ),
      }),
      new ResourceManagementProvider({
        provider: this.#secretStoreResource,
        effects: RESOURCE_MANAGEMENT_EFFECTS.secretStore,
        dispatch: (tenant, resource, action, args) => (
          this.#dispatchKeyValueManagement(tenant, resource.id, 'secretStore', action, args)
        ),
      }),
      new ResourceManagementProvider({
        provider: this.#dbResource,
        effects: RESOURCE_MANAGEMENT_EFFECTS.db,
        dispatch: (tenant, resource, action, args) => (
          this.#dispatchDatabaseManagement(tenant, resource.id, action, args)
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
      writeCapabilityVerifier: this.#writeCapabilityVerifier,
      writePermitCoordinator: this.#writePermitCoordinator,
      hostWriteCapability: this.#managementWriteCapability,
      allowUnfencedWrites: false,
    });
    this.#store = store;
    try {
      await store.reconcile(this.#tenant);
      await this.#dbCoordinator.reconcileStartup({
        tenant: this.#tenant,
        isPlacementOwned: async (resource) => {
          const placement = await this.#controlStore.getPlacement(this.#tenant, resource.id);
          return placement?.status === 'active'
            && placement.orgId === this.#tenant.orgId
            && placement.resourceId === resource.id
            && placement.cellId === this.#tenant.cellId
            && placement.placementEpoch === this.#tenant.placementEpoch;
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
    tenant: TTenantContext,
    filter: { kind?: TResourceKind; status?: TResourceStatus } = {},
  ): Promise<readonly TResourceCatalogRecord[]> {
    this.#assertTenantPlacement(tenant);
    return this.#manager.listResources(filter);
  }

  getResource(tenant: TTenantContext, id: string) {
    this.#assertTenantPlacement(tenant);
    return this.#manager.getResource(id);
  }

  resolveResourceByName(
    tenant: TTenantContext,
    resourceName: string,
    options: { requireReady: boolean; kind?: TResourceKind },
  ) {
    this.#assertTenantPlacement(tenant);
    return this.#manager.resolveResourceByName(resourceName, options);
  }

  async createResource(
    tenant: TTenantContext,
    args: { kind: TResourceKind; name: string },
  ): Promise<TResourceCatalogRecord> {
    this.#assertTenantPlacement(tenant);
    const resource = await this.#requireStore().createResource(tenant, {
      id: this.#crypto.randomUUID(),
      kind: args.kind,
      name: args.name,
    });
    return toCatalogResource(resource);
  }

  async renameResource(tenant: TTenantContext, args: { id: string; name: string }) {
    const resource = await this.#requireResource(tenant, args.id);
    return this.#managementCall<TResourceCatalogRecord>(
      tenant,
      resource.id,
      resource.kind,
      'renameResource',
      { name: args.name },
    );
  }

  async deleteResource(tenant: TTenantContext, id: string): Promise<void> {
    const resource = await this.#requireResource(tenant, id);
    await this.#managementCall(tenant, resource.id, resource.kind, 'deleteResource', null);
  }

  async listResourceReferences(tenant: TTenantContext, resourceId: string) {
    this.#assertTenantPlacement(tenant);
    return this.#controlStore.listBindingsForResource(tenant, resourceId);
  }

  call(tenant: TTenantContext, call: TResourceManagerCall) {
    this.#assertTenantPlacement(tenant);
    return this.#requireGateway().call(tenant, call);
  }

  callWithDirectBinding(
    tenant: TTenantContext,
    call: TResourceManagerCall,
    binding: TResourceDirectBinding,
  ) {
    this.#assertTenantPlacement(tenant);
    return this.#requireGateway().callWithDirectBinding(tenant, call, binding);
  }

  createFunctionResourceGateway(
    tenant: TTenantContext,
    request: TFunctionResourceGatewayRequest,
  ): TFunctionResourceGatewayAccess {
    this.#assertTenantPlacement(tenant);
    const requirements = new Map<string, TResourceRequirement>();
    for (const requirement of request.requirements) {
      if (requirements.has(requirement.slot)) {
        throw new ResourceError('RESOURCE_SCOPE_INVALID', 'Function resource slots must be unique.');
      }
      requirements.set(requirement.slot, requirement);
    }
    const retainedBindings = request.bindings === undefined
      ? null
      : new Map(request.bindings.map((binding) => [binding.slot, binding]));
    const bindings: IResourceBindingResolver = Object.freeze({
      resolveBinding: async (callTenant: TTenantContext, slot: string) => {
        this.#assertTenantPlacement(callTenant);
        const binding = retainedBindings === null
          ? await this.#controlStore.resolveBinding(callTenant, {
              definitionId: request.definitionId,
              revisionId: request.revisionId,
              slot,
            })
          : retainedBindings.get(slot) ?? null;
        return binding === null ? null : {
          slot: binding.slot,
          resourceId: binding.resourceId,
          kind: binding.kind,
          allowRead: binding.allowRead,
          allowWrite: binding.allowWrite,
          definitionId: request.definitionId,
          revisionId: request.revisionId,
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
          resolveRequirement: async (callTenant, slot) => {
            this.#assertTenantPlacement(callTenant);
            return requirements.get(slot) ?? null;
          },
        },
      }),
    });
  }

  withReadyResource<T>(
    tenant: TTenantContext,
    resourceId: string,
    operation: (resource: TResourceDescriptor) => Promise<T>,
  ): Promise<T> {
    this.#assertTenantPlacement(tenant);
    return this.#manager.withReadyResource(resourceId, (resource) => operation({
      orgId: this.#tenant.orgId,
      id: resource.id,
      kind: resource.kind,
      name: resource.name,
      status: resource.status,
      lastError: resource.last_error as TResourceDescriptor['lastError'],
      createdAtMs: Date.parse(resource.created_at),
      updatedAtMs: Date.parse(resource.updated_at),
    }));
  }

  async countResourceData(
    tenant: TTenantContext,
    args: { resourceId: string; prefix?: string; search?: string },
  ): Promise<number> {
    const resource = await this.#requireDataResource(tenant, args.resourceId);
    return this.#managementCall<number>(tenant, resource.id, resource.kind, 'countData', args);
  }

  async listResourceData(tenant: TTenantContext, args: {
    resourceId: string;
    prefix?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }) {
    const resource = await this.#requireDataResource(tenant, args.resourceId);
    return this.#managementCall<ReturnType<typeof fnResourceDataPage>>(
      tenant,
      resource.id,
      resource.kind,
      'listData',
      args,
    );
  }

  async getResourceDataEntry(
    tenant: TTenantContext,
    args: { resourceId: string; key: string },
  ): Promise<
    | {
        kind: 'kv';
        key: string;
        value: TResourceJson;
        revision: number;
        createdAt: string;
        updatedAt: string;
      }
    | {
        kind: 'secretStore';
        name: string;
        revision: number;
        createdAt: string;
        updatedAt: string;
      }
    | null
  > {
    const resource = await this.#requireDataResource(tenant, args.resourceId);
    return this.#managementCall(tenant, resource.id, resource.kind, 'getData', args);
  }

  async revealSecret(tenant: TTenantContext, args: { resourceId: string; name: string }) {
    if (!fnResourceSecretRevealAllowed(tenant)) {
      throw new ResourceError(
        'RESOURCE_READ_NOT_ALLOWED',
        'Secret reveal requires an authorized human session.',
      );
    }
    try {
      const resource = await this.#requireResource(tenant, args.resourceId);
      if (resource.kind !== 'secretStore') {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Resource is not a secret store.');
      }
      return await this.#managementCall<{
        kind: 'secretStore';
        name: string;
        value: string;
        revision: number;
      }>(tenant, resource.id, resource.kind, 'revealSecret', args);
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

  async setResourceDataEntry(tenant: TTenantContext, args: {
    resourceId: string;
    key: string;
    expectedRevision: number | null;
    value: TResourceJson;
  }) {
    const resource = await this.#requireDataResource(tenant, args.resourceId);
    return this.#managementCall<ReturnType<typeof fnResourceDataMutationResult>>(
      tenant,
      resource.id,
      resource.kind,
      'setData',
      args,
    );
  }

  async deleteResourceDataEntry(tenant: TTenantContext, args: {
    resourceId: string;
    key: string;
    expectedRevision: number;
  }): Promise<{ deleted: true }> {
    const resource = await this.#requireDataResource(tenant, args.resourceId);
    return this.#managementCall(tenant, resource.id, resource.kind, 'deleteData', args);
  }

  dbResourceImpact(tenant: TTenantContext, resourceId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['impact']>>>(
      tenant,
      resourceId,
      'impact',
      { resourceId },
    );
  }

  inspectDbResource(
    tenant: TTenantContext,
    args: { resourceId: string; target: 'live' | 'draft'; draftId?: string },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['inspect']>> | null>(
      tenant,
      args.resourceId,
      'inspect',
      args,
    );
  }

  executeDbLiveSql(tenant: TTenantContext, args: {
    resourceId: string;
    sql: string;
    parameters?: readonly TDbCellValue[] | Readonly<Record<string, TDbCellValue>>;
    approved: boolean;
  }) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['executeLiveSql']>>>(
      tenant,
      args.resourceId,
      'executeLiveSql',
      args,
    );
  }

  listDbRows(
    tenant: TTenantContext,
    args: { resourceId: string; object: string; cursor?: TDbRowIdentity | null; limit?: number },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['listRows']>>>(
      tenant,
      args.resourceId,
      'listRows',
      args,
    );
  }

  getDbRow(
    tenant: TTenantContext,
    args: { resourceId: string; object: string; identity: TDbRowIdentity; columns?: readonly string[] },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['getRow']>>>(
      tenant,
      args.resourceId,
      'getRow',
      args,
    );
  }

  createDbRow(
    tenant: TTenantContext,
    args: { resourceId: string; object: string; values: TDbRowCreate['values'] },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['createRow']>>>(
      tenant,
      args.resourceId,
      'createRow',
      args,
    );
  }

  updateDbRow(
    tenant: TTenantContext,
    args: { resourceId: string; object: string } & Omit<TDbRowUpdate, 'kind'>,
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['updateRow']>>>(
      tenant,
      args.resourceId,
      'updateRow',
      args,
    );
  }

  deleteDbRow(
    tenant: TTenantContext,
    args: { resourceId: string; object: string } & Omit<TDbRowDelete, 'kind'>,
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['deleteRow']>>>(
      tenant,
      args.resourceId,
      'deleteRow',
      args,
    );
  }

  bulkDbRows(tenant: TTenantContext, args: {
    resourceId: string;
    object: string;
    operations: readonly (TDbRowCreate | TDbRowUpdate | TDbRowDelete)[];
  }) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResource['bulkRows']>>>(
      tenant,
      args.resourceId,
      'bulkRows',
      args,
    );
  }

  createDbDraft(tenant: TTenantContext, resourceId: string, name: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['createDraft']>>>(
      tenant,
      resourceId,
      'createDraft',
      { resourceId, name },
    );
  }

  listDbDrafts(
    tenant: TTenantContext,
    args: { resourceId: string; before?: { createdAt: string; id: string }; limit?: number },
  ) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['listDrafts']>>>(
      tenant,
      args.resourceId,
      'listDrafts',
      args,
    );
  }

  async getDbDraft(tenant: TTenantContext, draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(tenant, draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['getDraft']>>>(
      tenant,
      resourceId,
      'getDraft',
      { draftId },
    );
  }

  getActiveDbDraft(tenant: TTenantContext, resourceId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['getActiveDraft']>>>(
      tenant,
      resourceId,
      'getActiveDraft',
      { resourceId },
    );
  }

  async changeDbDraft(tenant: TTenantContext, draftId: string, operation: TDbDraftOperation) {
    const resourceId = await this.#resolveDraftResourceId(tenant, draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['changeDraft']>>>(
      tenant,
      resourceId,
      'changeDraft',
      { draftId, operation },
    );
  }

  async executeDbDraftSql(
    tenant: TTenantContext,
    draftId: string,
    sql: string,
    parameters?: readonly TDbCellValue[],
  ) {
    const resourceId = await this.#resolveDraftResourceId(tenant, draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['executeDraftSql']>>>(
      tenant,
      resourceId,
      'executeDraftSql',
      { draftId, sql, parameters },
    );
  }

  async discardDbDraft(tenant: TTenantContext, draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(tenant, draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['discardDraft']>>>(
      tenant,
      resourceId,
      'discardDraft',
      { draftId },
    );
  }

  async previewDbApply(tenant: TTenantContext, draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(tenant, draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['previewApply']>>>(
      tenant,
      resourceId,
      'previewApply',
      { draftId },
    );
  }

  async confirmDbApply(tenant: TTenantContext, draftId: string) {
    const resourceId = await this.#resolveDraftResourceId(tenant, draftId);
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['confirmApply']>>>(
      tenant,
      resourceId,
      'confirmApply',
      { draftId },
    );
  }

  async getDbApply(tenant: TTenantContext, applyId: string) {
    const resourceId = await this.#resolveApplyResourceId(tenant, applyId);
    await this.#requireOwnedDbLifecycleResource(tenant, resourceId);
    return this.#dbCoordinator.getApply(applyId);
  }

  listDbApplies(
    tenant: TTenantContext,
    args: { resourceId: string; before?: { createdAt: string; id: string }; limit?: number },
  ) {
    return this.#requireOwnedDbLifecycleResource(tenant, args.resourceId).then(() => (
      this.#dbCoordinator.listApplies(args)
    ));
  }

  getDbBackup(tenant: TTenantContext, resourceId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['getBackup']>>>(
      tenant,
      resourceId,
      'getBackup',
      { resourceId },
    );
  }

  discardDbBackup(tenant: TTenantContext, resourceId: string, applyId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['discardBackup']>>>(
      tenant,
      resourceId,
      'discardBackup',
      { resourceId, applyId },
    );
  }

  previewDbBackupRestore(tenant: TTenantContext, resourceId: string, applyId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['previewRestore']>>>(
      tenant,
      resourceId,
      'previewRestore',
      { resourceId, applyId },
    );
  }

  restoreDbBackup(tenant: TTenantContext, resourceId: string, applyId: string) {
    return this.#dbManagementCall<Awaited<ReturnType<DbResourceCoordinator['restore']>>>(
      tenant,
      resourceId,
      'restore',
      { resourceId, applyId },
    );
  }

  async getDbRestoreStatus(tenant: TTenantContext, restoreId: string) {
    const resourceId = await this.#resolveApplyResourceId(tenant, restoreId);
    await this.#requireOwnedDbLifecycleResource(tenant, resourceId);
    return this.#dbCoordinator.restoreStatus(restoreId);
  }

  async #dispatchKeyValueManagement(
    tenant: TTenantContext,
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
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        } : null;
      }
      const entry = await this.#kvResource.getEntry({ resourceId, key: args.key });
      return entry ? {
        kind,
        key: entry.key,
        value: entry.value,
        revision: entry.revision,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      } : null;
    }
    if (action === 'revealSecret') {
      if (kind !== 'secretStore') {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Resource is not a secret store.');
      }
      if (!fnResourceSecretRevealAllowed(tenant)) {
        throw new ResourceError(
          'RESOURCE_READ_NOT_ALLOWED',
          'Secret reveal requires an authorized human session.',
        );
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
    tenant: TTenantContext,
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
    if (action === 'impact') return this.#dbCoordinator.impact(tenant, resourceId);
    if (action === 'inspect') {
      const args = rawArgs as { target: 'live' | 'draft'; draftId?: string };
      if (args.target === 'draft') {
        const details = args.draftId
          ? await this.#dbCoordinator.getDraft(args.draftId)
          : await this.#dbCoordinator.getActiveDraft(resourceId);
        if (!details || details.draft.resource_id !== resourceId) return null;
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
      return this.#dbCoordinator.previewApply(tenant, (rawArgs as { draftId: string }).draftId);
    }
    if (action === 'confirmApply') {
      return this.#dbCoordinator.confirmApply(tenant, (rawArgs as { draftId: string }).draftId);
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
      return this.#dbCoordinator.previewRestore(tenant, resourceId, (rawArgs as { applyId: string }).applyId);
    }
    if (action === 'restore') {
      return this.#dbCoordinator.restore(tenant, resourceId, (rawArgs as { applyId: string }).applyId);
    }
    if (action === 'restoreStatus') {
      return this.#dbCoordinator.restoreStatus((rawArgs as { restoreId: string }).restoreId);
    }
    throw new ResourceError('RESOURCE_CALL_INVALID', 'Unknown database management operation.');
  }

  #dbManagementCall<TOutput = unknown>(
    tenant: TTenantContext,
    resourceId: string,
    action: string,
    args: unknown,
  ): Promise<TOutput> {
    return this.#requireDbResource(tenant, resourceId).then(() => (
      this.#managementCall<TOutput>(tenant, resourceId, 'db', action, args)
    ));
  }

  async #managementCall<TOutput = unknown>(
    tenant: TTenantContext,
    resourceId: string,
    kind: TResourceKind,
    action: string,
    args: unknown,
  ): Promise<TOutput> {
    this.#assertTenantPlacement(tenant);
    const effects = RESOURCE_MANAGEMENT_EFFECTS[kind] as Readonly<Record<string, 'read' | 'write'>>;
    const effect = effects[action];
    if (!effect) throw new ResourceError('RESOURCE_CALL_INVALID', 'Unknown resource management operation.');
    return this.#requireGateway().callResource(tenant, {
      resourceId,
      kind,
      effect,
      operation: RESOURCE_MANAGEMENT_OPERATION,
      input: { action, args },
      ...(effect === 'write' ? { writeCapability: this.#managementWriteCapability } : {}),
    }) as Promise<TOutput>;
  }

  async #requireResource(tenant: TTenantContext, resourceId: string): Promise<TResourceCatalogRecord> {
    this.#assertTenantPlacement(tenant);
    const resource = await this.#manager.getResource(resourceId);
    if (!resource) throw new ResourceError('RESOURCE_NOT_FOUND', 'Resource was not found.');
    return resource;
  }

  async #requireDataResource(
    tenant: TTenantContext,
    resourceId: string,
  ): Promise<TResourceCatalogRecord & { kind: 'kv' | 'secretStore' }> {
    const resource = await this.#requireResource(tenant, resourceId);
    if (resource.kind === 'db') {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Database rows use the database resource data API.');
    }
    return resource as TResourceCatalogRecord & { kind: 'kv' | 'secretStore' };
  }

  async #requireDbResource(tenant: TTenantContext, resourceId: string): Promise<TResourceCatalogRecord> {
    const resource = await this.#requireResource(tenant, resourceId);
    if (resource.kind !== 'db') {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', `Resource '${resource.name}' is not a DbResource.`);
    }
    return resource;
  }

  async #requireOwnedDbLifecycleResource(
    tenant: TTenantContext,
    resourceId: string,
  ): Promise<TResourceCatalogRecord> {
    this.#requireStore();
    const resource = await this.#requireDbResource(tenant, resourceId);
    const [ownedResource, placement] = await Promise.all([
      this.#controlStore.getResource(tenant, resourceId),
      this.#controlStore.getPlacement(tenant, resourceId),
    ]);
    if (!ownedResource || !placement) {
      throw new ResourceError('RESOURCE_NOT_FOUND', 'Resource was not found.');
    }
    if (
      ownedResource.orgId !== tenant.orgId
      || ownedResource.id !== resourceId
      || placement.orgId !== tenant.orgId
      || placement.resourceId !== resourceId
      || placement.status !== 'active'
      || placement.cellId !== tenant.cellId
      || placement.placementEpoch !== tenant.placementEpoch
    ) {
      throw new ResourceError(
        'RESOURCE_PLACEMENT_STALE',
        'Resource catalog or placement identity is stale for this cell.',
      );
    }
    return resource;
  }

  async #resolveDraftResourceId(tenant: TTenantContext, draftId: string): Promise<string> {
    this.#assertTenantPlacement(tenant);
    const details = await this.#dbCoordinator.getDraft(draftId);
    return details.draft.resource_id;
  }

  async #resolveApplyResourceId(tenant: TTenantContext, applyId: string): Promise<string> {
    this.#assertTenantPlacement(tenant);
    const details = await this.#dbCoordinator.getApply(applyId);
    return details.apply.resource_id;
  }

  #assertTenantPlacement(tenant: TTenantContext): void {
    if (
      tenant.orgId !== this.#tenant.orgId
      || tenant.cellId !== this.#tenant.cellId
      || tenant.placementEpoch !== this.#tenant.placementEpoch
    ) {
      throw new ResourceError('RESOURCE_PLACEMENT_STALE', 'Resource service placement is stale.');
    }
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
  TResourceServiceConfig,
};
