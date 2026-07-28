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
import {
  type TVibecanvasCapsuleBuild,
  type TVibecanvasDistributionBuild,
} from '@vibecanvas/capsule-vibecanvas/builder';
import { buildCapsuleGuest } from '@vibecanvas/capsule-vibecanvas/build';
import {
  AgentService,
  PreviewBuildAdmission,
} from '@vibecanvas/service-agent';
import {
  CanvasService,
  CanvasServiceError,
  type ICanvasService,
} from '@vibecanvas/service-canvas';
import {
  planImplicitResourceSelections,
  planSelectedResourceBindings,
} from '@vibecanvas/service-agent/tools/resource-bindings';
import { CanvasItemStoreTurso } from '@vibecanvas/service-db/CanvasItemStoreTurso';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { FunctionControlStoreTurso } from '@vibecanvas/service-db/FunctionControlStoreTurso';
import { ResourceControlStoreTurso } from '@vibecanvas/service-db/ResourceControlStoreTurso';
import { WidgetInstanceStateStoreTurso } from '@vibecanvas/service-db/WidgetInstanceStateStoreTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import {
  WidgetStateService,
  type IWidgetStateService,
} from '@vibecanvas/service-widget-state';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'path';
import { fnScopedKey } from '@vibecanvas/tenant-core';
import type {
  IHumanResourceSecretService,
  TResourceApiCapability,
} from '@vibecanvas/api/resource/types';
import type { ICliConfig } from './config';
import { fnLocalRegistryNpmUserConfig } from './fn.local-registry-npm-userconfig';
import { OSS_FAKE_SESSION } from './plugins/auth/CONSTANTS';
import { fnCreateOssTenantContext } from './plugins/auth/fn.oss-tenant-context';
import { FunctionResourceGatewayFactory } from './services/FunctionResourceGatewayFactory';
import { fnWidgetCapsuleBuilderIdentity } from './services/fn.widget-capsule-builder-identity';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
} from './services/CONSTANTS';
import { WidgetCapsuleSigningKeyStore } from './services/WidgetCapsuleSigningKeyStore';
import {
  createWidgetNpmDistributionBuild,
  fnWidgetNpmBuildEnvironmentIdentity,
  resolveWidgetNpmBuildRunner,
} from './services/WidgetNpmDistributionBuild';
import {
  WidgetCapsuleHostConfigurationService,
} from './services/WidgetCapsuleHostConfigurationService';
import {
  FunctionService,
} from './services/FunctionService';
import {
  createFunctionInvocationCapability,
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
const DEFAULT_WIDGET_PREVIEW_BUILD_GLOBAL_CONCURRENCY = 4;
const FUNCTION_BOOTSTRAP_TENANT = fnCreateOssTenantContext({
  session: OSS_FAKE_SESSION,
  requestId: 'function-runtime-placement-bootstrap',
});
const TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS = Object.freeze([
  '@vibecanvas/sdk/server',
  'zod',
]);

function widgetPreviewBuildGlobalConcurrency(): number {
  const configured = process.env.VIBECANVAS_WIDGET_PREVIEW_BUILD_CONCURRENCY;
  if (configured === undefined) {
    return DEFAULT_WIDGET_PREVIEW_BUILD_GLOBAL_CONCURRENCY;
  }
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) {
    throw new Error(
      'VIBECANVAS_WIDGET_PREVIEW_BUILD_CONCURRENCY must be an integer from 1 to 64.',
    );
  }
  return value;
}

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
  canvas: ICanvasService;
  widgetState: IWidgetStateService;
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  resourceOwner: ResourceServicePool;
  resource: TResourceApiCapability;
  humanResourceSecret: IHumanResourceSecretService;
  widgetOwner: WidgetServicePool;
  widget: TWidgetServiceCapability;
  widgetCapsuleHostConfiguration: WidgetCapsuleHostConfigurationService;
  widgetRuntimeLoadAdmission: WidgetRuntimeLoadAdmission;
  functionOwner: FunctionServicePool;
  functionInvocation: IFunctionInvocationApiCapability;
  agent: TenantServicePool<AgentService>;
}

declare module '@vibecanvas/runtime' {
  interface IServiceMap extends IRuntimeServices { }
}

type TSetupServicesOptions = Readonly<{
  capsuleBuild?: TVibecanvasCapsuleBuild;
  distributionBuild?: TVibecanvasDistributionBuild;
  distributionBuildEnvironmentIdentity?: string;
  createFunctionSandboxDriver?: (args: Readonly<{
    compiledExecutable: boolean;
    tempRoot: string;
  }>) => BunChildSandboxDriver;
}>;

function setupServices(config: ICliConfig, options: TSetupServicesOptions = {}) {
  const services = createServiceRegistry();
  const previewBuildAdmission = new PreviewBuildAdmission({
    maxActivePerTenant: 2,
    maxActiveGlobal: widgetPreviewBuildGlobalConcurrency(),
  });
  const eventPublisher = new EventPublisherService();
  const npmUserConfigPath = fnLocalRegistryNpmUserConfig({
    homeDirectory: homedir(),
    stateDirectory: process.env.VIBECANVAS_REGISTRY_STATE_DIR,
    join,
  });
  services.provide('eventPublisher', 10, eventPublisher);

  const shouldSetupStatefulServices = !config.helpRequested
    && !config.versionRequested
    && config.command === 'serve';

  if (!shouldSetupStatefulServices) {
    return { services, eventPublisher };
  }

  const distributionBuildSetup = (() => {
    const injected = options.distributionBuild;
    if (injected !== undefined) {
      return {
        create: (_scratchDirectory: string): TVibecanvasDistributionBuild => injected,
        environmentIdentity: options.distributionBuildEnvironmentIdentity
          ?? fnWidgetNpmBuildEnvironmentIdentity({
            runnerIdentity: 'injected-v1',
            nodeVersion: 'injected',
            npmVersion: 'injected',
            platform: 'injected',
            architecture: 'injected',
            toolchainPinnedByRunner: true,
          }),
      };
    }
    const runner = resolveWidgetNpmBuildRunner({
      env: process.env,
      npmUserConfigPath,
      ...(
        typeof process.getuid === 'function'
        && typeof process.getgid === 'function'
          ? { user: `${process.getuid()}:${process.getgid()}` }
          : {}
      ),
    });
    const toolchainPinnedByRunner = runner.kind === 'docker';
    return {
      create: (scratchDirectory: string): TVibecanvasDistributionBuild => (
        createWidgetNpmDistributionBuild({
          scratchDirectory,
          npmUserConfigPath,
          runProcess: runner.runProcess,
          runnerIdentity: runner.identity,
        })
      ),
      environmentIdentity: fnWidgetNpmBuildEnvironmentIdentity({
        runnerIdentity: runner.identity,
        nodeVersion: toolchainPinnedByRunner ? 'runner-pinned' : process.version,
        npmVersion: toolchainPinnedByRunner
          ? 'runner-pinned'
          : process.versions.npm ?? 'external',
        platform: toolchainPinnedByRunner ? 'linux' : process.platform,
        architecture: process.arch,
        toolchainPinnedByRunner,
      }),
    };
  })();
  const dbService = new DbServiceTurso({
    databasePath: config.home.mainDbPath,
    dataDir: config.home.homeDir,
    cacheDir: config.home.cacheRoot,
    silentMigrations: process.env.VIBECANVAS_SILENT_DB_MIGRATIONS === '1',
  });
  const widgetBuilderIdentity = fnWidgetCapsuleBuilderIdentity({
    npmVersion: process.versions.npm ?? 'external',
    serverBunVersion: Bun.version,
  });
  const widgetCapsuleSigningKeys = new WidgetCapsuleSigningKeyStore(
    join(config.home.homeDir, 'keys'),
  );
  const widgetCapsuleHostConfiguration = new WidgetCapsuleHostConfigurationService(
    widgetCapsuleSigningKeys,
  );
  const functionStore = new FunctionControlStoreTurso(dbService.db);
  const functionSchemas = new JsonSchemaFunctionValidator();
  const functionWriteCapabilities = new ResourceWriteCapabilityAuthority({
    secret: randomBytes(32),
    permits: functionStore,
  });
  services.provide('db', 20, dbService);

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
        buildEnvironmentIdentity: distributionBuildSetup.environmentIdentity,
        capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
        buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
        capsuleBuild: options.capsuleBuild ?? buildCapsuleGuest,
        distributionBuild: distributionBuildSetup.create(buildTempRoot),
        loadCapsuleSigningKeys: (purpose) => (
          widgetCapsuleSigningKeys.loadSigningKeys(purpose)
        ),
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
      return new ResourceService({
        tenant,
        db: dbService.forTenant(tenant),
        controlStore: new ResourceControlStoreTurso(dbService.db),
        dataRoot: resourcesRoot,
        useCoordinator,
        writeCapabilityVerifier: functionWriteCapabilities,
        writePermitCoordinator: functionStore,
      });
    },
  });
  const resourceCapabilities = createResourceServiceCapabilities(resourceService);
  const functionResourceGateways = new FunctionResourceGatewayFactory({
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
      const driver = options.createFunctionSandboxDriver?.({
        compiledExecutable: config.compiled,
        tempRoot: runtimeTempRoot,
      }) ?? new BunChildSandboxDriver({
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
      return new AgentService({
        dataPath: agentRoot,
        npmUserConfigPath,
        cachePath: cacheRoot,
        configPath: artifactsRoot,
        eventPublisherService: eventPublisher.forTenant(tenant),
        tenant,
        authoringStore: widgetOwner.authoringStore,
        widgetAuthoringCapability,
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
        widgetCapsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
        widgetBuildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
        previewBuildAdmission,
        listPublishedWidgetPlacements: () => (
          widgetCapability.listPublishedPlacements(tenant)
        ),
        resolvePublishedWidgetPlacement: (target) => (
          widgetCapability.resolvePublishedPlacement(tenant, target)
        ),
      });
    },
  });

  const canvasService = new CanvasService({
    store: new CanvasItemStoreTurso(dbService.db),
    clock: { nowMs: () => Date.now() },
    authorize: async (tenant, access) => {
      const canvas = await dbService.canvas.findById(tenant, { id: access.canvasId });
      if (canvas === null) {
        throw new CanvasServiceError(
          'FORBIDDEN',
          `The tenant is not a member of canvas '${access.canvasId}'.`,
        );
      }
      if (access.access === 'read') return;
      const members = await dbService.canvas.listMembers(tenant, {
        canvasId: access.canvasId,
      });
      const membership = members.find((member) => member.account_id === tenant.accountId);
      if (membership?.role !== 'owner' && membership?.role !== 'editor') {
        throw new CanvasServiceError(
          'FORBIDDEN',
          `The tenant cannot edit canvas '${access.canvasId}'.`,
        );
      }
    },
  });
  const widgetStateService = new WidgetStateService(
    new WidgetInstanceStateStoreTurso(dbService.db),
  );
  services.provide('canvas', 49, canvasService);
  services.provide('widgetState', 50, widgetStateService);
  services.provide('widgetOwner', 55, widgetService);
  services.provide('widget', 56, widgetCapability);
  services.provide(
    'widgetCapsuleHostConfiguration',
    57,
    widgetCapsuleHostConfiguration,
  );
  services.provide('widgetRuntimeLoadAdmission', 57, widgetRuntimeLoadAdmission);
  services.provide('resourceOwner', 58, resourceService);
  services.provide('resource', 59, resourceCapabilities.resource);
  services.provide('humanResourceSecret', 59, resourceCapabilities.humanSecret);
  services.provide('functionOwner', 61, functionService);
  services.provide('functionInvocation', 61, functionCapability);
  services.provide('agent', 62, agentService);

  return {
    services,
    canvasService,
    dbService,
    eventPublisher,
    resourceService,
    functionService,
    widgetService,
    widgetStateService,
  };
}

export { setupServices };
export type { TSetupServicesOptions };
