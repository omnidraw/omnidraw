import type { IPlugin } from '@vibecanvas/runtime';
import { ActorService } from '@vibecanvas/service-actor';
import { createLegacyActorAgentCapabilityFactory } from '@vibecanvas/service-agent/legacy/LegacyActorAgentCapability';
import type {
  ILegacyActorAgentCapability,
  TLegacyActorAgentCapabilityFactory,
  TLegacyActorServiceCapability,
} from '@vibecanvas/service-agent/legacy/interface';
import type {
  TAutomergeCallbacks,
  TAutomergeElementEvent,
} from '@vibecanvas/service-automerge/AutomergeService';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import type { ResourceServicePool } from '../../services/ResourceServicePool';
import type { ResourceUseCoordinatorBridge } from '../../services/ResourceUseCoordinatorBridge';
import { TenantResourceService } from '../../services/TenantResourceService';
import {
  TenantServicePool,
  type TTenantServicePoolOptions,
} from '../../services/TenantServicePool';

type TLegacyActorPluginServices = Readonly<{
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  resourceOwner: ResourceServicePool;
}>;

type TLegacyActorAgentConfig = Readonly<{
  legacyActor: TLegacyActorAgentCapabilityFactory;
}>;

type TLegacyActorDiagnostics = Readonly<{
  legacyActorEnabled: boolean;
  activeLegacyProcessCount: number;
  activeLegacyTenantCount: number;
}>;

type TLegacyActorServicePoolOptions = Omit<
  TTenantServicePoolOptions<ActorService>,
  'key' | 'singlePlacementPerOrganization'
>;

type TLegacyActorComposition = Readonly<{
  onElementCreate: TAutomergeCallbacks['onElementCreate'];
  onElementDelete: TAutomergeCallbacks['onElementDelete'];
  agentConfig(tenant: TTenantContext): TLegacyActorAgentConfig;
  registerResourceUseBridge(
    tenant: TTenantContext,
    bridge: ResourceUseCoordinatorBridge,
  ): void;
  resolveResourceConsumer(tenant: TTenantContext): Promise<ActorService>;
}>;

function createDeferredActorService(
  load: () => Promise<TLegacyActorServiceCapability>,
): TLegacyActorServiceCapability {
  let pending: Promise<TLegacyActorServiceCapability> | null = null;
  const resolve = () => {
    if (pending) return pending;
    pending = load().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  return new Proxy({} as TLegacyActorServiceCapability, {
    get(_target, property) {
      if (property === 'then' || property === 'getVibecanvasJson') return undefined;
      if (typeof property !== 'string') return undefined;
      return (...args: unknown[]) => resolve().then((service) => {
        const method = Reflect.get(service, property, service);
        if (typeof method !== 'function') {
          throw new Error(`Actor service capability '${property}' is unavailable.`);
        }
        return Reflect.apply(method, service, args);
      });
    },
  });
}

class LegacyActorServicePool extends TenantServicePool<ActorService> {
  readonly #instances: ReadonlySet<ActorService>;
  readonly #agentCapabilities: ReadonlySet<ILegacyActorAgentCapability>;

  constructor(
    options: TLegacyActorServicePoolOptions,
    instances: ReadonlySet<ActorService>,
    agentCapabilities: ReadonlySet<ILegacyActorAgentCapability>,
  ) {
    super('legacy-actor-service-pool', {
      ...options,
      key: (tenant) => fnScopedKey('legacy-actor-service', [
        tenant.orgId,
        tenant.cellId,
        String(tenant.placementEpoch),
      ]),
      singlePlacementPerOrganization: true,
    });
    this.#instances = instances;
    this.#agentCapabilities = agentCapabilities;
  }

  diagnostics(): TLegacyActorDiagnostics {
    const serviceProcessCount = [...this.#instances].reduce(
      (count, service) => count + service.diagnostics().activeProcessCount,
      0,
    );
    const draftProcessCount = [...this.#agentCapabilities].reduce(
      (count, capability) => count + capability.diagnostics().activeProcessCount,
      0,
    );
    return {
      legacyActorEnabled: true,
      activeLegacyProcessCount: serviceProcessCount + draftProcessCount,
      activeLegacyTenantCount: this.getTenantCount(),
    };
  }
}

declare module '@vibecanvas/runtime' {
  interface IServiceMap {
    actor: LegacyActorServicePool;
  }
}

class LegacyActorPlugin implements
IPlugin<TLegacyActorPluginServices, ICliHooks, ICliConfig>,
TLegacyActorComposition {
  readonly name = 'legacy-actor';
  readonly #resourceUseBridges = new Map<string, ResourceUseCoordinatorBridge>();
  readonly #instances = new Set<ActorService>();
  readonly #agentCapabilities = new Set<ILegacyActorAgentCapability>();
  #pool: LegacyActorServicePool | null = null;
  #database: DbServiceTurso | null = null;
  #eventPublisher: IEventPublisherService | null = null;

  apply(ctx: Parameters<IPlugin<TLegacyActorPluginServices, ICliHooks, ICliConfig>['apply']>[0]): void {
    if (!ctx.config.legacyActorEnabled) return;
    if (this.#pool) throw new Error('LegacyActorPlugin was already applied.');

    const database = ctx.services.require('db');
    const eventPublisher = ctx.services.require('eventPublisher');
    const resourceOwner = ctx.services.require('resourceOwner');
    this.#database = database;
    this.#eventPublisher = eventPublisher;

    const pool = new LegacyActorServicePool({
      create: async (tenant) => {
        const organizationRoot = join(ctx.config.home.organizationsDir, tenant.orgId);
        const artifactsRoot = join(organizationRoot, 'artifacts');
        await mkdir(artifactsRoot, { recursive: true });
        const resourceService = new TenantResourceService(
          await resourceOwner.forTenant(tenant),
          tenant,
        );
        const service = new ActorService({
          db: database.forTenant(tenant),
          configPath: artifactsRoot,
          resourceService,
          eventPublisherService: eventPublisher.forTenant(tenant),
        });
        this.#instances.add(service);
        service.addStopCleanup(() => this.#instances.delete(service));
        const detachUseCoordinator = this.#resourceUseBridges
          .get(this.#resourceBridgeKey(tenant))
          ?.attach(service);
        if (detachUseCoordinator) service.addStopCleanup(detachUseCoordinator);
        return service;
      },
    }, this.#instances, this.#agentCapabilities);
    this.#pool = pool;
    ctx.services.provide('actor', 60, pool);
  }

  agentConfig(tenant: TTenantContext): TLegacyActorAgentConfig {
    const load = () => this.#requirePool().forTenant(tenant);
    return {
      legacyActor: createLegacyActorAgentCapabilityFactory({
        actorService: createDeferredActorService(load),
        resolvePublishedWidgetManifest: async (definitionName) => (
          (await load()).getVibecanvasJson(definitionName)
        ),
        onCreate: (capability) => this.#agentCapabilities.add(capability),
        onClose: (capability) => this.#agentCapabilities.delete(capability),
      }),
    };
  }

  registerResourceUseBridge(
    tenant: TTenantContext,
    bridge: ResourceUseCoordinatorBridge,
  ): void {
    this.#resourceUseBridges.set(this.#resourceBridgeKey(tenant), bridge);
  }

  resolveResourceConsumer(tenant: TTenantContext): Promise<ActorService> {
    return this.#requirePool().forTenant(tenant);
  }

  diagnostics(): TLegacyActorDiagnostics {
    return this.#pool?.diagnostics() ?? {
      legacyActorEnabled: false,
      activeLegacyProcessCount: 0,
      activeLegacyTenantCount: 0,
    };
  }

  readonly onElementCreate = async (
    event: TAutomergeElementEvent,
    handle: Parameters<TAutomergeCallbacks['onElementCreate']>[1],
  ): Promise<void> => {
    try {
      const element = event.element;
      if (element.data.type !== 'widget' || !element.data.actorDefinitionName) return;
      const database = this.#requireDatabase();
      const canvases = await database.canvas.listAll(event.tenantContext);
      const canvas = canvases.find((row) => row.automerge_url === event.automergeUrl);
      if (!canvas) return;

      const actor = await (await this.#requirePool().forTenant(event.tenantContext))
        .createInstance(element.data.actorDefinitionName, canvas.id, element.id);
      if (actor === null) return;

      handle.change((doc) => {
        const currentElement = doc.elements[element.id];
        if (!currentElement || currentElement.data.type !== 'widget') return;
        currentElement.data.actorInstanceId = actor.getId();
        currentElement.updatedAt = Date.now();
      });
    } catch (error) {
      this.#publishFailure(event, 'Failed to create widget actor', error);
    }
  };

  readonly onElementDelete = async (
    event: TAutomergeElementEvent,
  ): Promise<void> => {
    try {
      if (event.element.data.type !== 'widget') return;
      const instance = await this.#requireDatabase().actor.getInstanceByElementId(
        event.tenantContext,
        event.element.id,
      );
      if (!instance) return;
      await (await this.#requirePool().forTenant(event.tenantContext))
        .removeInstance(instance.id);
    } catch (error) {
      this.#publishFailure(event, 'Failed to remove widget actor', error);
    }
  };

  #resourceBridgeKey(tenant: TTenantContext): string {
    return fnScopedKey('resource-store', [
      tenant.orgId,
      tenant.cellId,
      String(tenant.placementEpoch),
    ]);
  }

  #requirePool(): LegacyActorServicePool {
    if (!this.#pool) throw new Error('Legacy actor compatibility is disabled.');
    return this.#pool;
  }

  #requireDatabase(): DbServiceTurso {
    if (!this.#database) throw new Error('Legacy actor compatibility is disabled.');
    return this.#database;
  }

  #publishFailure(
    event: TAutomergeElementEvent,
    title: string,
    error: unknown,
  ): void {
    this.#eventPublisher?.publishNotification(event.tenantContext, {
      type: 'error',
      title,
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

export { LegacyActorPlugin, LegacyActorServicePool, createDeferredActorService };
export type {
  TLegacyActorAgentConfig,
  TLegacyActorComposition,
  TLegacyActorDiagnostics,
  TLegacyActorPluginServices,
  TLegacyActorServicePoolOptions,
};
