import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { TActorResource, TDbResourceConfiguration } from '@vibecanvas/service-db/model';
import { ActorResourceError } from './ActorResourceError';
import type { ActorResourceManager } from './ActorResourceManager';
import type { ActorSupervisor } from '../ActorSupervisor';
import type { DbResource } from './DbResource';
import type { TDbResourceMigrationPreview } from './resource-types';

type TDbResourceMigrationCoordinatorConfig = {
  readonly db: DbServiceTurso;
  readonly resourceManager: ActorResourceManager;
  readonly supervisor: ActorSupervisor;
  readonly dbResource: DbResource;
};

export class DbResourceMigrationCoordinator {
  constructor(private readonly config: TDbResourceMigrationCoordinatorConfig) {}

  private get db() { return this.config.db; }
  private get resourceManager() { return this.config.resourceManager; }
  private get supervisor() { return this.config.supervisor; }
  private get dbResource() { return this.config.dbResource; }

  async previewDbResourceMigration(resourceId: string, targetVersion: number): Promise<TDbResourceMigrationPreview> {
    const resource = await this.resourceManager.getResource(resourceId)
    if (!resource) throw new ActorResourceError('RESOURCE_NOT_FOUND', `Resource "${resourceId}" was not found.`)
    if (resource.kind !== 'db') throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Resource "${resourceId}" is not a DbResource.`)
    if (resource.status !== 'ready') throw new ActorResourceError('RESOURCE_NOT_READY', `DbResource "${resource.name}" is ${resource.status}.`)
    const configuration = await this.db.dbResource.configuration.get({ resourceId })
    if (!configuration) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource configuration is unavailable.')
    if (!Number.isInteger(targetVersion) || targetVersion <= configuration.applied_version) {
      throw new ActorResourceError('DB_RESOURCE_VERSION_MISMATCH', 'DbResource migration target must move forward.')
    }
    const target = await this.db.dbResource.migration.get({ schemaId: configuration.schema_id, version: targetVersion })
    if (!target || target.status !== 'published') {
      throw new ActorResourceError('DB_RESOURCE_VERSION_MISMATCH', `Schema ${configuration.schema_id}@${targetVersion} is not published.`)
    }

    return this.#buildDbResourceMigrationPreview(resource, configuration, targetVersion)
  }

  async #buildDbResourceMigrationPreview(
    resource: TActorResource,
    configuration: TDbResourceConfiguration,
    targetVersion: number,
  ): Promise<TDbResourceMigrationPreview> {
    const resourceId = resource.id
    const bindings = await this.db.actorResource.listBindingsForResource({ resourceId })
    const definitionNames = [...new Set(bindings.map((binding) => binding.actor_definition_name))]
    const affectedDefinitions = definitionNames.map((definitionName) => {
      const slots = bindings.filter((binding) => binding.actor_definition_name === definitionName).map((binding) => binding.slot_name)
      const definition = this.supervisor.vibecanvasDefMap[definitionName]
      const requirements = slots
        .map((slot) => definition?.actor.resources?.[slot])
        .filter((requirement) => requirement?.kind === 'db')
      const expectedSchemaId = requirements[0]?.kind === 'db' ? requirements[0].schema.id : null
      const expectedVersion = requirements[0]?.kind === 'db' ? requirements[0].schema.version : null
      const compatibleAfterMigration = requirements.length === slots.length
        && requirements.every((requirement) => requirement?.kind === 'db'
          && requirement.schema.id === configuration.schema_id
          && requirement.schema.version === targetVersion)
      return { definitionName, slots, expectedSchemaId, expectedVersion, compatibleAfterMigration }
    })
    const instances = await this.db.dbResource.listAffectedInstances({ resourceId })
    return {
      resource,
      configuration,
      targetVersion,
      affectedDefinitions,
      affectedInstances: instances.map((instance) => ({
        instanceId: instance.id,
        definitionName: instance.actor_definition_name,
        status: instance.status,
        running: this.supervisor.isInstanceRunning(instance.id),
        restartWhenCompatible: this.supervisor.isInstanceRunning(instance.id),
      })),
    }
  }

  getDbResourceConfiguration(resourceId: string) {
    return this.db.dbResource.configuration.get({ resourceId })
  }

  async migrateDbResource(resourceId: string, targetVersion: number) {
    let preview = await this.previewDbResourceMigration(resourceId, targetVersion)
    let definitionByName = new Map(preview.affectedDefinitions.map((definition) => [definition.definitionName, definition]))
    const restartAfterFailure: string[] = []
    const expectedFor = (definitionName: string, configuration: typeof preview.configuration) => {
      const definition = definitionByName.get(definitionName)
      return {
        schemaId: definition?.expectedSchemaId ?? configuration.schema_id,
        version: definition?.expectedVersion ?? configuration.applied_version,
      }
    }
    const isCompatible = (definitionName: string, configuration: typeof preview.configuration) => {
      const definition = definitionByName.get(definitionName)
      const currentManifest = this.supervisor.vibecanvasDefMap[definitionName]
      return definition !== undefined && definition.slots.length > 0 && definition.slots.every((slot) => {
        const requirement = currentManifest?.actor.resources?.[slot]
        return requirement?.kind === 'db'
          && requirement.schema.id === configuration.schema_id
          && requirement.schema.version === configuration.applied_version
      })
    }

    try {
      const coordinated = await this.resourceManager.coordinateResourceMigration(resourceId, async (migratingResource) => {
        const stopped = new Set<string>()
        let failedStopId: string | null = null
        let providerMigrated = false
        try {
          const lockedConfiguration = await this.db.dbResource.configuration.get({ resourceId })
          if (!lockedConfiguration) {
            throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource configuration is unavailable.')
          }
          preview = await this.#buildDbResourceMigrationPreview(migratingResource, lockedConfiguration, targetVersion)
          definitionByName = new Map(preview.affectedDefinitions.map((definition) => [definition.definitionName, definition]))
          if (targetVersion <= lockedConfiguration.applied_version) {
            throw new ActorResourceError('DB_RESOURCE_VERSION_MISMATCH', 'DbResource migration target must move forward.')
          }
          const lockedTarget = await this.db.dbResource.migration.get({
            schemaId: lockedConfiguration.schema_id,
            version: targetVersion,
          })
          if (!lockedTarget || lockedTarget.status !== 'published') {
            throw new ActorResourceError(
              'DB_RESOURCE_VERSION_MISMATCH',
              `Schema ${lockedConfiguration.schema_id}@${targetVersion} is not published.`,
            )
          }

          for (const instance of preview.affectedInstances) {
            const expected = expectedFor(instance.definitionName, preview.configuration)
            await this.db.dbResource.migrationBlock.upsert({
              resourceId,
              actorInstanceId: instance.instanceId,
              reason: 'migrating',
              restartWhenCompatible: instance.running,
              expectedSchemaId: expected.schemaId,
              expectedVersion: expected.version,
              actualSchemaId: preview.configuration.schema_id,
              actualVersion: preview.configuration.applied_version,
            })
          }

          for (const instance of preview.affectedInstances) {
            if (!instance.running) continue
            const didStop = await this.supervisor.stopInstanceForResourceMigration(instance.instanceId)
            if (!didStop) {
              failedStopId = instance.instanceId
              throw new ActorResourceError('DB_BUSY', `Actor instance "${instance.instanceId}" could not stop for migration.`)
            }
            stopped.add(instance.instanceId)
          }

          await this.resourceManager.drainResource(resourceId)
          const configuration = await this.dbResource.migrate(resourceId, targetVersion)
          providerMigrated = true
          const restartIds: string[] = []
          for (const instance of preview.affectedInstances) {
            const expected = expectedFor(instance.definitionName, configuration)
            if (isCompatible(instance.definitionName, configuration)) {
              if (instance.running) {
                restartIds.push(instance.instanceId)
                await this.db.dbResource.migrationBlock.upsert({
                  resourceId,
                  actorInstanceId: instance.instanceId,
                  reason: 'migrating',
                  restartWhenCompatible: true,
                  expectedSchemaId: expected.schemaId,
                  expectedVersion: expected.version,
                  actualSchemaId: configuration.schema_id,
                  actualVersion: configuration.applied_version,
                })
              } else {
                await this.db.dbResource.migrationBlock.remove({ resourceId, actorInstanceId: instance.instanceId })
              }
              continue
            }
            await this.db.dbResource.migrationBlock.upsert({
              resourceId,
              actorInstanceId: instance.instanceId,
              reason: expected.schemaId === configuration.schema_id ? 'versionMismatch' : 'schemaMismatch',
              restartWhenCompatible: instance.running,
              expectedSchemaId: expected.schemaId,
              expectedVersion: expected.version,
              actualSchemaId: configuration.schema_id,
              actualVersion: configuration.applied_version,
            })
          }
          const ready = await this.db.actorResource.updateProviderState({
            id: resourceId,
            status: 'ready',
            lastError: null,
          })
          if (!ready) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource catalog row disappeared after migration.')
          await this.dbResource.commitMigration(resourceId)
          return { preview, resource: ready, configuration, restartIds }
        } catch (error) {
          let restoredConfiguration = null
          if (providerMigrated) {
            try {
              restoredConfiguration = await this.dbResource.restoreMigration(resourceId, preview.configuration)
            } catch {
              restoredConfiguration = null
            }
          } else {
            const current = await this.db.dbResource.configuration.get({ resourceId }).catch(() => null)
            if (
              current?.applied_version === preview.configuration.applied_version
              && current.target_version === preview.configuration.applied_version
            ) {
              restoredConfiguration = current
            }
          }

          if (restoredConfiguration) {
            await this.db.actorResource.updateProviderState({
              id: resourceId,
              status: 'ready',
              lastError: {
                code: 'DB_RESOURCE_MIGRATION_FAILED',
                message: 'DbResource migration failed and the verified previous version remains active.',
              },
            }).catch(() => null)

            for (const instance of preview.affectedInstances) {
              const expected = expectedFor(instance.definitionName, restoredConfiguration)
              if (instance.instanceId === failedStopId) {
                await this.db.dbResource.migrationBlock.upsert({
                  resourceId,
                  actorInstanceId: instance.instanceId,
                  reason: 'migrationError',
                  restartWhenCompatible: false,
                  expectedSchemaId: expected.schemaId,
                  expectedVersion: expected.version,
                  actualSchemaId: restoredConfiguration.schema_id,
                  actualVersion: restoredConfiguration.applied_version,
                }).catch(() => null)
              } else if (isCompatible(instance.definitionName, restoredConfiguration)) {
                if (stopped.has(instance.instanceId)) {
                  restartAfterFailure.push(instance.instanceId)
                  await this.db.dbResource.migrationBlock.upsert({
                    resourceId,
                    actorInstanceId: instance.instanceId,
                    reason: 'migrating',
                    restartWhenCompatible: true,
                    expectedSchemaId: expected.schemaId,
                    expectedVersion: expected.version,
                    actualSchemaId: restoredConfiguration.schema_id,
                    actualVersion: restoredConfiguration.applied_version,
                  }).catch(() => null)
                } else {
                  await this.db.dbResource.migrationBlock.remove({
                    resourceId,
                    actorInstanceId: instance.instanceId,
                  }).catch(() => false)
                }
              } else {
                await this.db.dbResource.migrationBlock.upsert({
                  resourceId,
                  actorInstanceId: instance.instanceId,
                  reason: expected.schemaId === restoredConfiguration.schema_id ? 'versionMismatch' : 'schemaMismatch',
                  restartWhenCompatible: instance.running,
                  expectedSchemaId: expected.schemaId,
                  expectedVersion: expected.version,
                  actualSchemaId: restoredConfiguration.schema_id,
                  actualVersion: restoredConfiguration.applied_version,
                }).catch(() => null)
              }
            }
          } else {
            await this.db.actorResource.updateProviderState({
              id: resourceId,
              status: 'error',
              lastError: {
                code: 'DB_RESOURCE_RECOVERY_FAILED',
                message: 'DbResource migration recovery could not be verified; actors remain blocked.',
              },
            }).catch(() => null)
          }
          throw error
        }
      })

      for (const instanceId of coordinated.restartIds) {
        await this.supervisor.restartInstanceAfterResourceMigration(instanceId)
      }
      const { restartIds: _restartIds, ...result } = coordinated
      return result
    } catch (error) {
      for (const instanceId of restartAfterFailure) {
        await this.supervisor.restartInstanceAfterResourceMigration(instanceId)
      }
      throw error
    }
  }

}
