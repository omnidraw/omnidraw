import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
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

interface IActorServiceConfig {
  db: DbServiceTurso;
  configPath: string;
  dataRoot: string;
  crypto?: Pick<Crypto, 'randomUUID'>;
  dbResourceDatabaseFactory?: TDatabaseFactory;
  actorResourceKeyValueDatabaseFactory?: TActorResourceKeyValueDatabaseFactory;
  actorResourceKeyValueMaxOpenHandles?: number;
  eventPublisherService: IEventPublisherService,
}

export class ActorService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'actor-service'
  #config: IActorServiceConfig
  #supervisor: ActorSupervisor
  #resourceManager: ActorResourceManager
  #kvResource: KvResource
  #secretStoreResource: SecretStoreResource
  #dbResource: DbResource
  #dbResourceCoordinator: DbResourceCoordinator

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#supervisor = new ActorSupervisor({
      absWidgetDir: join(config.configPath, 'widgets'),
      configPath: config.configPath,
      db: config.db,
      eventPublisherService: config.eventPublisherService,
      resourceGateway: (call) => this.#resourceManager.call(call),
      actorStartAdmission: (args) => this.#resourceManager.getActorStartAdmission(args),
      actorStartCompleted: (args) => this.#resourceManager.completeActorStart(args),
    })
    this.#kvResource = new KvResource(new ActorResourceKeyValueStore({
      dataRoot: config.dataRoot,
      kind: 'kv',
      databaseFactory: config.actorResourceKeyValueDatabaseFactory,
      maxOpenHandles: config.actorResourceKeyValueMaxOpenHandles,
    }))
    this.#secretStoreResource = new SecretStoreResource(new ActorResourceKeyValueStore({
      dataRoot: config.dataRoot,
      kind: 'secretStore',
      databaseFactory: config.actorResourceKeyValueDatabaseFactory,
      maxOpenHandles: config.actorResourceKeyValueMaxOpenHandles,
    }))
    this.#dbResource = new DbResource({
      db: config.db,
      dataRoot: config.dataRoot,
      databaseFactory: config.dbResourceDatabaseFactory,
    })
    this.#resourceManager = new ActorResourceManager({
      db: config.db,
      crypto: config.crypto ?? crypto,
      getDefinition: (definitionName) => this.#supervisor.vibecanvasDefMap[definitionName] ?? null,
      providers: [this.#kvResource, this.#secretStoreResource, this.#dbResource],
    })
    this.#dbResourceCoordinator = new DbResourceCoordinator({
      db: config.db,
      resourceManager: this.#resourceManager,
      supervisor: this.#supervisor,
      dbResource: this.#dbResource,
      crypto: config.crypto ?? crypto,
    })
  }

  callWithDirectResourceBinding(call: TActorResourceCall, binding: TActorResourceDirectBinding): Promise<unknown> {
    return this.#resourceManager.callWithDirectBinding(call, binding)
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
    await this.#resourceManager.reconcileStartup()
    await this.#clearObsoleteDbResourceErrors()
    await this.#dbResourceCoordinator.reconcileStartup()
    await this.#supervisor.init()
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
    await this.#supervisor.closeActors()
    await this.#dbResourceCoordinator.close()
    await this.#resourceManager.close()
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
      await this.#resourceManager.transitionResourceBindings(args, async () => {
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
    return this.#resourceManager.listResources(filter)
  }

  getResource(id: string) {
    return this.#resourceManager.getResource(id)
  }

  resolveResourceByName(resourceName: string, options: { requireReady: boolean; kind?: TActorResourceKind }) {
    return this.#resourceManager.resolveResourceByName(resourceName, options)
  }

  createResource(args: TCreateResourceArgs) {
    return this.#resourceManager.createResource(args)
  }

  renameResource(args: { id: string; name: string }) {
    return this.#resourceManager.renameResource(args)
  }

  deleteResource(id: string) {
    return this.#resourceManager.deleteResource(id)
  }

  listResourceReferences(resourceId: string) {
    return this.#resourceManager.listResourceReferences(resourceId)
  }

  listResourceBindingsForDefinition(definitionName: string) {
    return this.#resourceManager.listResourceBindingsForDefinition(definitionName)
  }

  async countResourceData(args: { resourceId: string; prefix?: string; search?: string }): Promise<number> {
    return this.#withReadyDataResource(args.resourceId, (kind) => (
      kind === 'kv' ? this.#kvResource.countEntries(args) : this.#secretStoreResource.countEntries(args)
    ))
  }

  async listResourceData(args: { resourceId: string; prefix?: string; search?: string; cursor?: string; limit?: number }): Promise<TActorResourceDataPage> {
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      const page = kind === 'kv'
        ? await this.#kvResource.listEntries(args)
        : await this.#secretStoreResource.listEntries(args)
      return fnActorResourceDataPage(kind, page)
    })
  }

  async getResourceDataEntry(args: { resourceId: string; key: string }): Promise<
    | { kind: 'kv'; key: string; value: TJson; revision: number; createdAt: string; updatedAt: string }
    | { kind: 'secretStore'; name: string; revision: number; createdAt: string; updatedAt: string }
    | null
  > {
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      if (kind === 'secretStore') {
        const entry = await this.#secretStoreResource.getEntryMetadata({ resourceId: args.resourceId, name: args.key })
        if (!entry) return null
        return {
          kind,
          name: entry.key,
          revision: entry.revision,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }
      }
      const entry = await this.#kvResource.getEntry({ resourceId: args.resourceId, key: args.key })
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
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      const result = kind === 'kv'
        ? await this.#kvResource.compareAndSetEntry({
          resourceId: args.resourceId,
          key: args.key,
          expectedRevision: args.expectedRevision,
          value: args.value,
        })
        : await this.#secretStoreResource.compareAndSetEntry({
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
    return this.#withReadyDataResource(args.resourceId, async (kind) => {
      const result = kind === 'kv'
        ? await this.#kvResource.deleteEntry({
          resourceId: args.resourceId,
          key: args.key,
          expectedRevision: args.expectedRevision,
        })
        : await this.#secretStoreResource.deleteEntry({
          resourceId: args.resourceId,
          name: args.key,
          expectedRevision: args.expectedRevision,
        })
      if (!result.deleted) {
        const current = kind === 'kv'
          ? await this.#kvResource.getEntry({ resourceId: args.resourceId, key: args.key })
          : await this.#secretStoreResource.getEntryMetadata({ resourceId: args.resourceId, name: args.key })
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
    return this.#resourceManager.getDefinitionResourceStatus(definitionName)
  }

  bindResource(args: TBindResourceArgs) {
    return this.#resourceManager.bindResource(args)
  }

  unbindResource(args: { definitionName: string; slot: string }) {
    return this.#resourceManager.unbindResource(args)
  }

  replaceResourceBindings(args: TReplaceResourceBindingsArgs) {
    return this.#resourceManager.replaceResourceBindings(args)
  }

  dbResourceImpact(resourceId: string) {
    return this.#dbResourceCoordinator.impact(resourceId)
  }

  async inspectDbResource(args: { resourceId: string; target: 'live' | 'draft'; draftId?: string }) {
    return this.#withReadyDbResource(args.resourceId, async () => {
      if (args.target === 'draft') {
        const details = args.draftId
          ? await this.#dbResourceCoordinator.getDraft(args.draftId)
          : await this.#dbResourceCoordinator.getActiveDraft(args.resourceId)
        if (!details || details.draft.resource_id !== args.resourceId) return null
        return this.#dbResource.inspect(args.resourceId, 'draft', details.draft.id)
      }
      return this.#dbResource.inspect(args.resourceId, 'live')
    })
  }

  listDbRows(args: { resourceId: string; object: string; cursor?: TDbRowIdentity | null; limit?: number }) {
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource.listRows(args))
  }

  getDbRow(args: { resourceId: string; object: string; identity: TDbRowIdentity; columns?: string[] }) {
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource.getRow(args))
  }

  executeDbLiveSql(args: { resourceId: string; sql: string; parameters?: readonly TDbCellValue[] | Readonly<Record<string, TDbCellValue>>; approved: boolean }) {
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource.executeLiveSql(args))
  }

  createDbRow(args: { resourceId: string; object: string; values: TDbRowCreate['values'] }) {
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource.createRow(args))
  }

  updateDbRow(args: { resourceId: string; object: string } & Omit<TDbRowUpdate, 'kind'>) {
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource.updateRow(args))
  }

  deleteDbRow(args: { resourceId: string; object: string } & Omit<TDbRowDelete, 'kind'>) {
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource.deleteRow(args))
  }

  bulkDbRows(args: { resourceId: string; object: string; operations: readonly (TDbRowCreate | TDbRowUpdate | TDbRowDelete)[] }) {
    return this.#withReadyDbResource(args.resourceId, () => this.#dbResource.bulkRows(args))
  }

  createDbDraft(resourceId: string, name: string) {
    return this.#dbResourceCoordinator.createDraft(resourceId, name)
  }

  listDbDrafts(args: { resourceId: string; before?: { createdAt: string; id: string }; limit?: number }) {
    return this.#dbResourceCoordinator.listDrafts(args)
  }

  getDbDraft(draftId: string) {
    return this.#dbResourceCoordinator.getDraft(draftId)
  }

  getActiveDbDraft(resourceId: string) {
    return this.#dbResourceCoordinator.getActiveDraft(resourceId)
  }

  changeDbDraft(draftId: string, operation: TDbDraftOperation) {
    return this.#dbResourceCoordinator.changeDraft(draftId, operation)
  }

  executeDbDraftSql(draftId: string, sql: string, parameters?: readonly TDbCellValue[]) {
    return this.#dbResourceCoordinator.executeDraftSql(draftId, sql, parameters)
  }

  discardDbDraft(draftId: string) {
    return this.#dbResourceCoordinator.discardDraft(draftId)
  }

  previewDbApply(draftId: string) {
    return this.#dbResourceCoordinator.previewApply(draftId)
  }

  confirmDbApply(draftId: string) {
    return this.#dbResourceCoordinator.confirmApply(draftId)
  }

  getDbApply(applyId: string) {
    return this.#dbResourceCoordinator.getApply(applyId)
  }

  listDbApplies(args: { resourceId: string; before?: { createdAt: string; id: string }; limit?: number }) {
    return this.#dbResourceCoordinator.listApplies(args)
  }

  getDbBackup(resourceId: string) {
    return this.#dbResourceCoordinator.getBackup(resourceId)
  }

  discardDbBackup(resourceId: string, applyId: string) {
    return this.#dbResourceCoordinator.discardBackup(resourceId, applyId)
  }

  previewDbBackupRestore(resourceId: string, applyId: string) {
    return this.#dbResourceCoordinator.previewRestore(resourceId, applyId)
  }

  restoreDbBackup(resourceId: string, applyId: string) {
    return this.#dbResourceCoordinator.restore(resourceId, applyId)
  }

  getDbRestoreStatus(restoreId: string) {
    return this.#dbResourceCoordinator.restoreStatus(restoreId)
  }

  #withReadyDbResource<T>(resourceId: string, operation: () => Promise<T>): Promise<T> {
    return this.#resourceManager.withReadyResource(resourceId, (resource) => {
      if (resource.kind !== 'db') {
        throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Resource '${resource.name}' is not a DbResource.`)
      }
      return operation()
    })
  }

  #withReadyDataResource<T>(resourceId: string, operation: (kind: 'kv' | 'secretStore') => Promise<T>): Promise<T> {
    return this.#resourceManager.withReadyResource(resourceId, (resource) => {
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

}
