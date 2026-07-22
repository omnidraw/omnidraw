import { isValidAutomergeUrl } from '@automerge/automerge-repo';
import { createServiceRegistry } from '@vibecanvas/runtime';
import { randomBytes, randomUUID } from 'node:crypto';
import type { IFunctionInvocationApiCapability } from '@vibecanvas/api/function';
import {
  BunChildFunctionDescriptorExtractor,
  BunChildSandboxDriver,
  FunctionExecutor,
  JsonSchemaFunctionValidator,
  LocalFunctionDispatcher,
  ResourceWriteCapabilityAuthority,
} from '@vibecanvas/function-runtime/local';
import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeService';
import { WidgetInstanceMetadataProjector } from '@vibecanvas/service-automerge/projection';
import { AgentService } from '@vibecanvas/service-agent';
import {
  planImplicitResourceSelections,
  planSelectedResourceBindings,
} from '@vibecanvas/service-agent/tools/resource-bindings';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { FunctionControlStoreTurso } from '@vibecanvas/service-db/FunctionControlStoreTurso';
import { ResourceControlStoreTurso } from '@vibecanvas/service-db/ResourceControlStoreTurso';
import { WidgetInstanceMetadataStoreTurso } from '@vibecanvas/service-db/WidgetInstanceMetadataStoreTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { FilesystemServiceNode } from '@vibecanvas/service-filesystem/FilesystemServiceNode';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import { PtyServiceBunPty } from '@vibecanvas/service-pty/PtyServiceBunPty';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'path';
import { fnScopedKey } from '@vibecanvas/tenant-core';
import type {
  IHumanResourceSecretService,
  TResourceApiCapability,
} from '@vibecanvas/api/resource/types';
import type { ICliConfig } from './config';
import type { TLegacyActorComposition } from './plugins/legacy-actor/LegacyActorPlugin';
import { OSS_FAKE_SESSION } from './plugins/auth/CONSTANTS';
import { fnCreateOssTenantContext } from './plugins/auth/fn.oss-tenant-context';
import { FunctionResourceGatewayFactory } from './services/FunctionResourceGatewayFactory';
import {
  FunctionService,
  type TPreviewFunctionInvocationCapability,
} from './services/FunctionService';
import {
  createFunctionInvocationCapability,
  createPreviewFunctionInvocationCapability,
  FunctionServicePool,
} from './services/FunctionServicePool';
import { ResourceService } from './services/ResourceService';
import { createAgentResourceService } from './services/AgentResourceService';
import {
  createResourceServiceCapabilities,
  ResourceServicePool,
} from './services/ResourceServicePool';
import { ResourceUseCoordinatorBridge } from './services/ResourceUseCoordinatorBridge';
import { TenantServicePool } from './services/TenantServicePool';
import { WidgetService } from './services/WidgetService';
import { WidgetFunctionArtifactReader } from './services/WidgetFunctionArtifactReader';
import { WidgetRuntimeLoadAdmission } from './services/WidgetRuntimeLoadAdmission';
import {
  createWidgetAuthoringCapability,
  createWidgetServerArtifactCapability,
  createWidgetServiceCapability,
  WidgetServicePool,
  type TWidgetServiceCapability,
} from './services/WidgetServicePool';

const WIDGET_ARTIFACT_READ_MAXIMUM_TTL_MS = 5 * 60 * 1_000;
const FUNCTION_BOOTSTRAP_TENANT = fnCreateOssTenantContext({
  session: OSS_FAKE_SESSION,
  requestId: 'function-runtime-placement-bootstrap',
});
const TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS = Object.freeze([
  '@arrow-js/core',
  '@vibecanvas/sdk/server',
  '@vibecanvas/sdk/function-client',
  '@vibecanvas/sdk/widget',
  'zod',
]);

function resolveTrustedWidgetBuildPackageImport(specifier: string): string {
  if (!TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS.includes(specifier)) {
    throw new Error(`Widget build package '${specifier}' is not trusted by the host.`);
  }
  // Bun 1.3.x can flatten Zod's ESM `util` namespace into an invalid server
  // artifact. The package's equivalent CJS entry bundles deterministically.
  if (specifier === 'zod') {
    return join(dirname(Bun.resolveSync('zod/package.json', import.meta.dir)), 'index.cjs');
  }
  return Bun.resolveSync(specifier, import.meta.dir);
}

export interface IRuntimeServices {
  automerge: IAutomergeService;
  widgetInstanceProjection: WidgetInstanceMetadataProjector;
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  filesystem: IFilesystemService;
  pty: IPtyService;
  resourceOwner: ResourceServicePool;
  resource: TResourceApiCapability;
  humanResourceSecret: IHumanResourceSecretService;
  widgetOwner: WidgetServicePool;
  widget: TWidgetServiceCapability;
  widgetRuntimeLoadAdmission: WidgetRuntimeLoadAdmission;
  functionOwner: FunctionServicePool;
  functionInvocation: IFunctionInvocationApiCapability;
  previewFunctionInvocation: TPreviewFunctionInvocationCapability;
  agent: TenantServicePool<AgentService>;
}

declare module '@vibecanvas/runtime' {
  interface IServiceMap extends IRuntimeServices { }
}

type TSetupServicesOptions = Readonly<{
  legacyActor?: TLegacyActorComposition;
}>;

function setupServices(config: ICliConfig, options: TSetupServicesOptions = {}) {
  const services = createServiceRegistry();
  const legacyActor = options.legacyActor;
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
  const widgetBuilderIdentity = `vibecanvas-widget-bun/${Bun.version}`;
  const filesystemService = new FilesystemServiceNode(eventPublisher);
  const functionStore = new FunctionControlStoreTurso(dbService.db);
  const functionSchemas = new JsonSchemaFunctionValidator();
  const functionWriteCapabilities = new ResourceWriteCapabilityAuthority({
    secret: randomBytes(32),
    permits: functionStore,
  });
  const ptyService = new PtyServiceBunPty({
    resolveWorkingDirectory: (tenant, args) => filesystemService.resolveHostPath(tenant, args),
  });

  services.provide('db', 20, dbService);
  services.provide('filesystem', 30, filesystemService);
  services.provide('pty', 40, ptyService);

  const widgetService = new WidgetServicePool({
    create: async (tenant) => {
      const organizationRoot = join(config.home.organizationsDir, tenant.orgId);
      const artifactsRoot = join(organizationRoot, 'artifacts');
      const buildTempRoot = join(organizationRoot, 'temp', 'widget-builds');
      const functionTempRoot = join(organizationRoot, 'temp', 'widget-functions');
      await Promise.all([
        mkdir(artifactsRoot, { recursive: true, mode: 0o700 }),
        mkdir(buildTempRoot, { recursive: true, mode: 0o700 }),
        mkdir(functionTempRoot, { recursive: true, mode: 0o700 }),
      ]);
      return new WidgetService({
        placement: tenant,
        database: dbService.db,
        artifactsRoot,
        buildTempRoot,
        builderIdentity: widgetBuilderIdentity,
        artifactReadSecret: randomBytes(32),
        artifactReadMaximumTtlMs: WIDGET_ARTIFACT_READ_MAXIMUM_TTL_MS,
        compiledExecutable: config.compiled,
        functionDescriptorExtractor: new BunChildFunctionDescriptorExtractor({
          compiledExecutable: config.compiled,
          tempRoot: functionTempRoot,
        }),
        resolveTrustedPackageImport: resolveTrustedWidgetBuildPackageImport,
      });
    },
  });
  const widgetCapability = createWidgetServiceCapability(widgetService);
  const widgetAuthoringCapability = createWidgetAuthoringCapability(widgetService);
  const widgetRuntimeLoadAdmission = new WidgetRuntimeLoadAdmission();
  const widgetServerArtifacts = createWidgetServerArtifactCapability(widgetService);
  const functionArtifactReader = new WidgetFunctionArtifactReader({
    widgets: widgetServerArtifacts,
  });

  const resourceService = new ResourceServicePool({
    create: async (tenant) => {
      const organizationRoot = join(config.home.organizationsDir, tenant.orgId);
      const resourcesRoot = join(organizationRoot, 'resources');
      await mkdir(resourcesRoot, { recursive: true });
      const useCoordinator = new ResourceUseCoordinatorBridge();
      legacyActor?.registerResourceUseBridge(tenant, useCoordinator);
      return new ResourceService({
        tenant,
        db: dbService.forTenant(tenant),
        controlStore: new ResourceControlStoreTurso(dbService.db),
        dataRoot: resourcesRoot,
        useCoordinator,
        resolveConsumer: legacyActor
          ? () => legacyActor.resolveResourceConsumer(tenant)
          : undefined,
        writeCapabilityVerifier: functionWriteCapabilities,
        writePermitCoordinator: functionStore,
      });
    },
  });
  const resourceCapabilities = createResourceServiceCapabilities(resourceService);
  const functionResourceGateways = new FunctionResourceGatewayFactory({
    database: dbService.db,
    resources: resourceService,
    widgets: widgetServerArtifacts,
    permits: functionStore,
    writeCapabilities: functionWriteCapabilities,
  });
  const functionService = new FunctionServicePool({
    bootstrapTenants: [FUNCTION_BOOTSTRAP_TENANT],
    create: async (tenant) => {
      const runtimeTempRoot = join(
        config.home.organizationsDir,
        tenant.orgId,
        'temp',
        'function-runtime',
      );
      await mkdir(runtimeTempRoot, { recursive: true, mode: 0o700 });
      const workerId = fnScopedKey('function-worker', [
        tenant.orgId,
        tenant.cellId,
        String(tenant.placementEpoch),
      ]);
      const driver = new BunChildSandboxDriver({
        compiledExecutable: config.compiled,
        tempRoot: runtimeTempRoot,
      });
      const executor = new FunctionExecutor({
        workerId,
        store: functionStore,
        artifacts: functionArtifactReader,
        resources: functionResourceGateways,
        driver,
        schemas: functionSchemas,
      });
      const dispatcher = new LocalFunctionDispatcher({
        orgId: tenant.orgId,
        cellId: tenant.cellId,
        placementEpoch: tenant.placementEpoch,
        recoveryTenant: tenant,
        workerId,
        schedulingDomain: fnScopedKey('function-scheduling-domain', [
          tenant.orgId,
          tenant.cellId,
          String(tenant.placementEpoch),
        ]),
        memoryTiers: ['small', 'medium', 'large'],
        store: functionStore,
        scheduler: functionStore,
        executor,
        schemas: functionSchemas,
      });
      return new FunctionService({
        placement: tenant,
        database: dbService.db,
        store: functionStore,
        dispatcher,
      });
    },
  });
  const functionCapability = createFunctionInvocationCapability(functionService);
  const previewFunctionCapability = createPreviewFunctionInvocationCapability(functionService);
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
      const widgetOwner = await widgetService.forTenant(tenant);
      const agentResources = createAgentResourceService(
        await resourceService.forTenant(tenant),
        tenant,
      );
      const legacyAgentConfig = legacyActor?.agentConfig(tenant);
      return new AgentService({
        dataPath: agentRoot,
        cachePath: cacheRoot,
        configPath: artifactsRoot,
        eventPublisherService: eventPublisher.forTenant(tenant),
        tenant,
        authoringStore: widgetOwner.authoringStore,
        widgetAuthoringCapability,
        previewFunctionCapability,
        resourceService: agentResources,
        resolveWidgetResourceBindings: async (
          resolutionTenant,
          { manifest, selectedResources },
        ) => {
          let resources;
          if (selectedResources === undefined) {
            const available = (await agentResources.listResources!({
              status: 'ready',
            })).map((resource) => ({
              id: resource.id,
              kind: resource.kind,
              name: resource.name,
              status: resource.status,
            }));
            const implicit = planImplicitResourceSelections(manifest, available);
            if (!implicit.ok) throw new Error(implicit.message);
            resources = implicit.resources;
          } else {
            resources = await Promise.all(selectedResources.map(async (selection) => {
              const current = await agentResources.getResource!(selection.id);
              if (!current) {
                throw new Error(`Selected resource is no longer available: ${selection.id}`);
              }
              return {
                id: current.id,
                kind: current.kind,
                name: current.name,
                status: current.status,
              };
            }));
          }
          const planned = planSelectedResourceBindings(manifest, resources);
          if (!planned.ok) throw new Error(planned.message);
          return planned.bindings.map((binding) => ({
            slot: binding.slot,
            resourceId: binding.resource.id,
            kind: binding.resource.kind,
            allowRead: binding.scope.includes('read'),
            allowWrite: binding.scope.includes('write'),
          }));
        },
        createId: randomUUID,
        nowMs: Date.now,
        widgetBuilderIdentity,
        ...legacyAgentConfig,
        listPublishedWidgetPlacements: () => (
          widgetCapability.listPublishedPlacements(tenant)
        ),
        resolvePublishedWidgetPlacement: (target) => (
          widgetCapability.resolvePublishedPlacement(tenant, target)
        ),
      });
    },
  });

  const widgetInstanceProjection = new WidgetInstanceMetadataProjector({
    store: new WidgetInstanceMetadataStoreTurso(dbService.db, {
      isCanonicalStateDocumentId: (candidate) => (
        isValidAutomergeUrl(candidate) && !candidate.includes('#')
      ),
    }),
    nowMs: () => Date.now(),
  });
  services.provide('widgetInstanceProjection', 49, widgetInstanceProjection);

  const automergeService = new AutomergeService(dbService.db, {
    // Exact OSS document access is resolved once by the storage authority so
    // WebSocket admission and durable validation cannot drift.
    authorizeDocument: () => true,
    onElementCreate: legacyActor?.onElementCreate ?? (() => undefined),
    onElementDelete: legacyActor?.onElementDelete ?? (() => undefined),
    onDocumentSnapshot(event) {
      const result = widgetInstanceProjection.enqueue(event.tenantContext, {
        canvasId: event.canvasId,
        sourceSequence: event.sourceSequence,
        elements: event.elements,
      });
      if (result.status === 'rejected') {
        throw new Error(`Widget instance projection rejected durable canvas state: ${result.reason}`);
      }
      if (result.status === 'quarantined') {
        eventPublisher.publishNotification(event.tenantContext, {
          type: 'error',
          title: 'Widget metadata projection quarantined',
          description: `${result.canvasId}@${result.sourceSequence ?? 'invalid'}: ${result.reason}`,
        });
      }
    },
    async onDocumentRelease(event) {
      if (event.canvasId === null) return;
      await widgetInstanceProjection.release(event.tenantContext, event.canvasId);
    },
  },
  );
  services.provide('automerge', 50, automergeService);
  services.provide('widgetOwner', 55, widgetService);
  services.provide('widget', 56, widgetCapability);
  services.provide('widgetRuntimeLoadAdmission', 57, widgetRuntimeLoadAdmission);
  services.provide('resourceOwner', 58, resourceService);
  services.provide('resource', 59, resourceCapabilities.resource);
  services.provide('humanResourceSecret', 59, resourceCapabilities.humanSecret);
  services.provide('functionOwner', 61, functionService);
  services.provide('functionInvocation', 61, functionCapability);
  services.provide('previewFunctionInvocation', 61, previewFunctionCapability);
  services.provide('agent', 62, agentService);

  return {
    services,
    automergeService,
    dbService,
    eventPublisher,
    filesystemService,
    ptyService,
    resourceService,
    functionService,
    widgetService,
  };
}

export { setupServices };
export type { TSetupServicesOptions };
