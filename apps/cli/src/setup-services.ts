import { createServiceRegistry } from '@vibecanvas/runtime';
import { ActorService } from '@vibecanvas/service-actor';
import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeService';
import { AgentService } from '@vibecanvas/service-agent';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '@vibecanvas/service-db/ResourceControlStoreTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { FilesystemServiceNode } from '@vibecanvas/service-filesystem/FilesystemServiceNode';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import { PtyServiceBunPty } from '@vibecanvas/service-pty/PtyServiceBunPty';
import { mkdir } from 'node:fs/promises';
import { join } from 'path';
import { fnScopedKey } from '@vibecanvas/tenant-core';
import type {
  IHumanResourceSecretService,
  TResourceApiCapability,
} from '@vibecanvas/api/resource/types';
import type { ICliConfig } from './config';
import { ResourceService } from './services/ResourceService';
import {
  createResourceServiceCapabilities,
  ResourceServicePool,
} from './services/ResourceServicePool';
import { ResourceUseCoordinatorBridge } from './services/ResourceUseCoordinatorBridge';
import { TenantServicePool } from './services/TenantServicePool';
import { TenantResourceService } from './services/TenantResourceService';

export interface IRuntimeServices {
  automerge: IAutomergeService;
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  filesystem: IFilesystemService;
  pty: IPtyService;
  resourceOwner: ResourceServicePool;
  resource: TResourceApiCapability;
  humanResourceSecret: IHumanResourceSecretService;
  actor: TenantServicePool<ActorService>;
  agent: TenantServicePool<AgentService>;
}

declare module '@vibecanvas/runtime' {
  interface IServiceMap extends IRuntimeServices { }
}

function setupServices(config: ICliConfig) {
  const services = createServiceRegistry();
  const eventPublisher = new EventPublisherService();
  services.provide('eventPublisher', 10, eventPublisher);

  const shouldSetupStatefulServices = !config.helpRequested
    && !config.versionRequested
    && config.command === 'serve';

  if (!shouldSetupStatefulServices) {
    return { services, eventPublisher };
  }

  const dbService = new DbServiceTurso({
    databasePath: config.home.mainDbPath,
    dataDir: config.home.homeDir,
    cacheDir: config.home.cacheRoot,
    silentMigrations: process.env.VIBECANVAS_SILENT_DB_MIGRATIONS === '1',
  });
  const filesystemService = new FilesystemServiceNode(eventPublisher);
  const ptyService = new PtyServiceBunPty({
    resolveWorkingDirectory: (tenant, args) => filesystemService.resolveHostPath(tenant, args),
  });

  services.provide('db', 20, dbService);
  services.provide('filesystem', 30, filesystemService);
  services.provide('pty', 40, ptyService);

  const resourceBridgeKey = (tenant: Parameters<DbServiceTurso['forTenant']>[0]) => fnScopedKey(
    'resource-store',
    [tenant.orgId, tenant.cellId, String(tenant.placementEpoch)],
  );
  const resourceUseBridges = new Map<string, ResourceUseCoordinatorBridge>();
  let actorService: TenantServicePool<ActorService>;
  const resourceService = new ResourceServicePool({
    create: async (tenant) => {
      const organizationRoot = join(config.home.organizationsDir, tenant.orgId);
      const resourcesRoot = join(organizationRoot, 'resources');
      await mkdir(resourcesRoot, { recursive: true });
      const useCoordinator = new ResourceUseCoordinatorBridge();
      resourceUseBridges.set(resourceBridgeKey(tenant), useCoordinator);
      return new ResourceService({
        tenant,
        db: dbService.forTenant(tenant),
        controlStore: new ResourceControlStoreTurso(dbService.db),
        dataRoot: resourcesRoot,
        useCoordinator,
        resolveConsumer: () => actorService.forTenant(tenant),
      });
    },
  });
  const resourceCapabilities = createResourceServiceCapabilities(resourceService);
  actorService = new TenantServicePool<ActorService>('actor-service-pool', {
    create: async (tenant) => {
      const organizationRoot = join(config.home.organizationsDir, tenant.orgId);
      const artifactsRoot = join(organizationRoot, 'artifacts');
      await mkdir(artifactsRoot, { recursive: true });
      const tenantDb = dbService.forTenant(tenant);
      const sharedResources = new TenantResourceService(
        await resourceService.forTenant(tenant),
        tenant,
      );
      const service = new ActorService({
        db: tenantDb,
        configPath: artifactsRoot,
        resourceService: sharedResources,
        eventPublisherService: eventPublisher.forTenant(tenant),
      });
      const detachUseCoordinator = resourceUseBridges.get(resourceBridgeKey(tenant))?.attach(service);
      if (detachUseCoordinator) service.addStopCleanup(detachUseCoordinator);
      return service;
    },
  });
  const agentService = new TenantServicePool<AgentService>('agent-service-pool', {
    create: async (tenant) => {
      const organizationRoot = join(config.home.organizationsDir, tenant.orgId);
      const artifactsRoot = join(organizationRoot, 'artifacts');
      const agentRoot = join(organizationRoot, 'agent', tenant.accountId);
      const cacheRoot = join(config.home.cacheRoot, 'tenants', tenant.orgId, tenant.accountId);
      await Promise.all([
        mkdir(artifactsRoot, { recursive: true }),
        mkdir(agentRoot, { recursive: true }),
        mkdir(cacheRoot, { recursive: true }),
      ]);
      return new AgentService({
        dataPath: agentRoot,
        cachePath: cacheRoot,
        configPath: artifactsRoot,
        eventPublisherService: eventPublisher.forTenant(tenant),
        actorService: await actorService.forTenant(tenant),
      });
    },
  });

  const automergeService = new AutomergeService(dbService.db, {
    async authorizeDocument(tenant, automergeUrl) {
      const canvases = await dbService.canvas.listAll(tenant);
      return canvases.some((canvas) => canvas.automerge_url === automergeUrl);
    },
    async onElementCreate(event, handle) {
      try {
        const element = event.element;
        if (element.data.type !== 'widget' || !element.data.actorDefinitionName) return;

        const tenant = event.tenantContext;
        const canvases = await dbService.canvas.listAll(tenant);
        const canvas = canvases.find(row => row.automerge_url === event.automergeUrl);
        if (!canvas) return;

        const actor = await (await actorService.forTenant(tenant))
          .createInstance(element.data.actorDefinitionName, canvas.id, element.id)
        if (actor === null) return

        handle.change((doc) => {
          const currentElement = doc.elements[element.id];
          if (!currentElement) return;
          if (currentElement.data.type !== 'widget') return;

          currentElement.data.actorInstanceId = actor.getId();
          currentElement.updatedAt = Date.now();
        });
      } catch (error) {
        eventPublisher.publishNotification(event.tenantContext, {
          type: 'error',
          title: 'Failed to create widget actor',
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async onElementDelete(event, handle) {
      try {
        const element = event.element;
        if (element.data.type === 'widget') {
          const tenant = event.tenantContext;
          const instance = await dbService.actor.getInstanceByElementId(tenant, event.element.id)
          if (!instance) return
          await (await actorService.forTenant(tenant)).removeInstance(instance.id)
        }
      } catch (error) {
        eventPublisher.publishNotification(event.tenantContext, {
          type: 'error',
          title: 'Failed to remove widget actor',
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
  },
  );
  services.provide('automerge', 50, automergeService);
  services.provide('resourceOwner', 58, resourceService);
  services.provide('resource', 59, resourceCapabilities.resource);
  services.provide('humanResourceSecret', 59, resourceCapabilities.humanSecret);
  services.provide('actor', 60, actorService);
  services.provide('agent', 62, agentService);

  return {
    services,
    automergeService,
    dbService,
    eventPublisher,
    filesystemService,
    ptyService,
    resourceService,
  };
}

export { setupServices };
