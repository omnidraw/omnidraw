/**
 * @file Legacy actor compatibility adapter for the neutral local ResourceManager.
 */

import {
  ResourceManager,
  type ILocalResourceProvider,
  type IResourceManagerStore,
  type TBindResourceArgs as TLocalBindResourceArgs,
  type TCreateResourceArgs as TLocalCreateResourceArgs,
  type TManagedResourceRequirement,
  type TReplaceResourceBindingsArgs as TLocalReplaceResourceBindingsArgs,
  type TResourceBindingRecord,
  type TResourceCatalogRecord,
  type TResourceManagerCall,
} from '@vibecanvas/resource-runtime/local';
import type { TTenantDb } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type {
  TActorResource,
  TActorResourceBinding,
  TActorResourceKind,
  TActorResourceStatus,
  TJson,
} from '@vibecanvas/service-db/model';
import type { TActorResourceRequirement, TActorResourceScope } from '../core/types';
import type {
  IActorResourceProvider,
  TActorManifestResolver,
  TActorResourceBindingStatus,
  TActorResourceCall,
  TActorResourceDirectBinding,
  TActorStartAdmission,
} from './resource-types';

type TActorResourceManagerConfig = Readonly<{
  db: TTenantDb;
  crypto: Pick<Crypto, 'randomUUID'>;
  getDefinition: TActorManifestResolver;
  providers: readonly IActorResourceProvider[];
}>;

export type TCreateResourceArgs = TLocalCreateResourceArgs;
export type TBindResourceArgs = TLocalBindResourceArgs;
export type TReplaceResourceBindingsArgs = TLocalReplaceResourceBindingsArgs;

function toLocalResource(resource: TActorResource): TResourceCatalogRecord {
  return resource as unknown as TResourceCatalogRecord;
}

function toActorResource(resource: TResourceCatalogRecord): TActorResource {
  return resource as unknown as TActorResource;
}

function toLocalBinding(binding: TActorResourceBinding): TResourceBindingRecord {
  return {
    definition_name: binding.actor_definition_name,
    slot_name: binding.slot_name,
    resource_id: binding.resource_id,
    allow_read: binding.allow_read,
    allow_write: binding.allow_write,
    created_at: binding.created_at,
    updated_at: binding.updated_at,
  };
}

function toActorBinding(binding: TResourceBindingRecord): TActorResourceBinding {
  return {
    actor_definition_name: binding.definition_name,
    slot_name: binding.slot_name,
    resource_id: binding.resource_id,
    allow_read: binding.allow_read,
    allow_write: binding.allow_write,
    created_at: binding.created_at,
    updated_at: binding.updated_at,
  };
}

function toLocalCall(call: TActorResourceCall): TResourceManagerCall {
  return {
    consumerId: call.actorId,
    definitionName: call.definitionName,
    invocationId: call.runId,
    functionClass: call.functionClass,
    slot: call.slot,
    kind: call.kind,
    operation: call.operation,
    args: call.args,
  };
}

function createResourceManagerStore(db: TTenantDb): IResourceManagerStore {
  return {
    catalog: {
      list: async (filter) => (await db.actorResource.list(filter)).map(toLocalResource),
      get: async (args) => {
        const resource = await db.actorResource.get(args);
        return resource ? toLocalResource(resource) : null;
      },
      findByNameKey: async (args) => (await db.actorResource.findByNameKey(args)).map(toLocalResource),
      create: async (args) => toLocalResource(await db.actorResource.create(args)),
      rename: async (args) => {
        const resource = await db.actorResource.rename(args);
        return resource ? toLocalResource(resource) : null;
      },
      updateProviderState: async (args) => {
        const resource = await db.actorResource.updateProviderState({
          ...args,
          lastError: args.lastError as TJson | null,
        });
        return resource ? toLocalResource(resource) : null;
      },
      beginDelete: async (args) => {
        const resource = await db.actorResource.beginDelete(args);
        return resource ? toLocalResource(resource) : null;
      },
      delete: (args) => db.actorResource.delete(args),
      listBindingsForResource: async (args) => (
        await db.actorResource.listBindingsForResource(args)
      ).map(toLocalBinding),
      listBindingsForDefinition: async (args) => (
        await db.actorResource.listBindingsForDefinition(args)
      ).map(toLocalBinding),
      upsertBinding: async (args) => {
        const binding = await db.actorResource.upsertBinding(args);
        return binding ? toLocalBinding(binding) : null;
      },
      removeBinding: (args) => db.actorResource.removeBinding(args),
      replaceBindings: async (args) => (
        await db.actorResource.replaceBindings(args)
      ).map(toLocalBinding),
    },
    migration: {
      hasActiveWork: async (resourceId) => {
        const [activeDraft, ...activeApplyPages] = await Promise.all([
          db.dbResource.draft.getActive({ resourceId }),
          ...(['preparing', 'stopping', 'applying', 'restarting'] as const).map((status) => (
            db.dbResource.apply.list({ resourceId, status, limit: 1 })
          )),
        ]);
        return activeDraft !== null || activeApplyPages.some((page) => page.length > 0);
      },
    },
    consumerRecovery: {
      listResults: async (consumerId) => (
        await db.dbResource.apply.instanceResult.listByInstance({ actorInstanceId: consumerId })
      ).map((result) => ({
        migrationId: result.apply_id,
        consumerId: result.actor_instance_id,
        definitionName: result.actor_definition_name,
        wasRunning: result.was_running,
        status: result.status,
      })),
      getMigration: async (migrationId) => {
        const apply = await db.dbResource.apply.get({ id: migrationId });
        return apply ? { resourceId: apply.resource_id } : null;
      },
      markRestarted: async (result) => {
        await db.dbResource.apply.instanceResult.upsert({
          applyId: result.migrationId,
          actorInstanceId: result.consumerId,
          actorDefinitionName: result.definitionName,
          wasRunning: true,
          status: 'restarted',
          error: null,
        });
      },
    },
  };
}

/**
 * Compatibility facade. New resource composition should construct ResourceManager
 * directly and inject structural store/provider capabilities.
 */
export class ActorResourceManager {
  readonly #manager: ResourceManager;

  constructor(config: TActorResourceManagerConfig) {
    this.#manager = new ResourceManager({
      store: createResourceManagerStore(config.db),
      crypto: config.crypto,
      resolveRequirements: (definitionName) => {
        const definition = config.getDefinition(definitionName);
        return definition
          ? (definition.actor.resources ?? {}) as Readonly<Record<string, TManagedResourceRequirement>>
          : null;
      },
      providers: config.providers as unknown as readonly ILocalResourceProvider[],
    });
  }

  registerProvider(provider: IActorResourceProvider): void {
    this.#manager.registerProvider(provider as unknown as ILocalResourceProvider);
  }

  async listResources(
    filter: { kind?: TActorResourceKind; status?: TActorResourceStatus } = {},
  ): Promise<TActorResource[]> {
    return (await this.#manager.listResources(filter)).map(toActorResource);
  }

  async getResource(id: string): Promise<TActorResource | null> {
    const resource = await this.#manager.getResource(id);
    return resource ? toActorResource(resource) : null;
  }

  async resolveResourceByName(
    resourceName: string,
    options: { requireReady: boolean; kind?: TActorResourceKind },
  ): Promise<TActorResource> {
    return toActorResource(await this.#manager.resolveResourceByName(resourceName, options));
  }

  reconcileStartup(): Promise<void> {
    return this.#manager.reconcileStartup();
  }

  async createResource(args: TCreateResourceArgs): Promise<TActorResource> {
    return toActorResource(await this.#manager.createResource(args));
  }

  async renameResource(args: { id: string; name: string }): Promise<TActorResource> {
    return toActorResource(await this.#manager.renameResource(args));
  }

  deleteResource(id: string): Promise<void> {
    return this.#manager.deleteResource(id);
  }

  async listResourceReferences(resourceId: string): Promise<TActorResourceBinding[]> {
    return (await this.#manager.listResourceReferences(resourceId)).map(toActorBinding);
  }

  async listResourceBindingsForDefinition(definitionName: string): Promise<TActorResourceBinding[]> {
    return (await this.#manager.listResourceBindingsForDefinition(definitionName)).map(toActorBinding);
  }

  async bindResource(args: TBindResourceArgs): Promise<TActorResourceBinding> {
    return toActorBinding(await this.#manager.bindResource(args));
  }

  unbindResource(args: { definitionName: string; slot: string }): Promise<boolean> {
    return this.#manager.unbindResource(args);
  }

  async replaceResourceBindings(args: TReplaceResourceBindingsArgs): Promise<TActorResourceBinding[]> {
    return (await this.#manager.replaceResourceBindings(args)).map(toActorBinding);
  }

  async transitionResourceBindings(
    args: TReplaceResourceBindingsArgs,
    beforeReplace: () => Promise<void>,
  ): Promise<TActorResourceBinding[]> {
    return (await this.#manager.transitionResourceBindings(args, beforeReplace)).map(toActorBinding);
  }

  async getDefinitionResourceStatus(definitionName: string): Promise<TActorResourceBindingStatus[]> {
    return await this.#manager.getDefinitionResourceStatus(definitionName) as unknown as TActorResourceBindingStatus[];
  }

  getActorStartAdmission(args: {
    definitionName: string;
    actorInstanceId: string;
    restartIfCompatible: boolean;
  }): Promise<TActorStartAdmission> {
    return this.#manager.getConsumerStartAdmission({
      definitionName: args.definitionName,
      consumerId: args.actorInstanceId,
      restartIfCompatible: args.restartIfCompatible,
    });
  }

  completeActorStart(args: {
    actorInstanceId: string;
    resourceIds: readonly string[];
    succeeded: boolean;
  }): Promise<void> {
    return this.#manager.completeConsumerStart({
      consumerId: args.actorInstanceId,
      resourceIds: args.resourceIds,
      succeeded: args.succeeded,
    });
  }

  withReadyResource<T>(
    resourceId: string,
    operation: (resource: TActorResource) => Promise<T>,
  ): Promise<T> {
    return this.#manager.withReadyResource(resourceId, (resource) => operation(toActorResource(resource)));
  }

  call(call: TActorResourceCall): Promise<unknown> {
    return this.#manager.call(toLocalCall(call));
  }

  callWithDirectBinding(
    call: TActorResourceCall,
    direct: TActorResourceDirectBinding,
  ): Promise<unknown> {
    return this.#manager.callWithDirectBinding(toLocalCall(call), {
      resourceId: direct.resourceId,
      requirement: direct.requirement as TManagedResourceRequirement,
      scope: direct.scope,
    });
  }

  close(): Promise<void> {
    return this.#manager.close();
  }

  drainResource(resourceId: string): Promise<void> {
    return this.#manager.drainResource(resourceId);
  }

  coordinateResourceApply<T>(
    resourceId: string,
    operation: (resource: TActorResource) => Promise<T>,
  ): Promise<T> {
    return this.#manager.coordinateResourceMigration(
      resourceId,
      (resource) => operation(toActorResource(resource)),
    );
  }
}

// Compile-time assertions for the compatibility aliases used by ActorService.
type _TActorScopeCompatible = TActorResourceScope extends TLocalBindResourceArgs['scope'] ? true : never;
type _TActorRequirementCompatible = TActorResourceRequirement extends TManagedResourceRequirement ? true : never;
