import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type {
  TResourceDrainLease,
  TResourceDrainRequest,
  TResourceDrainResult,
  TResourceReleaseMode,
  TResourceReleaseResult,
  TResourceUse,
  TResourceUseInspection,
} from '@vibecanvas/resource-runtime';
import { claimResourceOwner, type ResourceOwnerLease } from '@vibecanvas/resource-runtime/local';
import type { TTenantDb } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative as relativePath } from 'node:path';
import { ActorSupervisor } from './ActorSupervisor';
import { txGetWidgetCode } from './core/tx.actor-definitions';
import type { TVibecanvasJson } from './core/types';
import type { Actor, TActorEvent } from './Actor';
import { ActorResourceManager, type TBindResourceArgs, type TCreateResourceArgs, type TReplaceResourceBindingsArgs } from './resources/ActorResourceManager';
import type { TActorResourceKind, TActorResourceStatus, TJson } from '@vibecanvas/service-db/model';
import { DbResource, type TDatabaseFactory } from './resources/DbResource';
import { KvResource } from './resources/KvResource';
import { SecretStoreResource } from './resources/SecretStoreResource';
import { ActorResourceKeyValueStore, type TActorResourceKeyValueDatabaseFactory } from './resources/ActorResourceKeyValueStore';
import type { ISecretStoreKeyProvider } from './resources/SecretStoreKeyProvider';
import { DbResourceCoordinator } from './resources/DbResourceCoordinator';
import type { TActorResourceCall, TActorResourceDataMutationResult, TActorResourceDataPage, TActorResourceDirectBinding, TDbCellValue, TDbDraftOperation, TDbRowCreate, TDbRowDelete, TDbRowIdentity, TDbRowUpdate } from './resources/resource-types';
import { ActorResourceError } from './resources/ActorResourceError';
import { fnActorResourceDataMutationResult, fnActorResourceDataPage } from './resources/fn.resource-data';

function resolveManifestPath(configPath: string, manifestPath: string): string {
  return isAbsolute(manifestPath) ? manifestPath : join(configPath, manifestPath)
}

interface IPublicMethods {
  sendMessage(instanceId: string, msgName: string, msgPayload: any): Promise<string>
  listenToActorEvents(instanceId: string, cb: (event: TActorEvent) => void): (() => void) | null
  createInstance(defId: string, canvasId: string, elementId: string): Promise<Actor | null>
  removeInstance(instanceId: string): Promise<void>
  deleteDefinition(defName: string): Promise<boolean>
  getVibecanvasJson(defId: string): TVibecanvasJson | null;
  getWidgetCode(defId: string): Promise<{content: string, path: string}[] | null>
  reload(): Promise<void>
  reloadDefinitionInstances(defName: string): Promise<void>
  transitionDefinitionPublication(args: TReplaceResourceBindingsArgs & { reloadInstances: boolean }): Promise<void>
  callWithDirectResourceBinding(call: TActorResourceCall, binding: TActorResourceDirectBinding): Promise<unknown>
}

export interface IActorServiceConfig {
  db: TTenantDb;
  configPath: string;
  /** @deprecated Legacy/test-only storage root. Production injects resourceService. */
  dataRoot?: string;
  /** @deprecated Legacy/test-only owner label for the dataRoot ownership fence. */
  resourceOwnerId?: string;
  crypto?: Pick<Crypto, 'randomUUID'>;
  /** @deprecated Legacy/test-only provider injection. Production injects resourceService. */
  dbResourceDatabaseFactory?: TDatabaseFactory;
  /** @deprecated Legacy/test-only provider injection. Production injects resourceService. */
  actorResourceKeyValueDatabaseFactory?: TActorResourceKeyValueDatabaseFactory;
  /** @deprecated Legacy/test-only provider setting. Production injects resourceService. */
  actorResourceKeyValueMaxOpenHandles?: number;
  /** @deprecated Legacy/test-only key provider. Production injects resourceService. */
  secretStoreKeyProvider?: ISecretStoreKeyProvider;
  resourceService?: IActorResourceService;
  eventPublisherService: ITenantEventPublisherService,
}

type TActorResourceManagerFacade = Pick<ActorResourceManager,
  | 'bindResource'
  | 'call'
  | 'callWithDirectBinding'
  | 'completeActorStart'
  | 'createResource'
  | 'deleteResource'
  | 'getActorStartAdmission'
  | 'getDefinitionResourceStatus'
  | 'getResource'
  | 'listResourceBindingsForDefinition'
  | 'listResourceReferences'
  | 'listResources'
  | 'renameResource'
  | 'replaceResourceBindings'
  | 'resolveResourceByName'
  | 'transitionResourceBindings'
  | 'unbindResource'
  | 'withReadyResource'
>;

type TKvResourceFacade = Pick<KvResource,
  | 'compareAndSetEntry'
  | 'countEntries'
  | 'deleteEntry'
  | 'getEntry'
  | 'listEntries'
>;

type TSecretStoreResourceFacade = Pick<SecretStoreResource,
  | 'compareAndSetEntry'
  | 'countEntries'
  | 'deleteEntry'
  | 'getEntryMetadata'
  | 'listEntries'
>;

type TDbResourceFacade = Pick<DbResource,
  | 'bulkRows'
  | 'createRow'
  | 'deleteRow'
  | 'executeLiveSql'
  | 'getRow'
  | 'inspect'
  | 'listRows'
  | 'updateRow'
>;

type TDbResourceCoordinatorFacade = Pick<DbResourceCoordinator,
  | 'changeDraft'
  | 'createDraft'
  | 'discardBackup'
  | 'discardDraft'
  | 'executeDraftSql'
  | 'getActiveDraft'
  | 'getApply'
  | 'getBackup'
  | 'getDraft'
  | 'listApplies'
  | 'listDrafts'
  | 'restoreStatus'
> & Readonly<{
  impact(resourceId: string): ReturnType<DbResourceCoordinator['impact']>;
  previewApply(draftId: string): ReturnType<DbResourceCoordinator['previewApply']>;
  confirmApply(draftId: string): ReturnType<DbResourceCoordinator['confirmApply']>;
  previewRestore(
    resourceId: string,
    applyId: string,
  ): ReturnType<DbResourceCoordinator['previewRestore']>;
  restore(
    resourceId: string,
    applyId: string,
  ): ReturnType<DbResourceCoordinator['restore']>;
}>;

type TActorHighLevelResourceFacade = Readonly<{
  countResourceData(args: { resourceId: string; prefix?: string; search?: string }): Promise<number>;
  listResourceData(args: {
    resourceId: string;
    prefix?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }): Promise<TActorResourceDataPage>;
  getResourceDataEntry(args: { resourceId: string; key: string }): Promise<
    | { kind: 'kv'; key: string; value: TJson; revision: number; createdAt: string; updatedAt: string }
    | { kind: 'secretStore'; name: string; revision: number; createdAt: string; updatedAt: string }
    | null
  >;
  setResourceDataEntry(args: {
    resourceId: string;
    key: string;
    expectedRevision: number | null;
    value: TJson;
  }): Promise<TActorResourceDataMutationResult>;
  deleteResourceDataEntry(args: {
    resourceId: string;
    key: string;
    expectedRevision: number;
  }): Promise<{ deleted: true }>;
  dbResourceImpact: TDbResourceCoordinatorFacade['impact'];
  inspectDbResource(args: {
    resourceId: string;
    target: 'live' | 'draft';
    draftId?: string;
  }): Promise<Awaited<ReturnType<TDbResourceFacade['inspect']>> | null>;
  listDbRows: TDbResourceFacade['listRows'];
  getDbRow: TDbResourceFacade['getRow'];
  executeDbLiveSql: TDbResourceFacade['executeLiveSql'];
  createDbRow: TDbResourceFacade['createRow'];
  updateDbRow: TDbResourceFacade['updateRow'];
  deleteDbRow: TDbResourceFacade['deleteRow'];
  bulkDbRows: TDbResourceFacade['bulkRows'];
  createDbDraft: TDbResourceCoordinatorFacade['createDraft'];
  listDbDrafts: TDbResourceCoordinatorFacade['listDrafts'];
  getDbDraft: TDbResourceCoordinatorFacade['getDraft'];
  getActiveDbDraft: TDbResourceCoordinatorFacade['getActiveDraft'];
  changeDbDraft: TDbResourceCoordinatorFacade['changeDraft'];
  executeDbDraftSql: TDbResourceCoordinatorFacade['executeDraftSql'];
  discardDbDraft: TDbResourceCoordinatorFacade['discardDraft'];
  previewDbApply: TDbResourceCoordinatorFacade['previewApply'];
  confirmDbApply: TDbResourceCoordinatorFacade['confirmApply'];
  getDbApply: TDbResourceCoordinatorFacade['getApply'];
  listDbApplies: TDbResourceCoordinatorFacade['listApplies'];
  getDbBackup: TDbResourceCoordinatorFacade['getBackup'];
  discardDbBackup: TDbResourceCoordinatorFacade['discardBackup'];
  previewDbBackupRestore: TDbResourceCoordinatorFacade['previewRestore'];
  restoreDbBackup: TDbResourceCoordinatorFacade['restore'];
  getDbRestoreStatus: TDbResourceCoordinatorFacade['restoreStatus'];
  callWithDirectResourceBinding(
    call: TActorResourceCall,
    binding: TActorResourceDirectBinding,
  ): Promise<unknown>;
}>;

/** High-level compatibility surface implemented by the actor-independent Resource Service. */
export type IActorResourceService = TActorResourceManagerFacade
  & TActorHighLevelResourceFacade
  & Readonly<{
    attachConsumer?(consumer: Pick<ActorService, 'getVibecanvasJson'>): (() => void) | void;
  }>;

export class ActorService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'actor-service'
  #config: IActorServiceConfig
  #supervisor: ActorSupervisor
  #sharedResourceService: IActorResourceService | null = null
  #resourceManager: TActorResourceManagerFacade | null = null
  #kvResource: TKvResourceFacade | null = null
  #secretStoreResource: TSecretStoreResourceFacade | null = null
  #dbResource: TDbResourceFacade | null = null
  #dbResourceCoordinator: TDbResourceCoordinatorFacade | null = null
  #ownedResourceManager: ActorResourceManager | null = null
  #ownedDbResourceCoordinator: DbResourceCoordinator | null = null
  #legacyResourceRoot: string | null = null
  #legacyResourceOwnerId: string | null = null
  #legacyResourceOwnerLease: ResourceOwnerLease | null = null
  #resourceConsumerDetach: (() => void) | null = null
  readonly #stopCleanups = new Set<() => void>()
  #resourceUseLeaseEpoch = 0

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#supervisor = new ActorSupervisor({
      absWidgetDir: join(config.configPath, 'widgets'),
      configPath: config.configPath,
      crypto: config.crypto ?? crypto,
      db: config.db,
      eventPublisherService: config.eventPublisherService,
      resourceGateway: (call) => this.#callResource(call),
      actorStartAdmission: (args) => this.#getActorStartAdmission(args),
      actorStartCompleted: (args) => this.#completeActorStart(args),
    })
    if (config.resourceService) {
      this.#sharedResourceService = config.resourceService
      this.#resourceConsumerDetach = config.resourceService.attachConsumer?.(this) ?? null
      return
    }

    if (!config.dataRoot || !config.secretStoreKeyProvider) {
      throw new Error('ActorService requires either a shared resourceService or legacy resource storage configuration.')
    }
    const kvResource = new KvResource(new ActorResourceKeyValueStore({
      dataRoot: config.dataRoot,
      kind: 'kv',
      databaseFactory: config.actorResourceKeyValueDatabaseFactory,
      maxOpenHandles: config.actorResourceKeyValueMaxOpenHandles,
    }))
    const secretStoreResource = new SecretStoreResource(new ActorResourceKeyValueStore({
      dataRoot: config.dataRoot,
      kind: 'secretStore',
      secretStoreKeyProvider: config.secretStoreKeyProvider,
      databaseFactory: config.actorResourceKeyValueDatabaseFactory,
      maxOpenHandles: config.actorResourceKeyValueMaxOpenHandles,
    }))
    const dbResource = new DbResource({
      db: config.db,
      dataRoot: config.dataRoot,
      databaseFactory: config.dbResourceDatabaseFactory,
    })
    const resourceManager = new ActorResourceManager({
      db: config.db,
      crypto: config.crypto ?? crypto,
      getDefinition: (definitionName) => this.#supervisor.vibecanvasDefMap[definitionName] ?? null,
      providers: [kvResource, secretStoreResource, dbResource],
    })
    const dbResourceCoordinator = new DbResourceCoordinator({
      db: config.db,
      resourceManager,
      supervisor: this.#supervisor,
      dbResource,
      crypto: config.crypto ?? crypto,
    })
    this.#resourceManager = resourceManager
    this.#kvResource = kvResource
    this.#secretStoreResource = secretStoreResource
    this.#dbResource = dbResource
    this.#dbResourceCoordinator = dbResourceCoordinator
    this.#ownedResourceManager = resourceManager
    this.#ownedDbResourceCoordinator = dbResourceCoordinator
    this.#legacyResourceRoot = config.dataRoot
    this.#legacyResourceOwnerId = config.resourceOwnerId ?? 'legacy-actor-resource-store'
  }

  callWithDirectResourceBinding(call: TActorResourceCall, binding: TActorResourceDirectBinding): Promise<unknown> {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.callWithDirectResourceBinding(call, binding)
    }
    return this.#resourceManager!.callWithDirectBinding(call, binding)
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    void ctx
    console.log('start', this.name)
    if (this.#ownedResourceManager && !this.#legacyResourceOwnerLease) {
      this.#legacyResourceOwnerLease = await claimResourceOwner({
        root: this.#legacyResourceRoot!,
        ownerId: this.#legacyResourceOwnerId!,
      })
    }
    try {
      await this.#ownedResourceManager?.reconcileStartup()
      await this.#clearObsoleteDbResourceErrors()
      await this.#ownedDbResourceCoordinator?.reconcileStartup()
      await this.#supervisor.init()
    } catch (error) {
      const cleanupFailures: unknown[] = []
      try {
        await this.#supervisor.closeActors()
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError)
      }
      let resourcesClosed = true
      try {
        await this.#closeOwnedResources()
      } catch (cleanupError) {
        resourcesClosed = false
        cleanupFailures.push(cleanupError)
      }
      if (resourcesClosed) {
        const lease = this.#legacyResourceOwnerLease
        if (lease) {
          try {
            await lease.release()
            this.#legacyResourceOwnerLease = null
          } catch (cleanupError) {
            cleanupFailures.push(cleanupError)
          }
        }
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError([error, ...cleanupFailures], 'ActorService startup and resource cleanup failed.')
      }
      throw error
    }
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
    let failure: unknown = null
    const run = async (operation: (() => void | Promise<void>) | undefined): Promise<void> => {
      if (!operation) return
      try {
        await operation()
      } catch (error) {
        failure ??= error
      }
    }
    await run(() => this.#supervisor.closeActors())
    let ownedResourceCloseFailed = false
    if (this.#ownedResourceManager || this.#ownedDbResourceCoordinator) {
      try {
        await this.#closeOwnedResources()
      } catch (error) {
        ownedResourceCloseFailed = true
        failure ??= error
      }
    }
    if (!ownedResourceCloseFailed && this.#legacyResourceOwnerLease) {
      const lease = this.#legacyResourceOwnerLease
      try {
        await lease.release()
        this.#legacyResourceOwnerLease = null
      } catch (error) {
        failure ??= error
      }
    }

    const resourceConsumerDetach = this.#resourceConsumerDetach
    this.#resourceConsumerDetach = null
    await run(resourceConsumerDetach ?? undefined)
    const stopCleanups = [...this.#stopCleanups]
    this.#stopCleanups.clear()
    for (const cleanup of stopCleanups) await run(cleanup)
    if (failure !== null) throw failure
  }

  addStopCleanup(cleanup: () => void): void {
    this.#stopCleanups.add(cleanup)
  }

  async reload(): Promise<void> {
    await this.#supervisor.reload()
  }

  async reloadDefinitionInstances(defName: string): Promise<void> {
    await this.#supervisor.reloadDefinitionInstances(defName)
  }

  async transitionDefinitionPublication(
    args: TReplaceResourceBindingsArgs & { reloadInstances: boolean },
  ): Promise<void> {
    let bindingReplacementCommitted = false
    try {
      const resources = this.#sharedResourceService ?? this.#resourceManager!
      await resources.transitionResourceBindings(args, async () => {
        await this.#supervisor.closeDefinitionActors(args.definitionName)
        await this.#supervisor.reloadDefinitionsOnly()
      })
      bindingReplacementCommitted = true
      await this.#supervisor.completeDefinitionPublication(args.definitionName, args.reloadInstances)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      Object.assign(failure, { bindingReplacementCommitted })
      throw failure
    }
  }

  async createInstance(defName: string, canvasId: string, elementId: string): Promise<Actor | null> {
    return this.#supervisor.createInstance(defName, canvasId, elementId)
  }

  async removeInstance(instanceId: string): Promise<void> {
    return this.#supervisor.removeInstance(instanceId)
  }

  async deleteDefinition(defName: string): Promise<boolean> {
    return this.#supervisor.deleteDefinition(defName)
  }

  async sendMessage(instanceId: string, msgName: string, msgPayload: any): Promise<string> {
    const actor = this.#supervisor.actorMap[instanceId]
    if (!actor) throw new Error(`Actor instance not found: ${instanceId}`)
    return actor.inbox(msgName, msgPayload)
  }

  listenToActorEvents(instanceId: string, cb: (event: TActorEvent) => void): (() => void) | null {
    return this.#supervisor.listenToActorEvents(instanceId, cb)
  }

  getVibecanvasJson(defName: string) {
    return this.#supervisor.vibecanvasDefMap[defName] ?? null
  }

  async getWidgetCode(defName: string): Promise<{ content: string; path: string; }[] | null> {
    const vcJson = this.getVibecanvasJson(defName)
    if (vcJson === null) return null
    const absManifestPath = resolveManifestPath(this.#config.configPath, vcJson.manifest_path)
    const absWidgetDir = join(dirname(absManifestPath), vcJson.widget.relWidgetDir)

    return txGetWidgetCode({Bun, readdir, join, relative: relativePath}, {absWidgetDir})
  }

  listResources(filter: { kind?: TActorResourceKind; status?: TActorResourceStatus } = {}) {
    if (this.#sharedResourceService) return this.#sharedResourceService.listResources(filter)
    return this.#resourceManager!.listResources(filter)
  }

  getResource(id: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.getResource(id)
    return this.#resourceManager!.getResource(id)
  }

  resolveResourceByName(resourceName: string, options: { requireReady: boolean; kind?: TActorResourceKind }) {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.resolveResourceByName(resourceName, options)
    }
    return this.#resourceManager!.resolveResourceByName(resourceName, options)
  }

  createResource(args: TCreateResourceArgs) {
    if (this.#sharedResourceService) return this.#sharedResourceService.createResource(args)
    return this.#resourceManager!.createResource(args)
  }

  renameResource(args: { id: string; name: string }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.renameResource(args)
    return this.#resourceManager!.renameResource(args)
  }

  deleteResource(id: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.deleteResource(id)
    return this.#resourceManager!.deleteResource(id)
  }

  listResourceReferences(resourceId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.listResourceReferences(resourceId)
    return this.#resourceManager!.listResourceReferences(resourceId)
  }

  listResourceBindingsForDefinition(definitionName: string) {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.listResourceBindingsForDefinition(definitionName)
    }
    return this.#resourceManager!.listResourceBindingsForDefinition(definitionName)
  }

  async countResourceData(args: { resourceId: string; prefix?: string; search?: string }): Promise<number> {
    if (this.#sharedResourceService) return this.#sharedResourceService.countResourceData(args)
    return this.#withReadyDataResource(args.resourceId, (kind) => (
      kind === 'kv' ? this.#kvResource!.countEntries(args) : this.#secretStoreResource!.countEntries(args)
    ))
  }

  async listResourceData(args: { resourceId: string; prefix?: string; search?: string; cursor?: string; limit?: number }): Promise<TActorResourceDataPage> {
    if (this.#sharedResourceService) return this.#sharedResourceService.listResourceData(args)
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      const page = kind === 'kv'
        ? await this.#kvResource!.listEntries(args)
        : await this.#secretStoreResource!.listEntries(args)
      return fnActorResourceDataPage(kind, page)
    })
  }

  async getResourceDataEntry(args: { resourceId: string; key: string }): Promise<
    | { kind: 'kv'; key: string; value: TJson; revision: number; createdAt: string; updatedAt: string }
    | { kind: 'secretStore'; name: string; revision: number; createdAt: string; updatedAt: string }
    | null
  > {
    if (this.#sharedResourceService) return this.#sharedResourceService.getResourceDataEntry(args)
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      if (kind === 'secretStore') {
        const entry = await this.#secretStoreResource!.getEntryMetadata({ resourceId: args.resourceId, name: args.key })
        if (!entry) return null
        return {
          kind,
          name: entry.key,
          revision: entry.revision,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }
      }
      const entry = await this.#kvResource!.getEntry({ resourceId: args.resourceId, key: args.key })
      if (!entry) return null
      return {
        kind,
        key: entry.key,
        value: entry.value,
        revision: entry.revision,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }
    })
  }

  async setResourceDataEntry(args: {
    resourceId: string
    key: string
    expectedRevision: number | null
    value: TJson
  }): Promise<TActorResourceDataMutationResult> {
    if (this.#sharedResourceService) return this.#sharedResourceService.setResourceDataEntry(args)
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      const result = kind === 'kv'
        ? await this.#kvResource!.compareAndSetEntry({
          resourceId: args.resourceId,
          key: args.key,
          expectedRevision: args.expectedRevision,
          value: args.value,
        })
        : await this.#secretStoreResource!.compareAndSetEntry({
          resourceId: args.resourceId,
          name: args.key,
          expectedRevision: args.expectedRevision,
          value: args.value,
        })
      if (!result.ok) {
        throw new ActorResourceError(
          kind === 'kv' ? 'KV_ENTRY_CONFLICT' : 'SECRET_CONFLICT',
          kind === 'kv' ? 'The value changed before it could be saved.' : 'The secret changed before it could be rotated.',
          { expectedRevision: result.expectedRevision, currentRevision: result.currentRevision },
        )
      }
      return fnActorResourceDataMutationResult(kind, result.entry)
    })
  }

  async deleteResourceDataEntry(args: { resourceId: string; key: string; expectedRevision: number }): Promise<{ deleted: true }> {
    if (this.#sharedResourceService) return this.#sharedResourceService.deleteResourceDataEntry(args)
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      const result = kind === 'kv'
        ? await this.#kvResource!.deleteEntry({
          resourceId: args.resourceId,
          key: args.key,
          expectedRevision: args.expectedRevision,
        })
        : await this.#secretStoreResource!.deleteEntry({
          resourceId: args.resourceId,
          name: args.key,
          expectedRevision: args.expectedRevision,
        })
      if (!result.deleted) {
        const current = kind === 'kv'
          ? await this.#kvResource!.getEntry({ resourceId: args.resourceId, key: args.key })
          : await this.#secretStoreResource!.getEntryMetadata({ resourceId: args.resourceId, name: args.key })
        throw new ActorResourceError(
          kind === 'kv' ? 'KV_ENTRY_CONFLICT' : 'SECRET_CONFLICT',
          kind === 'kv' ? 'The value changed or was deleted before it could be removed.' : 'The secret changed or was deleted before it could be removed.',
          { expectedRevision: args.expectedRevision, currentRevision: current?.revision ?? null },
        )
      }
      return { deleted: true }
    })
  }

  getDefinitionResourceStatus(definitionName: string) {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.getDefinitionResourceStatus(definitionName)
    }
    return this.#resourceManager!.getDefinitionResourceStatus(definitionName)
  }

  bindResource(args: TBindResourceArgs) {
    if (this.#sharedResourceService) return this.#sharedResourceService.bindResource(args)
    return this.#resourceManager!.bindResource(args)
  }

  unbindResource(args: { definitionName: string; slot: string }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.unbindResource(args)
    return this.#resourceManager!.unbindResource(args)
  }

  replaceResourceBindings(args: TReplaceResourceBindingsArgs) {
    if (this.#sharedResourceService) return this.#sharedResourceService.replaceResourceBindings(args)
    return this.#resourceManager!.replaceResourceBindings(args)
  }

  dbResourceImpact(resourceId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.dbResourceImpact(resourceId)
    return this.#dbResourceCoordinator!.impact(resourceId)
  }

  async inspectDbResource(args: { resourceId: string; target: 'live' | 'draft'; draftId?: string }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.inspectDbResource(args)
    return this.#withReadyDbResource(args.resourceId, async () => {
      if (args.target === 'draft') {
        const details = args.draftId
          ? await this.#dbResourceCoordinator!.getDraft(args.draftId)
          : await this.#dbResourceCoordinator!.getActiveDraft(args.resourceId)
        if (!details || details.draft.resource_id !== args.resourceId) return null
        return this.#dbResource!.inspect(args.resourceId, 'draft', details.draft.id)
      }
      return this.#dbResource!.inspect(args.resourceId, 'live')
    })
  }

  listDbRows(args: { resourceId: string; object: string; cursor?: TDbRowIdentity | null; limit?: number }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.listDbRows(args)
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource!.listRows(args))
  }

  getDbRow(args: { resourceId: string; object: string; identity: TDbRowIdentity; columns?: string[] }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.getDbRow(args)
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource!.getRow(args))
  }

  executeDbLiveSql(args: { resourceId: string; sql: string; parameters?: readonly TDbCellValue[] | Readonly<Record<string, TDbCellValue>>; approved: boolean }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.executeDbLiveSql(args)
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource!.executeLiveSql(args))
  }

  createDbRow(args: { resourceId: string; object: string; values: TDbRowCreate['values'] }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.createDbRow(args)
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource!.createRow(args))
  }

  updateDbRow(args: { resourceId: string; object: string } & Omit<TDbRowUpdate, 'kind'>) {
    if (this.#sharedResourceService) return this.#sharedResourceService.updateDbRow(args)
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource!.updateRow(args))
  }

  deleteDbRow(args: { resourceId: string; object: string } & Omit<TDbRowDelete, 'kind'>) {
    if (this.#sharedResourceService) return this.#sharedResourceService.deleteDbRow(args)
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource!.deleteRow(args))
  }

  bulkDbRows(args: { resourceId: string; object: string; operations: readonly (TDbRowCreate | TDbRowUpdate | TDbRowDelete)[] }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.bulkDbRows(args)
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource!.bulkRows(args))
  }

  createDbDraft(resourceId: string, name: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.createDbDraft(resourceId, name)
    return this.#dbResourceCoordinator!.createDraft(resourceId, name)
  }

  listDbDrafts(args: { resourceId: string; before?: { createdAt: string; id: string }; limit?: number }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.listDbDrafts(args)
    return this.#dbResourceCoordinator!.listDrafts(args)
  }

  getDbDraft(draftId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.getDbDraft(draftId)
    return this.#dbResourceCoordinator!.getDraft(draftId)
  }

  getActiveDbDraft(resourceId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.getActiveDbDraft(resourceId)
    return this.#dbResourceCoordinator!.getActiveDraft(resourceId)
  }

  changeDbDraft(draftId: string, operation: TDbDraftOperation) {
    if (this.#sharedResourceService) return this.#sharedResourceService.changeDbDraft(draftId, operation)
    return this.#dbResourceCoordinator!.changeDraft(draftId, operation)
  }

  executeDbDraftSql(draftId: string, sql: string, parameters?: readonly TDbCellValue[]) {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.executeDbDraftSql(draftId, sql, parameters)
    }
    return this.#dbResourceCoordinator!.executeDraftSql(draftId, sql, parameters)
  }

  discardDbDraft(draftId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.discardDbDraft(draftId)
    return this.#dbResourceCoordinator!.discardDraft(draftId)
  }

  previewDbApply(draftId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.previewDbApply(draftId)
    return this.#dbResourceCoordinator!.previewApply(draftId)
  }

  confirmDbApply(draftId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.confirmDbApply(draftId)
    return this.#dbResourceCoordinator!.confirmApply(draftId)
  }

  getDbApply(applyId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.getDbApply(applyId)
    return this.#dbResourceCoordinator!.getApply(applyId)
  }

  listDbApplies(args: { resourceId: string; before?: { createdAt: string; id: string }; limit?: number }) {
    if (this.#sharedResourceService) return this.#sharedResourceService.listDbApplies(args)
    return this.#dbResourceCoordinator!.listApplies(args)
  }

  getDbBackup(resourceId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.getDbBackup(resourceId)
    return this.#dbResourceCoordinator!.getBackup(resourceId)
  }

  discardDbBackup(resourceId: string, applyId: string) {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.discardDbBackup(resourceId, applyId)
    }
    return this.#dbResourceCoordinator!.discardBackup(resourceId, applyId)
  }

  previewDbBackupRestore(resourceId: string, applyId: string) {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.previewDbBackupRestore(resourceId, applyId)
    }
    return this.#dbResourceCoordinator!.previewRestore(resourceId, applyId)
  }

  restoreDbBackup(resourceId: string, applyId: string) {
    if (this.#sharedResourceService) {
      return this.#sharedResourceService.restoreDbBackup(resourceId, applyId)
    }
    return this.#dbResourceCoordinator!.restore(resourceId, applyId)
  }

  getDbRestoreStatus(restoreId: string) {
    if (this.#sharedResourceService) return this.#sharedResourceService.getDbRestoreStatus(restoreId)
    return this.#dbResourceCoordinator!.restoreStatus(restoreId)
  }

  async inspectResourceUses(resourceId: string): Promise<TResourceUseInspection> {
    const instances = await this.#config.db.dbResource.listAffectedInstances({ resourceId })
    return {
      resourceId,
      uses: instances.flatMap((instance): readonly TResourceUse[] => (
        this.#supervisor.isInstanceRunning(instance.id)
          ? [{
              id: instance.id,
              kind: 'legacy-actor',
              state: 'active',
              label: instance.actor_definition_name,
            }]
          : []
      )),
    }
  }

  async drainResourceUses(request: TResourceDrainRequest): Promise<TResourceDrainResult> {
    const inspection = await this.inspectResourceUses(request.resourceId)
    const drainedUses: TResourceUse[] = []
    for (const use of inspection.uses) {
      if (!await this.#supervisor.stopInstanceForResourceApply(use.id)) {
        await this.#resumeResourceUses(drainedUses)
        return {
          ok: false,
          code: 'RESOURCE_DRAIN_TIMEOUT',
          inspection: await this.inspectResourceUses(request.resourceId),
        }
      }
      drainedUses.push({ ...use, state: 'stopped' })
    }
    this.#resourceUseLeaseEpoch += 1
    return {
      ok: true,
      lease: {
        resourceId: request.resourceId,
        leaseId: `legacy-actor-resource:${this.#resourceUseLeaseEpoch}`,
        leaseEpoch: this.#resourceUseLeaseEpoch,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        drainedUses,
      },
    }
  }

  async releaseResourceUses(
    lease: TResourceDrainLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult> {
    const resumedUseIds = mode === 'resume'
      ? await this.#resumeResourceUses(lease.drainedUses)
      : []
    return {
      resourceId: lease.resourceId,
      released: true,
      mode,
      resumedUseIds,
    }
  }

  #callResource(call: TActorResourceCall): Promise<unknown> {
    if (this.#sharedResourceService) return this.#sharedResourceService.call(call)
    return this.#resourceManager!.call(call)
  }

  #getActorStartAdmission(
    args: Parameters<TActorResourceManagerFacade['getActorStartAdmission']>[0],
  ): ReturnType<TActorResourceManagerFacade['getActorStartAdmission']> {
    if (this.#sharedResourceService) return this.#sharedResourceService.getActorStartAdmission(args)
    return this.#resourceManager!.getActorStartAdmission(args)
  }

  #completeActorStart(
    args: Parameters<TActorResourceManagerFacade['completeActorStart']>[0],
  ): ReturnType<TActorResourceManagerFacade['completeActorStart']> {
    if (this.#sharedResourceService) return this.#sharedResourceService.completeActorStart(args)
    return this.#resourceManager!.completeActorStart(args)
  }

  async #closeOwnedResources(): Promise<void> {
    let failure: unknown = null
    try {
      await this.#ownedDbResourceCoordinator?.close()
    } catch (error) {
      failure = error
    }
    try {
      await this.#ownedResourceManager?.close()
    } catch (error) {
      failure ??= error
    }
    if (failure !== null) throw failure
  }

  #withReadyDbResource<T>(resourceId: string, operation: () => Promise<T>): Promise<T> {
    return this.#resourceManager!.withReadyResource(resourceId, (resource) => {
      if (resource.kind !== 'db') {
        throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Resource '${resource.name}' is not a DbResource.`)
      }
      return operation()
    })
  }

  #withReadyDataResource<T>(resourceId: string, operation: (kind: 'kv' | 'secretStore') => Promise<T>): Promise<T> {
    return this.#resourceManager!.withReadyResource(resourceId, (resource) => {
      if (resource.kind === 'db') {
        throw new ActorResourceError('RESOURCE_KIND_MISMATCH', 'Database rows use the database resource data API.')
      }
      return operation(resource.kind)
    })
  }

  async #clearObsoleteDbResourceErrors(): Promise<void> {
    const obsoleteCodes = new Set([
      'DB_RESOURCE_SCHEMA_MISMATCH',
      'DB_RESOURCE_VERSION_MISMATCH',
      'DB_RESOURCE_MIGRATION_CHANGED',
      'DB_RESOURCE_MIGRATION_FAILED',
    ])
    const instances = await this.#config.db.actor.listInstances()
    for (const instance of instances) {
      const code = instance.last_error && typeof instance.last_error === 'object' && !Array.isArray(instance.last_error)
        ? (instance.last_error as { code?: unknown }).code
        : null
      if (typeof code !== 'string' || !obsoleteCodes.has(code)) continue
      await this.#config.db.actor.updateInstanceHealth({
        id: instance.id,
        status: instance.status === 'blocked' ? 'stopped' : instance.status,
        last_error: null,
      })
    }
  }

  async #resumeResourceUses(uses: readonly TResourceUse[]): Promise<string[]> {
    const resumedUseIds: string[] = []
    for (const use of uses) {
      try {
        const actor = await this.#supervisor.restartInstanceAfterResourceApply(use.id)
        if (actor !== null && this.#supervisor.isInstanceRunning(use.id)) resumedUseIds.push(use.id)
      } catch {
        // The neutral release result reports only successfully resumed uses.
      }
    }
    return resumedUseIds
  }

}
