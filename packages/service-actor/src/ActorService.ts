import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative as relativePath } from 'node:path';
import { ActorSupervisor } from './ActorSupervisor';
import { txGetWidgetCode } from './core/tx.actor-definitions';
import type { TVibecanvasJson } from './core/types';
import type { Actor, TActorEvent } from './Actor';
import { ActorResourceManager, type TBindResourceArgs, type TCreateResourceArgs } from './resources/ActorResourceManager';
import type { TActorResourceKind, TActorResourceStatus } from '@vibecanvas/service-db/model';
import { DbResource } from './resources/DbResource';
import { KvResource } from './resources/KvResource';
import { SecretStoreResource } from './resources/SecretStoreResource';
import { DbResourceMigrationCoordinator } from './resources/DbResourceMigrationCoordinator';
import { ActorResourceError, type TActorResourceErrorCode } from './resources/ActorResourceError';
import type { TDbResourceMigrationPreview } from './resources/resource-types';

function resolveManifestPath(configPath: string, manifestPath: string): string {
  return isAbsolute(manifestPath) ? manifestPath : join(configPath, manifestPath)
}

function migrationChecksum(sql: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(sql, 'utf8')).digest('hex')}`
}

const DB_MIGRATION_SQL_MAX_BYTES = 1_048_576

function validateMigrationSql(sql: string): void {
  if (typeof sql !== 'string' || sql.trim().length === 0 || Buffer.byteLength(sql, 'utf8') > DB_MIGRATION_SQL_MAX_BYTES) {
    throw new ActorResourceError(
      'DB_RESOURCE_MIGRATION_FAILED',
      `DbResource migration SQL must be non-blank and no larger than ${DB_MIGRATION_SQL_MAX_BYTES} UTF-8 bytes.`,
    )
  }
}

function safeDbControlMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  if (
    message.length === 0
    || message.length > 512
    || /[\\/\r\n]/.test(message)
    || /\b(?:SQLITE|TURSO|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA)\b/i.test(message)
  ) return fallback
  return message
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
}

interface IActorServiceConfig {
  db: DbServiceTurso;
  configPath: string;
  dataRoot?: string;
  crypto?: Pick<Crypto, 'randomUUID'>;
  eventPublisherService: IEventPublisherService,
}

export class ActorService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'actor-service'
  #config: IActorServiceConfig
  #supervisor: ActorSupervisor
  #resourceManager: ActorResourceManager
  #dbMigrationCoordinator: DbResourceMigrationCoordinator

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#supervisor = new ActorSupervisor({
      absWidgetDir: join(config.configPath, 'widgets'),
      configPath: config.configPath,
      db: config.db,
      eventPublisherService: config.eventPublisherService,
      resourceGateway: (call) => this.#resourceManager.call(call),
      actorStartAdmission: (args) => this.#resourceManager.getActorStartAdmission(args),
      actorStartSucceeded: (args) => this.#resourceManager.completeActorStart(args),
    })
    const kvResource = new KvResource(config.db.actorResource.keyValue)
    const secretStoreResource = new SecretStoreResource(config.db.actorResource.keyValue)
    const dbResource = new DbResource({
      db: config.db,
      dataRoot: config.dataRoot ?? join(config.configPath, '.vibecanvas-data'),
    })
    this.#resourceManager = new ActorResourceManager({
      db: config.db,
      crypto: config.crypto ?? crypto,
      getDefinition: (definitionName) => this.#supervisor.vibecanvasDefMap[definitionName] ?? null,
      providers: [kvResource, secretStoreResource, dbResource],
    })
    this.#dbMigrationCoordinator = new DbResourceMigrationCoordinator({
      db: config.db,
      resourceManager: this.#resourceManager,
      supervisor: this.#supervisor,
      dbResource,
    })
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
    await this.#resourceManager.reconcileStartup()
    await this.#supervisor.init()
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
    this.#supervisor.closeActors()
    await this.#resourceManager.close()
  }

  async reload(): Promise<void> {
    await this.#supervisor.reload()
  }

  async reloadDefinitionInstances(defName: string): Promise<void> {
    await this.#supervisor.reloadDefinitionInstances(defName)
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

  getDefinitionResourceStatus(definitionName: string) {
    return this.#resourceManager.getDefinitionResourceStatus(definitionName)
  }

  bindResource(args: TBindResourceArgs) {
    return this.#resourceManager.bindResource(args)
  }

  unbindResource(args: { definitionName: string; slot: string }) {
    return this.#resourceManager.unbindResource(args)
  }

  listDbSchemas(args: { status?: 'draft' | 'published' | 'deprecated' } = {}) {
    return this.#config.db.dbResource.schema.list(args)
  }

  getDbSchema(id: string) {
    return this.#config.db.dbResource.schema.get({ id })
  }

  createDbSchema(args: { id: string; name: string; description?: string | null }) {
    return this.#dbControl(
      () => this.#config.db.dbResource.schema.create(args),
      'DB_RESOURCE_SCHEMA_MISMATCH',
      'DbResource schema could not be created; verify its ID and lifecycle state.',
    )
  }

  updateDbSchemaDraft(args: { id: string; name: string; description?: string | null }) {
    return this.#dbControl(
      () => this.#config.db.dbResource.schema.updateDraft(args),
      'DB_RESOURCE_SCHEMA_MISMATCH',
      'Only an existing draft DbResource schema can be updated.',
    )
  }

  deleteDbSchemaDraft(id: string) {
    return this.#dbControl(
      () => this.#config.db.dbResource.schema.deleteDraft({ id }),
      'DB_RESOURCE_SCHEMA_MISMATCH',
      'Only an unreferenced draft DbResource schema can be deleted.',
    )
  }

  publishDbSchema(id: string) {
    return this.#dbControl(
      () => this.#config.db.dbResource.schema.publish({ id }),
      'DB_RESOURCE_MIGRATION_FAILED',
      'DbResource schema publication requires a valid contiguous draft migration sequence.',
    )
  }

  deprecateDbSchema(id: string) {
    return this.#dbControl(
      () => this.#config.db.dbResource.schema.deprecate({ id }),
      'DB_RESOURCE_SCHEMA_MISMATCH',
      'Only a published DbResource schema without draft migrations can be deprecated.',
    )
  }

  listDbMigrations(args: { schemaId: string; status?: 'draft' | 'published'; throughVersion?: number }) {
    return this.#config.db.dbResource.migration.list(args)
  }

  createDbMigrationDraft(args: { schemaId: string; version: number; name: string; sql: string }) {
    validateMigrationSql(args.sql)
    return this.#dbControl(
      () => this.#config.db.dbResource.migration.createDraft({ ...args, checksum: migrationChecksum(args.sql) }),
      'DB_RESOURCE_MIGRATION_FAILED',
      'DbResource migration draft must be the next contiguous version on a non-deprecated schema.',
    )
  }

  updateDbMigrationDraft(args: { schemaId: string; version: number; name: string; sql: string }) {
    validateMigrationSql(args.sql)
    return this.#dbControl(
      () => this.#config.db.dbResource.migration.updateDraft({ ...args, checksum: migrationChecksum(args.sql) }),
      'DB_RESOURCE_MIGRATION_FAILED',
      'Only the current draft DbResource migration can be updated.',
    )
  }

  deleteDbMigrationDraft(args: { schemaId: string; version: number }) {
    return this.#dbControl(
      () => this.#config.db.dbResource.migration.deleteDraft(args),
      'DB_RESOURCE_MIGRATION_FAILED',
      'Only the latest draft DbResource migration can be deleted.',
    )
  }

  publishDbMigration(args: { schemaId: string; version: number }) {
    return this.#dbControl(
      () => this.#config.db.dbResource.migration.publish(args),
      'DB_RESOURCE_MIGRATION_FAILED',
      'DbResource migration publication requires the next contiguous draft version.',
    )
  }

  async #dbControl<T>(
    operation: () => Promise<T>,
    code: TActorResourceErrorCode,
    fallbackMessage: string,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ActorResourceError) throw error
      throw new ActorResourceError(code, safeDbControlMessage(error, fallbackMessage))
    }
  }

  async getDbSchemaContext(schemaId: string, version: number) {
    if (!Number.isInteger(version) || version < 0) return null
    const schema = await this.#config.db.dbResource.schema.get({ id: schemaId })
    if (!schema || schema.status !== 'published') return null
    const migrations = await this.#config.db.dbResource.migration.list({ schemaId, status: 'published', throughVersion: version })
    if (
      migrations.length !== version
      || migrations.some((migration, index) => migration.version !== index + 1)
    ) return null
    return { schema, migrations }
  }

  getDbResourceConfiguration(resourceId: string) {
    return this.#dbMigrationCoordinator.getDbResourceConfiguration(resourceId)
  }

  previewDbResourceMigration(resourceId: string, targetVersion: number): Promise<TDbResourceMigrationPreview> {
    return this.#dbMigrationCoordinator.previewDbResourceMigration(resourceId, targetVersion)
  }

  migrateDbResource(resourceId: string, targetVersion: number) {
    return this.#dbMigrationCoordinator.migrateDbResource(resourceId, targetVersion)
  }

}
