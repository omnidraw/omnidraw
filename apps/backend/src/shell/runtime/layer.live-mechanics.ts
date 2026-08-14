import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { signCapsuleArtifactBytes } from '@omnidraw/capsule/sign';
import type { IFunctionInvocationApiCapability } from '#backend/shell/api/function';
import {
  BunChildFunctionDescriptorExtractor,
  BunChildSandboxDriver,
  DirectFunctionExecutor,
  EphemeralResourceWritePermitAuthority,
  JsonSchemaFunctionValidator,
} from '#backend/shell/function-execution/local';
import {
  AgentService,
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  PublicationReadWriteBarrier,
  WidgetFilesystemBuildService,
  type TWidgetFilesystemCapsuleInspection,
} from '#backend/shell/agent';
import {
  type TOmnidrawCapsuleBuild,
  type TOmnidrawDistributionBuild,
} from '#backend/shell/widget-runtime/builder';
import {
  WidgetArtifactBuilderCapsule,
  buildCapsuleGuest,
} from '#backend/shell/widget-runtime/build';
import {
  CanvasService,
  type ICanvasService,
} from '#backend/shell/canvas/authority';
import { CANVAS_WIDGET_EXTENSION_KEY } from '@omnidraw/canvas-contract/CONSTANTS';
import type { TCanvasWidgetExtensionV1 } from '@omnidraw/canvas-contract/types';
import { CanvasItemStoreTurso } from '#backend/shell/database/CanvasItemStoreTurso';
import { DbServiceTurso } from '#backend/shell/database/DbServiceTurso/DbServiceTurso';
import { Database } from '#backend/shell/database/DbServiceTurso/turso-native';
import { ResourceControlStoreTurso } from '#backend/shell/database/ResourceControlStoreTurso';
import { WidgetInstanceStateStoreTurso } from '#backend/shell/database/WidgetInstanceStateStoreTurso';
import { EventPublisherService } from '#backend/shell/events/EventPublisherService';
import {
  WidgetStateService,
  type IWidgetStateService,
} from '#backend/shell/widget-state';
import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'node:url';
import { ensureOmnidrawHome } from '#backend/shell/config/ensure-omnidraw-home';
import sdkPackage from '@omnidraw/sdk/package.json';
import type {
  IHumanResourceSecretService,
  TResourceApiCapability,
} from '#backend/shell/api/resource/types';
import { DEFAULT_OSS_CELL_ID } from '#backend/shell/database/CONSTANTS';
import type { ICliConfig } from '../cli/config';
import { fnLocalRegistryNpmUserConfig } from '../registry/fn.local-registry-npm-userconfig';
import { createBunAgentBashCapability } from '../agent/AgentBashCapability';
import { fnWidgetCapsuleBuilderIdentity } from '../widget/fn.widget-capsule-builder-identity';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
  WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
} from '../widget/CONSTANTS';
import { WidgetCapsuleSigningKeyStore } from '../widget/WidgetCapsuleSigningKeyStore';
import { WidgetConstructionCache } from '../widget/WidgetConstructionCache';
import {
  createWidgetNpmDistributionBuild,
  fnWidgetNpmBuildEnvironmentIdentity,
  resolveWidgetNpmBuildRunner,
  runProcess as runWidgetBuildProcess,
} from '../widget/WidgetNpmDistributionBuild';
import {
  WidgetCapsuleHostConfigurationService,
} from '../widget/WidgetCapsuleHostConfigurationService';
import {
  FunctionService,
} from '../function-execution/FunctionService';
import {
  createBunChildCage,
  liveBunChildProcessGroupController,
  readBunChildRssBytes,
  removeBunChildCage,
  terminateBunChild,
} from '../function-execution/local/BunChildLifecycle';
import { readBunChildCpuMs } from '../function-execution/local/BunChildSandboxDriver';
import { ResourceService } from '../resources/ResourceService';
import { createAgentResourceService } from '../agent/AgentResourceService';
import {
  createResourceServiceCapabilities,
} from '../resources/ResourceServiceCapabilities';
import { ResourceUseCoordinatorBridge } from '../resources/ResourceUseCoordinatorBridge';
import { WidgetRuntimeLoadAdmission } from '../widget/WidgetRuntimeLoadAdmission';
import { WidgetFilesystemRuntimeCatalog } from '../widget/WidgetFilesystemRuntimeCatalog';
import { WidgetPreviewService } from '../widget/WidgetPreviewService';
import { WidgetBuildGenerationService } from '../widget/WidgetBuildGenerationService';
import {
  fnDefaultWidgetPreviewInspectionTheme,
} from '../widget/fn.widget-preview-inspection';
import {
  PreviewInspectionBrowserService,
} from '../preview/PreviewInspectionBrowserService';
import {
  PreviewInspectionShellServer,
} from '../preview/PreviewInspectionShellServer';
import {
  resolvePreviewInspectionReleaseRuntime,
} from '../preview/preview-inspection-release-runtime';
import { WidgetReleaseAttestationService } from '../widget/WidgetReleaseAttestationService';
import {
  LocalWidgetPackageRegistrySync,
  type TLocalWidgetPackageRegistryExecute,
} from '../widget/LocalWidgetPackageRegistrySync';
import { WidgetSourceSnapshot } from '../widget-domain/local';
import { Context, Effect, Layer } from 'effect';
import {
  BackendConfig,
  LiveAgent,
  LiveCanvas,
  LiveDatabase,
  LiveEventPublisher,
  LiveFunctionInvocation,
  LiveHumanResourceSecret,
  LiveResource,
  LiveWidgetBuildGeneration,
  LiveWidgetCatalog,
  LiveWidgetHostConfiguration,
  LiveWidgetLoadAdmission,
  LiveWidgetPreview,
  LiveWidgetState,
} from './service.live-mechanics';

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

export type TLiveMechanicsOptions = Readonly<{
  capsuleBuild?: TOmnidrawCapsuleBuild;
  distributionBuild?: TOmnidrawDistributionBuild;
  distributionBuildEnvironmentIdentity?: string;
  localWidgetPackageRegistryExecute?: TLocalWidgetPackageRegistryExecute;
  createFunctionSandboxDriver?: (args: Readonly<{
    tempRoot: string;
  }>) => BunChildSandboxDriver;
}>;

export function createLiveLocalWidgetPackageRegistrySync(args: Readonly<{
  localDevelopment: boolean;
  repositoryRoot?: string;
  execute?: TLocalWidgetPackageRegistryExecute;
}>): LocalWidgetPackageRegistrySync | null {
  if (!args.localDevelopment) return null;
  if (args.repositoryRoot === undefined) {
    throw new Error(
      'Local widget package synchronization requires the Omnidraw repository root from the backend runtime edge.',
    );
  }
  return new LocalWidgetPackageRegistrySync({
    repositoryRoot: args.repositoryRoot,
    ...(args.execute === undefined ? {} : { execute: args.execute }),
  });
}

export function layerLiveMechanics(args: Readonly<{
  config: ICliConfig;
  repositoryRoot?: string;
  options?: TLiveMechanicsOptions;
}>) {
  return Layer.effectContext(Effect.gen(function*() {
  const config = args.config;
  const options = args.options ?? {};
  const eventPublisher = new EventPublisherService();
  const localDevelopment = config.dev && process.env.NODE_ENV !== 'production';
  const npmUserConfigPath = fnLocalRegistryNpmUserConfig({
    homeDirectory: homedir(),
    localDevelopment,
    stateDirectory: process.env.LOCAL_NPM_REGISTRY_STATE_DIR,
    join,
  });
  const mutableRegistryUrl = localDevelopment
    ? process.env.LOCAL_NPM_REGISTRY_URL ?? 'http://127.0.0.1:4873/'
    : undefined;
  const localWidgetPackageRegistry = createLiveLocalWidgetPackageRegistrySync({
    localDevelopment,
    repositoryRoot: args.repositoryRoot,
    execute: options.localWidgetPackageRegistryExecute,
  });
  const prepareWidgetNpmDependencies = localWidgetPackageRegistry === null
    ? undefined
    : () => localWidgetPackageRegistry.sync();
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
      runProcess: runWidgetBuildProcess,
      createId: randomUUID,
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
          mutableRegistryUrl,
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
    applicationVersion: config.version,
    databasePath: config.home.mainDbPath,
    dataDir: config.home.homeDir,
    cacheDir: config.home.cacheRoot,
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
  const widgetConstructionCache = new WidgetConstructionCache(
    join(widgetBuildTempRoot, 'construction-cache'),
  );
  ensureOmnidrawHome({ mkdirSync }, { home: config.home });
  const descriptorExtractor = new BunChildFunctionDescriptorExtractor({
    executable: process.execPath,
    workerPath: fileURLToPath(new URL(
      '../function-execution/local/function-worker.ts',
      import.meta.url,
    )),
    tempRoot: widgetDescriptorTempRoot,
    spawn: Bun.spawn,
    nowMs: Date.now,
    timers: Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>),
    }),
    readRssBytes: readBunChildRssBytes,
    createId: randomUUID,
    createCage: createBunChildCage,
    removeCage: removeBunChildCage,
    terminateChild: terminateBunChild,
    processGroups: liveBunChildProcessGroupController,
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
    snapshotService: new WidgetSourceSnapshot({ nowMs: Date.now }),
    capsuleSign: signCapsuleArtifactBytes,
    bunBuild: Bun.build,
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
          zod: '4.4.3',
        },
      })),
      transformsDigestSha256: sha256(distributionBuildSetup.environmentIdentity),
      runner: distributionBuildSetup.runner,
      platform: distributionBuildSetup.platform,
      capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
      buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
      signingPolicyId: `capsule-ed25519:${WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID}`,
    }),
    constructionCache: widgetConstructionCache,
    construction: {
      construct: (request) => capsuleBuilder.construct(request),
      signConstruction: async (request) => {
        const build = await capsuleBuilder.signConstruction(request);
        signedCapsuleInspections.set(build.uiArtifact.bytes, Object.freeze({
          bytesDigestSha256: sha256(build.uiArtifact.bytes),
          artifactHash: build.uiArtifact.artifactHash,
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
  let widgetBuildGeneration: WidgetBuildGenerationService | null = null;
  let resourceService: ResourceService | null = null;
  let canvasService: CanvasService | null = null;
  let widgetPreview: WidgetPreviewService | null = null;
  let agentService: AgentService | null = null;
  const publicationBarrier = new PublicationReadWriteBarrier();
  const widgetCatalog = new WidgetFilesystemRuntimeCatalog({
    widgetsRoot: config.home.widgetsRoot,
    capsule: widgetReleaseAttestation,
    filesystem: new NodeWidgetCatalogFilesystem(),
    hash: new NodeWidgetCatalogHash(),
    barrier: publicationBarrier,
    management: {
      builder: widgetFilesystemBuilder,
      createOperationToken: randomUUID,
      acceptedBuild: {
        requireCurrent(widgetKey, signal) {
          if (widgetBuildGeneration === null) {
            throw new Error('Widget build generation authority is not initialized.');
          }
          return widgetBuildGeneration.requireCurrent(widgetKey, signal);
        },
      },
      deletion: {
        async observe({ widgetKey, source, deleteDraft }) {
          if (canvasService === null || agentService === null) {
            throw new Error('Widget deletion cleanup authorities are not initialized.');
          }
          const placements: import('#backend/shell/agent').TWidgetDeletionPlacement[] = [];
          const canvases = await dbService.canvas.listAll();
          for (const canvas of canvases) {
            let cursor: import('@omnidraw/canvas-contract').TCanvasItemQueryCursor | undefined;
            do {
              const page = await canvasService.queryItems({
                canvasId: canvas.id,
                filter: { type: 'widget-key', widgetKey },
                limit: 1_000,
                ...(cursor === undefined ? {} : { cursor }),
              });
              for (const snapshot of page.items) {
                const extension = snapshot.item.extensions?.[CANVAS_WIDGET_EXTENSION_KEY] as
                  | TCanvasWidgetExtensionV1
                  | undefined;
                if (
                  snapshot.item.kind !== 'widget-frame'
                  || (extension?.type !== 'widget-instance' && extension?.type !== 'widget-preview')
                  || extension.widgetKey !== widgetKey
                  || (source === 'draft' && extension.type !== 'widget-preview')
                ) continue;
                placements.push(Object.freeze({
                  canvasId: canvas.id,
                  itemId: snapshot.id,
                  itemRevision: snapshot.itemRevision,
                  createdAtSec: snapshot.createdAtSec,
                  instanceId: extension.instanceId,
                  type: extension.type,
                }));
              }
              cursor = page.nextCursor ?? undefined;
            } while (cursor !== undefined);
          }
          const mounts = deleteDraft
            ? await agentService.observeWidgetDraftMounts(widgetKey)
            : Object.freeze([]);
          return Object.freeze({
            placements: Object.freeze(placements),
            mounts,
          });
        },
        async retireDraft(widgetKey) {
          if (widgetPreview === null || widgetBuildGeneration === null) {
            throw new Error('Widget derived-state authorities are not initialized.');
          }
          await widgetPreview.retireWidget(widgetKey);
          await widgetBuildGeneration.retire(widgetKey);
        },
        async removePlacement({ operationId, widgetKey, placement }) {
          if (canvasService === null) throw new Error('Canvas authority is not initialized.');
          const commandId = `widget-delete-${sha256([
            operationId,
            placement.canvasId,
            placement.itemId,
            placement.createdAtSec,
          ].join('\u0000')).slice(0, 48)}`;
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const snapshot = await canvasService.getSnapshot({ canvasId: placement.canvasId });
            const current = snapshot.items.find((item) => item.id === placement.itemId);
            if (current === undefined) return;
            const extension = current.item.extensions?.[CANVAS_WIDGET_EXTENSION_KEY] as
              | TCanvasWidgetExtensionV1
              | undefined;
            if (
              current.createdAtSec !== placement.createdAtSec
              || current.item.kind !== 'widget-frame'
              || extension?.type !== placement.type
              || extension.widgetKey !== widgetKey
              || extension.instanceId !== placement.instanceId
            ) throw Object.assign(
              new Error('A planned Canvas placement was replaced; recovery refuses to delete it.'),
              { code: 'WIDGET_DELETION_RECOVERY_PENDING' },
            );
            try {
              await canvasService.execute({
                commandId,
                canvasId: placement.canvasId,
                baseRevision: snapshot.revision,
                operations: [{ type: 'delete', itemId: placement.itemId }],
                preconditions: [{
                  type: 'item-revision',
                  itemId: placement.itemId,
                  itemRevision: current.itemRevision,
                }],
              });
              return;
            } catch (error) {
              const code = error !== null && typeof error === 'object' && 'code' in error
                ? error.code
                : null;
              if (code !== 'CONFLICT' && code !== 'STORE_CONFLICT') throw error;
            }
          }
          throw Object.assign(new Error('Canvas placement remained busy during deletion.'), {
            code: 'WIDGET_DELETION_RECOVERY_PENDING',
          });
        },
        async removeMount({ widgetKey, mount }) {
          if (agentService === null) throw new Error('AI Chat mount authority is not initialized.');
          await agentService.removeWidgetDraftMount(widgetKey, mount);
        },
      },
    },
    buildGenerations: {
      view(widgetKey) {
        if (widgetBuildGeneration === null) {
          throw new Error('Widget build generation authority is not initialized.');
        }
        return widgetBuildGeneration.view(widgetKey);
      },
    },
    resources: {
      getResource(resourceId) {
        if (resourceService === null) {
          throw new Error('Resource authority is not initialized.');
        }
        return resourceService.getResource(resourceId);
      },
    },
  });
  widgetBuildGeneration = new WidgetBuildGenerationService({
    widgetsRoot: config.home.widgetsRoot,
    catalog: widgetCatalog,
    builder: widgetFilesystemBuilder,
    sdkVersion: sdkPackage.version,
    now: Date.now,
    scheduleInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
    cancelInterval: clearInterval,
    mutationAdmission: {
      assertAllowed: (widgetKey) => widgetCatalog.assertDraftMutationAllowed(widgetKey),
    },
  });
  const widgetRuntimeLoadAdmission = new WidgetRuntimeLoadAdmission();
  const previewInspectionReleaseRuntime = resolvePreviewInspectionReleaseRuntime({
    sourceCliDir: import.meta.dir,
  });
  const previewInspectionShell = new PreviewInspectionShellServer({
    distPath: previewInspectionReleaseRuntime.shellPath,
    createToken: () => randomBytes(24).toString('base64url'),
  });
  const previewInspectionBrowser = new PreviewInspectionBrowserService({
    tempRoot: join(config.home.tempRoot, 'preview-inspection-browser'),
    shell: previewInspectionShell,
  });
  const writePermits = new EphemeralResourceWritePermitAuthority({
    secret: randomBytes(32),
    nowMs: Date.now,
    createId: randomUUID,
    createNonce: randomUUID,
  });

  resourceService = new ResourceService({
    placement: Object.freeze({
      cellId: DEFAULT_OSS_CELL_ID,
      placementEpoch: 1,
    }),
    db: dbService,
    controlStore: new ResourceControlStoreTurso(dbService.db),
    dataRoot: config.home.resourcesRoot,
    useCoordinator: new ResourceUseCoordinatorBridge({ nowMs: Date.now }),
    crypto: Object.freeze({ randomUUID }),
    randomBytes,
    databaseFactory: (path, databaseOptions) => new Database(path, databaseOptions),
    nowMs: Date.now,
    scheduleIdleSweep: (callback, delayMs) => {
      const timer = setTimeout(() => { void callback(); }, delayMs);
      timer.unref?.();
      return () => clearTimeout(timer);
    },
    writeCapabilityVerifier: writePermits,
    writePermitCoordinator: writePermits,
  });
  const resourceCapabilities = createResourceServiceCapabilities(resourceService);
  canvasService = new CanvasService({
    store: new CanvasItemStoreTurso(dbService.db),
    widgetPlacementAdmission: {
      assertAllowed: (input) => widgetCatalog.assertCanvasPlacementAllowed(input),
      withAdmission: (placements, operation) => publicationBarrier.withRead(async () => {
        for (const placement of placements) {
          widgetCatalog.assertCanvasPlacementAllowed(placement);
        }
        return operation();
      }),
    },
  });
  const functionTempRoot = join(config.home.tempRoot, 'function-runtime');
  mkdirSync(functionTempRoot, { recursive: true, mode: 0o700 });
  const functionDriver = options.createFunctionSandboxDriver?.({
    tempRoot: functionTempRoot,
  }) ?? new BunChildSandboxDriver({
    executable: process.execPath,
    workerPath: fileURLToPath(new URL(
      '../function-execution/local/function-worker.ts',
      import.meta.url,
    )),
    tempRoot: functionTempRoot,
    spawn: Bun.spawn,
    nowMs: Date.now,
    createId: randomUUID,
    timers: Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>),
    }),
    readRssBytes: readBunChildRssBytes,
    readCpuMs: readBunChildCpuMs,
    createCage: createBunChildCage,
    removeCage: removeBunChildCage,
    terminateChild: terminateBunChild,
    processGroups: liveBunChildProcessGroupController,
  });
  const functionService = new FunctionService({
    canvas: canvasService,
    catalog: widgetCatalog,
    resources: resourceService,
    executor: new DirectFunctionExecutor({
      driver: functionDriver,
      schemas: new JsonSchemaFunctionValidator(),
      nowMs: Date.now,
      createId: randomUUID,
    }),
    writePermits,
    nowMs: Date.now,
  });
  const resolvePreviewInspectionScope = async (args: Readonly<{
    chatId: string;
    canvasId: string;
    aiChatElementId: string;
    widgetKey: string;
  }>) => {
    const chat = await dbService.chats.get({ id: args.chatId });
    if (
      chat === null
      || chat.status !== 'active'
      || chat.canvasId !== args.canvasId
    ) {
      throw Object.assign(new Error('The exact active chat canvas is unavailable.'), {
        code: 'PREVIEW_CHAT_SCOPE_UNAVAILABLE',
      });
    }
    const aiChatPage = await canvasService.queryItems({
      canvasId: args.canvasId,
      filter: { type: 'ids', ids: [args.aiChatElementId] },
      limit: 1,
    });
    const aiChatItem = aiChatPage.items[0]?.item;
    const aiChatExtension = aiChatItem?.extensions?.[CANVAS_WIDGET_EXTENSION_KEY] as
      | TCanvasWidgetExtensionV1
      | undefined;
    if (
      aiChatItem?.id !== args.aiChatElementId
      || aiChatItem.kind !== 'widget-frame'
      || aiChatExtension?.type !== 'ui-widget'
      || aiChatExtension.kind !== 'ai-chat'
    ) {
      throw Object.assign(new Error('The exact AI Chat canvas element is unavailable.'), {
        code: 'PREVIEW_CHAT_ELEMENT_UNAVAILABLE',
      });
    }
    const candidates = await canvasService.queryItems({
      canvasId: args.canvasId,
      filter: { type: 'widget-key', widgetKey: args.widgetKey },
      limit: 1_000,
    });
    if (candidates.nextCursor !== null) {
      throw Object.assign(new Error('The exact Preview scope is too large to resolve safely.'), {
        code: 'PREVIEW_SCOPE_TOO_LARGE',
      });
    }
    const previews = candidates.items.flatMap((snapshot) => {
      const extension = snapshot.item.extensions?.[CANVAS_WIDGET_EXTENSION_KEY] as
        | TCanvasWidgetExtensionV1
        | undefined;
      return snapshot.item.kind === 'widget-frame'
        && extension?.type === 'widget-preview'
        && extension.widgetKey === args.widgetKey
          ? [{ item: snapshot.item, extension }]
          : [];
    });
    if (previews.length > 1) {
      throw Object.assign(
        new Error('More than one matching Preview frame exists on the current canvas.'),
        { code: 'PREVIEW_FRAME_AMBIGUOUS' },
      );
    }
    if (previews.length === 0) {
      return Object.freeze({
        chatId: args.chatId,
        canvasId: args.canvasId,
        aiChatElementId: args.aiChatElementId,
        widgetKey: args.widgetKey,
        previewFrame: 'absent' as const,
      });
    }
    const preview = previews[0]!;
    return Object.freeze({
      chatId: args.chatId,
      canvasId: args.canvasId,
      aiChatElementId: args.aiChatElementId,
      previewFrame: 'exact' as const,
      previewElementId: preview.item.id,
      previewInstanceId: preview.extension.instanceId,
      widgetKey: args.widgetKey,
    });
  };
  widgetPreview = new WidgetPreviewService({
    widgetsRoot: config.home.widgetsRoot,
    catalog: widgetCatalog,
    buildGenerations: widgetBuildGeneration,
    builder: widgetFilesystemBuilder,
    resources: resourceService,
    executor: new DirectFunctionExecutor({
      driver: functionDriver,
      schemas: new JsonSchemaFunctionValidator(),
      nowMs: Date.now,
      createId: randomUUID,
    }),
    writePermits,
    nowMs: Date.now,
    environment: widgetFilesystemBuilder.config.environment,
    compatibility: Object.freeze({
      builderIdentity: widgetBuilderIdentity,
      buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
      environmentIdentity: distributionBuildSetup.environmentIdentity,
      capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
    }),
    hostConfiguration: widgetCapsuleHostConfiguration,
    inspectionBrowser: previewInspectionBrowser,
    inspectionTheme: fnDefaultWidgetPreviewInspectionTheme(),
    inspectionScope: {
      resolve: resolvePreviewInspectionScope,
      async assertCurrent(resolution) {
        const current = await resolvePreviewInspectionScope(resolution);
        if (
          current.chatId !== resolution.chatId
          || current.canvasId !== resolution.canvasId
          || current.aiChatElementId !== resolution.aiChatElementId
          || current.widgetKey !== resolution.widgetKey
          || current.previewFrame !== resolution.previewFrame
          || (
            current.previewFrame === 'exact'
            && resolution.previewFrame === 'exact'
            && (
              current.previewElementId !== resolution.previewElementId
              || current.previewInstanceId !== resolution.previewInstanceId
            )
          )
        ) {
          throw Object.assign(new Error('The exact Preview scope changed.'), {
            code: 'PREVIEW_GENERATION_CHANGED',
          });
        }
      },
    },
  });
  const agentBashCapability = createBunAgentBashCapability();
  const agentRoot = config.home.agentRoot;
  mkdirSync(agentRoot, { recursive: true });
  agentService = new AgentService({
    world: {
      platform: process.platform,
      createId: randomUUID,
      now: () => new Date(),
    },
    dataPath: agentRoot,
    widgetDraftsRoot: config.home.widgetDraftsRoot,
    npmUserConfigPath,
    prepareWidgetNpmDependencies,
    onWidgetDraftsChanged: () => {
      void widgetCatalog.refresh().catch(() => undefined);
    },
    previewBuild: ({ slug }) => widgetPreview.buildCheck({ widgetKey: slug }),
    previewInspection: widgetPreview,
    eventPublisherService: eventPublisher,
    chats: dbService.chats,
    chatScope: {
      async validate({ canvasId, widgetId }) {
        const page = await canvasService.queryItems({
          canvasId,
          filter: { type: 'ids', ids: [widgetId] },
          limit: 1,
        });
        const item = page.items[0]?.item;
        const extension = item?.extensions?.[CANVAS_WIDGET_EXTENSION_KEY] as
          | TCanvasWidgetExtensionV1
          | undefined;
        return item?.id === widgetId
          && item.kind === 'widget-frame'
          && extension?.type === 'ui-widget'
          && extension.kind === 'ai-chat';
      },
    },
    widgetReferenceResolver: {
      resolve: (references) => widgetCatalog.resolveWidgetReferences(references),
      assertCurrent: (resolution) => (
        widgetCatalog.assertWidgetReferenceResolutionCurrent(resolution)
      ),
      withDraftMountAdmission: (widgetKeys, operation) => (
        widgetCatalog.withDraftMountAdmission(widgetKeys, operation)
      ),
    },
    resourceService: createAgentResourceService(resourceService),
    bashCapability: agentBashCapability,
  });
  const widgetStateService = new WidgetStateService(
    new WidgetInstanceStateStoreTurso(dbService.db),
    { now: Date.now },
  );
  yield* Effect.acquireRelease(
    Effect.promise(() => dbService.start()).pipe(Effect.as(dbService)),
    () => Effect.promise(() => dbService.stop()),
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => canvasService.stop()));
  yield* Effect.addFinalizer(() => Effect.sync(() => widgetStateService.stop()));
  yield* Effect.acquireRelease(
    Effect.promise(() => widgetCatalog.start()).pipe(Effect.as(widgetCatalog)),
    () => Effect.promise(() => widgetCatalog.stop()),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => widgetBuildGeneration.start()).pipe(Effect.as(widgetBuildGeneration)),
    () => Effect.promise(() => widgetBuildGeneration.stop()),
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => previewInspectionBrowser.stop()));
  yield* Effect.addFinalizer(() => Effect.promise(() => widgetPreview.stop()));
  yield* Effect.acquireRelease(
    Effect.promise(() => resourceService.start()).pipe(Effect.as(resourceService)),
    () => Effect.promise(() => resourceService.stop()),
  );
  yield* Effect.acquireRelease(
    Effect.promise(() => agentService.start()).pipe(Effect.as(agentService)),
    () => Effect.promise(() => agentService.stop()),
  );
  yield* Effect.promise(() => widgetCatalog.recoverDeletions());

  return Context.make(BackendConfig, config).pipe(
    Context.add(LiveAgent, agentService),
    Context.add(LiveCanvas, canvasService),
    Context.add(LiveDatabase, dbService),
    Context.add(LiveEventPublisher, eventPublisher),
    Context.add(LiveFunctionInvocation, functionService),
    Context.add(LiveHumanResourceSecret, resourceCapabilities.humanSecret),
    Context.add(LiveResource, resourceCapabilities.resource),
    Context.add(LiveWidgetBuildGeneration, widgetBuildGeneration),
    Context.add(LiveWidgetCatalog, widgetCatalog),
    Context.add(LiveWidgetHostConfiguration, widgetCapsuleHostConfiguration),
    Context.add(LiveWidgetLoadAdmission, widgetRuntimeLoadAdmission),
    Context.add(LiveWidgetPreview, widgetPreview),
    Context.add(LiveWidgetState, widgetStateService),
  );
  }));
}
