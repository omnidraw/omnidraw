import { createServiceRegistry } from '@omnidraw/runtime';
import { createHash, randomBytes } from 'node:crypto';
import type { IFunctionInvocationApiCapability } from '@omnidraw/api/function';
import {
  BunChildFunctionDescriptorExtractor,
  BunChildSandboxDriver,
  DirectFunctionExecutor,
  EphemeralResourceWritePermitAuthority,
  JsonSchemaFunctionValidator,
} from '@omnidraw/function-runtime/local';
import {
  AgentService,
  WidgetFilesystemBuildService,
  type TWidgetFilesystemCapsuleInspection,
} from '@omnidraw/service-agent';
import {
  type TOmnidrawCapsuleBuild,
  type TOmnidrawDistributionBuild,
} from '@omnidraw/capsule-omnidraw/builder';
import {
  WidgetArtifactBuilderCapsule,
  buildCapsuleGuest,
} from '@omnidraw/capsule-omnidraw/build';
import {
  CanvasService,
  CanvasServiceError,
  type ICanvasService,
} from '@omnidraw/service-canvas';
import { CanvasItemStoreTurso } from '@omnidraw/service-db/CanvasItemStoreTurso';
import { DbServiceTurso } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '@omnidraw/service-db/ResourceControlStoreTurso';
import { WidgetInstanceStateStoreTurso } from '@omnidraw/service-db/WidgetInstanceStateStoreTurso';
import { EventPublisherService } from '@omnidraw/service-event-publisher/EventPublisherService';
import type { IEventPublisherService } from '@omnidraw/service-event-publisher/IEventPublisherService';
import {
  WidgetStateService,
  type IWidgetStateService,
} from '@omnidraw/service-widget-state';
import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'path';
import { txEnsureOmnidrawHome } from '@omnidraw/shared-functions/omnidraw-config/tx.ensure-omnidraw-home';
import rootPackage from '../../../package.json';
import sdkPackage from '../../../packages/sdk/package.json';
import type {
  IHumanResourceSecretService,
  TResourceApiCapability,
} from '@omnidraw/api/resource/types';
import { DEFAULT_OSS_CELL_ID } from '@omnidraw/service-db/CONSTANTS';
import type { ICliConfig } from './config';
import { fnLocalRegistryNpmUserConfig } from './fn.local-registry-npm-userconfig';
import { createBunAgentBashCapability } from './services/AgentBashCapability';
import { fnWidgetCapsuleBuilderIdentity } from './services/fn.widget-capsule-builder-identity';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
  WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
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
import { ResourceService } from './services/ResourceService';
import { createAgentResourceService } from './services/AgentResourceService';
import {
  createResourceServiceCapabilities,
} from './services/ResourceServiceCapabilities';
import { ResourceUseCoordinatorBridge } from './services/ResourceUseCoordinatorBridge';
import { WidgetRuntimeLoadAdmission } from './services/WidgetRuntimeLoadAdmission';
import { WidgetFilesystemRuntimeCatalog } from './services/WidgetFilesystemRuntimeCatalog';
import { WidgetReleaseAttestationService } from './services/WidgetReleaseAttestationService';
import { LocalWidgetPackageRegistrySync } from './services/LocalWidgetPackageRegistrySync';

const TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS = Object.freeze([
  '@omnidraw/sdk/server',
  'zod',
]);

function resolveTrustedWidgetBuildPackageImport(specifier: string): string {
  if (!TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS.includes(specifier)) {
    throw new Error(`Widget build package '${specifier}' is not trusted by the host.`);
  }
  // Bun can flatten Zod's ESM `util` namespace into an invalid server
  // artifact. The package's equivalent CJS entry bundles deterministically.
  if (specifier === 'zod') {
    return join(dirname(Bun.resolveSync('zod/package.json', import.meta.dir)), 'index.cjs');
  }
  return Bun.resolveSync(specifier, import.meta.dir);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface IRuntimeServices {
  canvas: ICanvasService;
  widgetState: IWidgetStateService;
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  resourceOwner: ResourceService;
  resource: TResourceApiCapability;
  humanResourceSecret: IHumanResourceSecretService;
  widgetCapsuleHostConfiguration: WidgetCapsuleHostConfigurationService;
  widgetRuntimeLoadAdmission: WidgetRuntimeLoadAdmission;
  widgetCatalog: WidgetFilesystemRuntimeCatalog;
  functionOwner: FunctionService;
  functionInvocation: IFunctionInvocationApiCapability;
  agent: AgentService;
}

declare module '@omnidraw/runtime' {
  interface IServiceMap extends IRuntimeServices { }
}

type TSetupServicesOptions = Readonly<{
  capsuleBuild?: TOmnidrawCapsuleBuild;
  distributionBuild?: TOmnidrawDistributionBuild;
  distributionBuildEnvironmentIdentity?: string;
  createFunctionSandboxDriver?: (args: Readonly<{
    compiledExecutable: boolean;
    tempRoot: string;
  }>) => BunChildSandboxDriver;
}>;

function setupServices(config: ICliConfig, options: TSetupServicesOptions = {}) {
  const services = createServiceRegistry();
  const eventPublisher = new EventPublisherService();
  const npmUserConfigPath = fnLocalRegistryNpmUserConfig({
    homeDirectory: homedir(),
    localDevelopment: config.dev && process.env.NODE_ENV !== 'production',
    stateDirectory: process.env.LOCAL_NPM_REGISTRY_STATE_DIR,
    join,
  });
  const localWidgetPackageRegistry = config.dev && process.env.NODE_ENV !== 'production'
    ? new LocalWidgetPackageRegistrySync({
        repositoryRoot: resolve(import.meta.dir, '..', '..', '..'),
      })
    : null;
  const prepareWidgetNpmDependencies = localWidgetPackageRegistry === null
    ? undefined
    : () => localWidgetPackageRegistry.sync();
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
      const environmentIdentity = options.distributionBuildEnvironmentIdentity
        ?? fnWidgetNpmBuildEnvironmentIdentity({
          runnerIdentity: 'injected-v1',
          nodeVersion: 'injected',
          npmVersion: 'injected',
          platform: 'injected',
          architecture: 'injected',
          toolchainPinnedByRunner: true,
        });
      return Object.freeze({
        create: (_scratchDirectory: string): TOmnidrawDistributionBuild => injected,
        environmentIdentity,
        packageManagerVersion: 'injected',
        runner: Object.freeze({ kind: 'isolated' as const, identity: 'injected-v1' }),
        platform: Object.freeze({ os: 'injected', architecture: 'injected' }),
      });
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
    const nodeVersion = toolchainPinnedByRunner ? 'runner-pinned' : process.version;
    const packageManagerVersion = toolchainPinnedByRunner
      ? 'runner-pinned'
      : process.versions.npm ?? 'external';
    const platform = toolchainPinnedByRunner ? 'linux' : process.platform;
    const architecture = process.arch;
    return Object.freeze({
      create: (scratchDirectory: string): TOmnidrawDistributionBuild => (
        createWidgetNpmDistributionBuild({
          scratchDirectory,
          npmUserConfigPath,
          prepareNpmDependencies: prepareWidgetNpmDependencies,
          runProcess: runner.runProcess,
          runnerIdentity: runner.identity,
        })
      ),
      environmentIdentity: fnWidgetNpmBuildEnvironmentIdentity({
        runnerIdentity: runner.identity,
        nodeVersion,
        npmVersion: packageManagerVersion,
        platform,
        architecture,
        toolchainPinnedByRunner,
      }),
      packageManagerVersion,
      runner: Object.freeze({
        kind: runner.kind === 'docker' ? 'isolated' as const : 'host' as const,
        identity: runner.identity,
      }),
      platform: Object.freeze({ os: platform, architecture }),
    });
  })();
  const dbService = new DbServiceTurso({
    databasePath: config.home.mainDbPath,
    dataDir: config.home.homeDir,
    cacheDir: config.home.cacheRoot,
    silentMigrations: process.env.OMNIDRAW_SILENT_DB_MIGRATIONS === '1',
  });
  const widgetCapsuleSigningKeys = new WidgetCapsuleSigningKeyStore(
    join(config.home.homeDir, 'keys'),
  );
  const widgetCapsuleHostConfiguration = new WidgetCapsuleHostConfigurationService(
    widgetCapsuleSigningKeys,
  );
  const widgetReleaseAttestation = new WidgetReleaseAttestationService(
    widgetCapsuleSigningKeys,
    widgetCapsuleHostConfiguration,
  );
  const widgetBuilderIdentity = fnWidgetCapsuleBuilderIdentity({
    npmVersion: process.versions.npm ?? 'external',
    serverBunVersion: Bun.version,
  });
  const widgetBuildTempRoot = join(config.home.tempRoot, 'widget-builds');
  const widgetDescriptorTempRoot = join(
    config.home.tempRoot,
    'widget-function-descriptors',
  );
  mkdirSync(widgetBuildTempRoot, { recursive: true, mode: 0o700 });
  mkdirSync(widgetDescriptorTempRoot, { recursive: true, mode: 0o700 });
  txEnsureOmnidrawHome({ mkdirSync }, { home: config.home });
  const descriptorExtractor = new BunChildFunctionDescriptorExtractor({
    compiledExecutable: config.compiled,
    tempRoot: widgetDescriptorTempRoot,
  });
  const capsuleBuilder = new WidgetArtifactBuilderCapsule({
    tempRoot: widgetBuildTempRoot,
    builderIdentity: widgetBuilderIdentity,
    capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
    buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
    functionDescriptorExtractor: descriptorExtractor,
    resolveTrustedPackageImport: resolveTrustedWidgetBuildPackageImport,
    loadSigningKeys: (purpose) => widgetCapsuleSigningKeys.loadSigningKeys(purpose),
    capsuleBuild: options.capsuleBuild ?? buildCapsuleGuest,
    distributionBuild: distributionBuildSetup.create(widgetBuildTempRoot),
  });
  const signedCapsuleInspections = new WeakMap<
    Uint8Array,
    TWidgetFilesystemCapsuleInspection & Readonly<{ bytesDigestSha256: string }>
  >();
  const widgetFilesystemBuilder = new WidgetFilesystemBuildService({
    builderIdentity: widgetBuilderIdentity,
    environment: Object.freeze({
      packageManager: Object.freeze({
        name: 'npm',
        version: distributionBuildSetup.packageManagerVersion,
        lockfile: 'package-lock.json',
        lockFormat: 'npm-lock-v3',
      }),
      sdkVersion: sdkPackage.version,
      importMapDigestSha256: sha256(JSON.stringify({
        format: 'omnidraw-widget-host-import-map-v1',
        imports: {
          '@omnidraw/sdk/server': sdkPackage.version,
          zod: rootPackage.catalog.zod,
        },
      })),
      transformsDigestSha256: sha256(distributionBuildSetup.environmentIdentity),
      runner: distributionBuildSetup.runner,
      platform: distributionBuildSetup.platform,
      capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
      buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
      signingPolicyId: `capsule-ed25519:${WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID}`,
    }),
    construction: {
      construct: (request) => capsuleBuilder.construct(request),
      signConstruction: async (request) => {
        const build = await capsuleBuilder.signConstruction(request);
        signedCapsuleInspections.set(build.uiArtifact.bytes, Object.freeze({
          bytesDigestSha256: sha256(build.uiArtifact.bytes),
          artifactHash: build.uiArtifact.capsuleArtifactHash,
          runtime: build.uiArtifact.runtimeDescriptor,
        }));
        return build;
      },
      closeWorkspace: (request) => capsuleBuilder.closeWorkspace(request),
      close: () => capsuleBuilder.close(),
    },
    capsuleInspector: {
      async inspect(bytes) {
        const inspection = signedCapsuleInspections.get(bytes);
        signedCapsuleInspections.delete(bytes);
        if (
          inspection === undefined
          || inspection.bytesDigestSha256 !== sha256(bytes)
        ) throw new Error('Signed Capsule bytes were not produced by the current builder.');
        return Object.freeze({
          artifactHash: inspection.artifactHash,
          runtime: inspection.runtime,
        });
      },
    },
    releaseAttestor: widgetReleaseAttestation,
  });
  const widgetCatalog = new WidgetFilesystemRuntimeCatalog({
    widgetsRoot: config.home.widgetsRoot,
    capsule: widgetReleaseAttestation,
    management: { builder: widgetFilesystemBuilder },
  });
  const widgetRuntimeLoadAdmission = new WidgetRuntimeLoadAdmission();
  const writePermits = new EphemeralResourceWritePermitAuthority({
    secret: randomBytes(32),
  });
  services.provide('db', 20, dbService);

  const resourceService = new ResourceService({
    placement: Object.freeze({
      cellId: DEFAULT_OSS_CELL_ID,
      placementEpoch: 1,
    }),
    db: dbService,
    controlStore: new ResourceControlStoreTurso(dbService.db),
    dataRoot: config.home.resourcesRoot,
    useCoordinator: new ResourceUseCoordinatorBridge(),
    writeCapabilityVerifier: writePermits,
    writePermitCoordinator: writePermits,
  });
  const resourceCapabilities = createResourceServiceCapabilities(resourceService);
  const canvasService = new CanvasService({
    store: new CanvasItemStoreTurso(dbService.db),
  });
  const functionTempRoot = join(config.home.tempRoot, 'function-runtime');
  const functionDriver = options.createFunctionSandboxDriver?.({
    compiledExecutable: config.compiled,
    tempRoot: functionTempRoot,
  }) ?? new BunChildSandboxDriver({
    compiledExecutable: config.compiled,
    tempRoot: functionTempRoot,
  });
  const functionService = new FunctionService({
    canvas: canvasService,
    catalog: widgetCatalog,
    resources: resourceService,
    executor: new DirectFunctionExecutor({
      driver: functionDriver,
      schemas: new JsonSchemaFunctionValidator(),
    }),
    writePermits,
  });
  const agentBashCapability = createBunAgentBashCapability();
  const agentRoot = config.home.agentRoot;
  mkdirSync(agentRoot, { recursive: true });
  const agentService = new AgentService({
    dataPath: agentRoot,
    npmUserConfigPath,
    prepareWidgetNpmDependencies,
    eventPublisherService: eventPublisher,
    chats: dbService.chats,
    resourceService: createAgentResourceService(resourceService),
    bashCapability: agentBashCapability,
  });
  const widgetStateService = new WidgetStateService(
    new WidgetInstanceStateStoreTurso(dbService.db),
  );
  services.provide('canvas', 49, canvasService);
  services.provide('widgetState', 50, widgetStateService);
  services.provide(
    'widgetCapsuleHostConfiguration',
    57,
    widgetCapsuleHostConfiguration,
  );
  services.provide('widgetRuntimeLoadAdmission', 57, widgetRuntimeLoadAdmission);
  services.provide('widgetCatalog', 57, widgetCatalog);
  services.provide('resourceOwner', 58, resourceService);
  services.provide('resource', 59, resourceCapabilities.resource);
  services.provide('humanResourceSecret', 59, resourceCapabilities.humanSecret);
  services.provide('functionOwner', 61, functionService);
  services.provide('functionInvocation', 61, functionService);
  services.provide('agent', 62, agentService);

  return {
    services,
    canvasService,
    dbService,
    eventPublisher,
    resourceService,
    functionService,
    widgetCatalog,
    widgetStateService,
  };
}

export { setupServices };
export type { TSetupServicesOptions };
